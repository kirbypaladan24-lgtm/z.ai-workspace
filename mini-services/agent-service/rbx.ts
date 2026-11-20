/**
 * rbx.ts — Roblox Studio bridge for the Z.ai Workspace Bridge.
 *
 * Roblox Studio plugins cannot open WebSockets, so this module gives the
 * .rbxm plugin an HTTP long-poll transport that mirrors what the VS Code
 * extension does over socket.io:
 *
 *   Plugin → server : POST /rbx/register {token?, identity?, placeName, placeId}
 *                     POST /rbx/poll     {token, waitMs}          (long-poll)
 *                     POST /rbx/result   {token, callId, ok, …}   (tool results)
 *                     POST /rbx/tree     {token, tree, stats}     (game scan)
 *                     POST /rbx/activity {token, entries}         (Studio edits)
 *                     POST /rbx/unregister {token}
 *   Server → plugin : poll returns command events ({type:'cmd', id, name, args}
 *                     — the SAME tools the VS Code extension executes:
 *                     list_files / read_file / write_file / edit_file /
 *                     delete_file / move_path / search_code / tree_refresh),
 *                     plus {type:'evicted'} and {type:'ping'}.
 *
 * Slot semantics mirror the VS Code flow: ONE workspace slot, first live
 * client wins, takeover evicts. When the plugin registers it takes the
 * workspace slot (fresh pairing code, journal reset) unless its saved
 * identity matches — then it reconnects persistently and paired browsers
 * stay paired. Tool calls route here automatically whenever the plugin
 * session is the live workspace client (see execToolViaVscode in index.ts).
 *
 * The HTTP server listens on 127.0.0.1:3005 and is reached through the
 * Caddy gateway as `<dashboard-url>/rbx/...?XTransformPort=3005`.
 */
import { createServer, IncomingMessage, ServerResponse } from 'http';
import { randomUUID } from 'crypto';

export interface RbxToolOutcome { ok: boolean; result: string; meta?: any; content?: string }

interface RbxCommand {
  type: 'cmd';
  id: string;
  name: string;
  args: any;
}

type RbxEvent = RbxCommand | { type: 'evicted'; reason: string } | { type: 'ping' };

interface RbxSession {
  token: string;
  workspaceId: string;
  placeName: string;
  placeId: number | null;
  studioVersion: string;
  queue: RbxEvent[];
  pending: Map<string, { resolve: (r: RbxToolOutcome) => void; timer: any }>;
  lastPoll: number;
  created: number;
  evicted: string | null;
  closed: boolean;
}

export interface RbxDeps {
  getWorkspace: () => any;
  vscodeConnected: () => boolean;
  resetWorkspaceSlot: (name: string, ws: any) => void;
  logActivity: (e: any) => void;
  emitStatus: () => void;
  onTree: (payload: { name?: string; tree: any; stats: any }) => void;
}

const RBX_PORT = parseInt(process.env.RBX_PORT ?? '3005', 10);
const RBX_TOOL_TIMEOUT_MS = 120_000;   // plugin long-polls ≤25s, so allow generous time
const RBX_STALE_MS = 45_000;           // no poll for 45s → Studio went away
const RBX_MAX_POLL_WAIT_MS = 25_000;
const RBX_MAX_ACTIVITY_BATCH = 100;

function shortId(): string {
  return Math.random().toString(36).slice(2, 10);
}

function sendJson(res: ServerResponse, code: number, data: any) {
  const body = JSON.stringify(data);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(body);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > 60_000_000) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/* ------------------------------------------------------------------ */
/* Module state — rebuilt on bun --hot re-evaluation. The previous     */
/* HTTP server (if any) is closed via the globalThis guard; sessions   */
/* are intentionally NOT persisted (the plugin re-registers with its   */
/* saved identity and reconnects persistently).                        */
/* ------------------------------------------------------------------ */
let session: RbxSession | null = null;
let deps: RbxDeps | null = null;
let sweeper: any = null;

function alive(): boolean {
  return !!session && !session.closed && Date.now() - session.lastPoll <= RBX_STALE_MS;
}

function info(): any | null {
  if (!session) return null;
  return {
    placeName: session.placeName,
    placeId: session.placeId,
    studioVersion: session.studioVersion,
    alive: alive(),
    lastPollAgoMs: Date.now() - session.lastPoll,
    connectedAt: session.created,
    queued: session.queue.length,
    evicted: session.evicted,
  };
}

/** Fail every pending tool call (eviction / stale close). */
function failPending(s: RbxSession, message: string) {
  for (const [, p] of s.pending) {
    clearTimeout(p.timer);
    p.resolve({ ok: false, result: message });
  }
  s.pending.clear();
}

function closeSession(s: RbxSession, reason: string, opts: { log: boolean }) {
  if (s.closed) return;
  s.closed = true;
  s.evicted = reason;
  failPending(s, `Roblox Studio is no longer connected (${reason}).`);
  if (opts.log && deps) {
    deps.logActivity({
      source: 'system',
      actor: 'System',
      kind: 'conn',
      text: `Roblox Studio disconnected — ${reason}.`,
    });
    deps.emitStatus();
  }
}

/** Enqueue a tool command for the plugin and await its /rbx/result. */
function execTool(name: string, args: any): Promise<RbxToolOutcome> {
  return new Promise((resolve) => {
    const s = session;
    if (!s || s.closed || !alive()) {
      resolve({ ok: false, result: 'Roblox Studio is not connected (place offline).' });
      return;
    }
    const callId = `rbx-${shortId()}`;
    const timer = setTimeout(() => {
      s.pending.delete(callId);
      resolve({ ok: false, result: `Tool "${name}" timed out — Roblox Studio did not answer in ${RBX_TOOL_TIMEOUT_MS / 1000}s (is the plugin still connected?).` });
    }, RBX_TOOL_TIMEOUT_MS);
    s.pending.set(callId, {
      resolve: (r) => { clearTimeout(timer); resolve(r); },
      timer,
    });
    s.queue.push({ type: 'cmd', id: callId, name, args });
  });
}

/** Ask the plugin to rescan the game and push a fresh tree. */
function requestTree() {
  const s = session;
  if (!s || s.closed) return;
  s.queue.push({ type: 'cmd', id: `rbx-${shortId()}`, name: 'tree_refresh', args: {} });
}

/** VS Code (or a new Studio session) takes over the bridge connection.
 *  The closed session stays as a tombstone so the plugin's final poll
 *  receives the evicted event (handlePoll nulls it afterwards). */
function evict(reason: string) {
  const s = session;
  if (!s) return;
  if (!s.closed) {
    s.queue.push({ type: 'evicted', reason });
    closeSession(s, reason, { log: s.lastPoll > 0 });
  }
}

/* ------------------------------------------------------------------ */
/* Handlers                                                            */
/* ------------------------------------------------------------------ */
async function handleRegister(body: any, res: ServerResponse) {
  const d = deps!;
  const placeName = String(body?.placeName ?? 'Roblox Place').slice(0, 120) || 'Roblox Place';
  const placeId = Number.isFinite(Number(body?.placeId)) && Number(body?.placeId) > 0 ? Number(body?.placeId) : null;
  const studioVersion = String(body?.studioVersion ?? '').slice(0, 60);
  const token = typeof body?.token === 'string' ? body.token : '';
  const identity = body?.identity && typeof body.identity === 'object' ? body.identity : null;

  if (d.vscodeConnected()) {
    const ws = d.getWorkspace();
    sendJson(res, 409, {
      ok: false,
      error: `A VS Code workspace ("${ws?.name ?? 'unknown'}") is connected to this bridge. Disconnect it first (AI Code Agent: Disconnect, or close VS Code) before connecting Roblox Studio.`,
    });
    return;
  }

  const existing = session;
  if (existing && !existing.closed && alive() && token !== existing.token) {
    const wsNow = d.getWorkspace();
    const sameIdentity = !!(wsNow && identity && String(identity.workspaceId ?? '') === wsNow.workspaceId && String(identity.secret ?? '') === wsNow.secret);
    if (!sameIdentity) {
      sendJson(res, 409, { ok: false, error: 'Another Roblox Studio session is connected to this bridge. Disconnect it first (the plugin\'s Disconnect button).' });
      return;
    }
    // the saved identity owns this slot — a quick Studio restart reclaims it
    // (mirrors VS Code's same-identity eviction of the previous window)
  }

  const ws = d.getWorkspace();
  let persistent = false;
  if (ws && identity && String(identity.workspaceId ?? '') === ws.workspaceId && String(identity.secret ?? '') === ws.secret) {
    // same place reconnecting (Studio restart / service restart) — identity persists
    persistent = true;
    ws.name = placeName;
  } else {
    // fresh takeover of the workspace slot (mirrors VS Code identity swap)
    d.resetWorkspaceSlot(placeName, {
      workspaceId: `rbx-${randomUUID()}`,
      secret: randomUUID(),
      name: placeName,
      pairingCode: genCode(),
      webTokens: [],
    });
  }

  // any previous session (plugin reload / stale Studio) is replaced silently
  if (existing && !existing.closed) closeSession(existing, 'replaced by a new session', { log: false });

  const workspace = d.getWorkspace()!;
  const newSession: RbxSession = {
    token: randomUUID(),
    workspaceId: workspace.workspaceId,
    placeName,
    placeId,
    studioVersion,
    queue: [],
    pending: new Map(),
    lastPoll: Date.now(),
    created: Date.now(),
    evicted: null,
    closed: false,
  };
  session = newSession;

  d.logActivity({
    source: 'system',
    actor: 'System',
    kind: 'conn',
    text: persistent
      ? `Roblox Studio reconnected — place "${placeName}" (identity persisted, paired browsers stay paired).`
      : `Roblox Studio place "${placeName}" connected — the bridge is live. Pair the dashboard with the code shown in the plugin.`,
  });
  d.emitStatus();

  sendJson(res, 200, {
    ok: true,
    token: newSession.token,
    workspaceId: workspace.workspaceId,
    secret: workspace.secret,
    workspaceName: workspace.name,
    pairingCode: workspace.pairingCode,
    persistent,
  });
}

function genCode(): string {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 6; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return s;
}

async function handlePoll(body: any, res: ServerResponse) {
  const d = deps!;
  const s = session;
  const token = String(body?.token ?? '');
  if (!s || s.token !== token) {
    sendJson(res, 404, { ok: false, error: 'unknown session — register again' });
    return;
  }
  if (s.closed) {
    sendJson(res, 200, { ok: true, events: [{ type: 'evicted', reason: s.evicted ?? 'session closed' }], status: null });
    session = null;
    return;
  }

  s.lastPoll = Date.now();
  const waitMs = Math.min(Math.max(Number(body?.waitMs) || 0, 0), RBX_MAX_POLL_WAIT_MS);
  const deadline = Date.now() + waitMs;

  const events: RbxEvent[] = await new Promise<RbxEvent[]>((resolve) => {
    const tick = () => {
      if (session !== s) return resolve([{ type: 'evicted', reason: 'session replaced' }]);
      if (s.queue.length > 0) return resolve(s.queue.splice(0, s.queue.length));
      if (Date.now() >= deadline) return resolve([{ type: 'ping' }]);
      setTimeout(tick, 350);
    };
    tick();
  });
  s.lastPoll = Date.now();

  const workspace = d.getWorkspace();
  sendJson(res, 200, {
    ok: true,
    events,
    status: {
      paired: (workspace?.webTokens?.length ?? 0) > 0,
      workspaceName: workspace?.name ?? null,
      pairingCode: workspace?.pairingCode ?? null,
      webClients: true,
    },
  });
}

async function handleResult(body: any, res: ServerResponse) {
  const s = session;
  if (!s || String(body?.token ?? '') !== s.token) {
    sendJson(res, 404, { ok: false, error: 'unknown session' });
    return;
  }
  s.lastPoll = Date.now();
  const callId = String(body?.callId ?? '');
  const pending = s.pending.get(callId);
  if (!pending) {
    sendJson(res, 200, { ok: true, note: 'no pending call with that id (already resolved?)' });
    return;
  }
  s.pending.delete(callId);
  pending.resolve({
    ok: !!(body?.ok ?? true),
    result: String(body?.result ?? ''),
    meta: body?.meta ?? undefined,
    content: typeof body?.content === 'string' ? body.content : undefined,
  });
  sendJson(res, 200, { ok: true });
}

async function handleTree(body: any, res: ServerResponse) {
  const d = deps!;
  const s = session;
  if (!s || String(body?.token ?? '') !== s.token) {
    sendJson(res, 404, { ok: false, error: 'unknown session' });
    return;
  }
  s.lastPoll = Date.now();
  const tree = body?.tree;
  const stats = body?.stats;
  if (!tree || typeof tree !== 'object' || !stats || typeof stats !== 'object') {
    sendJson(res, 400, { ok: false, error: 'missing tree or stats payload' });
    return;
  }
  d.onTree({ name: s.placeName, tree, stats });
  sendJson(res, 200, { ok: true });
}

async function handleActivity(body: any, res: ServerResponse) {
  const d = deps!;
  const s = session;
  if (!s || String(body?.token ?? '') !== s.token) {
    sendJson(res, 404, { ok: false, error: 'unknown session' });
    return;
  }
  s.lastPoll = Date.now();
  const entries: any[] = Array.isArray(body?.entries) ? body.entries.slice(0, RBX_MAX_ACTIVITY_BATCH) : [];
  for (const e of entries) {
    const kind = e?.kind === 'note' ? 'note' : 'fs';
    d.logActivity({
      source: 'local',
      actor: 'You (Roblox Studio)',
      kind,
      ...(kind === 'fs'
        ? {
          fsType: e?.fsType === 'created' ? 'created' : e?.fsType === 'deleted' ? 'deleted' : 'changed',
          path: String(e?.path ?? '').slice(0, 400),
        }
        : { text: String(e?.text ?? '').slice(0, 1000) }),
    });
  }
  sendJson(res, 200, { ok: true, logged: entries.length });
}

async function handleUnregister(body: any, res: ServerResponse) {
  const s = session;
  if (!s || String(body?.token ?? '') !== s.token) {
    sendJson(res, 404, { ok: false, error: 'unknown session' });
    return;
  }
  closeSession(s, 'plugin disconnected', { log: true });
  session = null;
  sendJson(res, 200, { ok: true });
}

/* ------------------------------------------------------------------ */
/* HTTP server — 127.0.0.1:3005, reached via the Caddy gateway         */
/* (?XTransformPort=3005). Hot-reload safe via the globalThis guard.   */
/* ------------------------------------------------------------------ */
export interface RbxApi {
  alive(): boolean;
  info(): any | null;
  execTool(name: string, args: any): Promise<RbxToolOutcome>;
  requestTree(): void;
  evict(reason: string): void;
}

const g = globalThis as any;

export function initRbx(d: RbxDeps): RbxApi {
  deps = d;

  if (g.__rbxSweeper) clearInterval(g.__rbxSweeper);
  sweeper = setInterval(() => {
    const s = session;
    if (s && !s.closed && Date.now() - s.lastPoll > RBX_STALE_MS) {
      closeSession(s, 'no polls for 45s (Studio closed or plugin stopped)', { log: true });
      session = null;
    }
  }, 15_000);
  g.__rbxSweeper = sweeper;

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    try {
      if (req.method === 'OPTIONS') {
        sendJson(res, 204, {});
        return;
      }
      const body = req.method === 'POST' ? JSON.parse((await readBody(req)) || '{}') : {};
      switch (url.pathname) {
        case '/rbx/register':   return await handleRegister(body, res);
        case '/rbx/poll':       return await handlePoll(body, res);
        case '/rbx/result':     return await handleResult(body, res);
        case '/rbx/tree':       return await handleTree(body, res);
        case '/rbx/activity':   return await handleActivity(body, res);
        case '/rbx/unregister': return await handleUnregister(body, res);
        case '/rbx/health':     return sendJson(res, 200, { ok: true, service: 'rbx-bridge', alive: alive() });
        default:
          sendJson(res, 404, { ok: false, error: `no route: ${req.method} ${url.pathname}` });
      }
    } catch (e: any) {
      sendJson(res, 500, { ok: false, error: String(e?.message ?? e) });
    }
  });

  if (g.__rbxServer) { try { g.__rbxServer.close(); } catch { /* already closed */ } }
  g.__rbxServer = server;
  server.on('error', (err: any) => {
    if (err?.code === 'EADDRINUSE') {
      console.error(`[rbx] port ${RBX_PORT} is already in use — the Roblox bridge HTTP API could not start. Is another agent-service instance running?`);
    } else {
      console.error('[rbx] server error:', err);
    }
  });
  server.listen(RBX_PORT, '127.0.0.1', () => {
    console.log(`Roblox Studio bridge listening on http://127.0.0.1:${RBX_PORT} (gateway: /rbx/*?XTransformPort=${RBX_PORT})`);
  });

  return { alive, info, execTool, requestTree, evict };
}
