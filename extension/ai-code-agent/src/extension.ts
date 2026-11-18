/**
 * AI Code Agent — Z.ai Workspace Bridge extension (v0.5.0)
 *
 * Wire protocol (identical to ai-code-agent 0.3.1/0.4.0 — see
 * mini-services/agent-service/index.ts):
 *
 *   VSCode → server : hello {role:"vscode", workspaceName, workspaceId, secret}
 *                     chat:send {text} · stop · session:clear
 *                     tool:result {callId, ok, result, meta?}
 *                     workspace:info {name, stats}
 *                     workspace:tree {name, tree, stats}
 *                     fs:event {events, ts}
 *   Server → VSCode : vscode:registered · vscode:rejected · vscode:evicted
 *                     pair:code · status · chat:user · agent:* · tool:call
 *                     tool:exec {id, name, args} · fs:refresh
 *
 * The socket URL is always `<serverUrl>/?XTransformPort=<port>` — the Caddy
 * gateway routes by query parameter, never by port.
 */

import * as vscode from 'vscode';
import { io, type Socket } from 'socket.io-client';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

const ID_KEY = 'aiCodeAgent.workspaceId';
const SECRET_KEY = 'aiCodeAgent.workspaceSecret';

/** Folder names never walked/published/listed (matches the bridge expectations). */
const IGNORED_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '.cache', '__pycache__',
  'venv', '.venv', '.vscode-test', '.turbo', 'coverage', '.nyc_output',
  '.parcel-cache', '.svelte-kit', 'target', '.gradle', '.idea', '.svn',
]);

const TREE_NODE_CAP = 3000;          // max nodes in the published workspace tree
const LIST_DEFAULT_MAX = 200;
const LIST_HARD_MAX = 500;
const READ_CHAR_CAP = 1_500_000;
const RUN_OUTPUT_CAP = 60_000;
const SEARCH_RESULT_CAP = 300;
const DIAGNOSTIC_LINE_CAP = 300;

type ConnState = 'disconnected' | 'connecting' | 'connected' | 'rejected' | 'evicted';

/* ------------------------------------------------------------------ */
/* Module state                                                        */
/* ------------------------------------------------------------------ */

let ctx: vscode.ExtensionContext;
let socket: Socket | null = null;
let connState: ConnState = 'disconnected';
let pairingCode: string | null = null;
let persistentIdentity = false;
let workspaceLabel = 'workspace';
let manualDisconnect = false;
let shownConnectedOnce = false;
let lastConnectErrorLog = 0;
let treePublishTimer: ReturnType<typeof setTimeout> | null = null;

let output: vscode.OutputChannel;
let statusBar: vscode.StatusBarItem;
let panel: BridgePanel | null = null;

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

function config(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration('aiCodeAgent');
}

function serverUrl(): string {
  return String(config().get('serverUrl') ?? '').trim().replace(/\/+$/, '');
}

function bridgePort(): number {
  const n = Number(config().get('bridgePort'));
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 3003;
}

function rootPath(): string | null {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? null;
}

function relPathOf(absPath: string): string {
  const root = rootPath();
  if (!root) return absPath;
  return path.relative(root, absPath).split(path.sep).join('/');
}

/** Resolve a workspace-relative path, or null when it escapes the workspace. */
function safeJoin(rel: string | undefined | null): string | null {
  const root = rootPath();
  if (!root) return null;
  const r = String(rel ?? '');
  const p = path.resolve(root, r);
  if (p !== root && !p.startsWith(root + path.sep)) return null;
  return p;
}

function log(line: string): void {
  output.appendLine(line);
}

function refreshUi(): void {
  // Status bar
  const tip = new vscode.MarkdownString();
  switch (connState) {
    case 'connected':
      statusBar.text = pairingCode
        ? `$(plug) AIA ${pairingCode}`
        : `$(plug) AIA · ${workspaceLabel}`;
      statusBar.tooltip = `Connected to the bridge as "${workspaceLabel}".` +
        (pairingCode ? `\nPairing code: ${pairingCode} (enter on the dashboard to pair a browser)` : '');
      break;
    case 'connecting':
      statusBar.text = '$(sync~spin) AIA connecting…';
      statusBar.tooltip = 'Connecting to the bridge…';
      break;
    case 'rejected':
      statusBar.text = '$(warning) AIA rejected';
      statusBar.tooltip = 'The bridge rejected this connection (see output).';
      break;
    case 'evicted':
      statusBar.text = '$(warning) AIA evicted';
      statusBar.tooltip = 'Another VS Code window took over this bridge connection.';
      break;
    default:
      statusBar.text = '$(plug) AIA off';
      statusBar.tooltip = 'Bridge disconnected. Click to connect.';
      break;
  }
  tip.value = String(statusBar.tooltip ?? '');
  statusBar.tooltip = tip;
  statusBar.color = connState === 'rejected' || connState === 'evicted'
    ? new vscode.ThemeColor('statusBarItem.warningForeground')
    : undefined;
  statusBar.show();
  panel?.fire();
}

/* ------------------------------------------------------------------ */
/* Connection                                                          */
/* ------------------------------------------------------------------ */

async function sendHello(s: Socket): Promise<void> {
  const name = vscode.workspace.workspaceFolders?.[0]?.name
    ?? vscode.workspace.name
    ?? 'workspace';
  workspaceLabel = name;
  let id = await ctx.secrets.get(ID_KEY);
  let secret = await ctx.secrets.get(SECRET_KEY);
  if (!id || !secret) {
    // Fresh machine: generate a new identity. The bridge will re-pair its
    // workspace slot (activity journal on the server resets) unless the user
    // ran "Set Workspace Identity" with their previous id + secret.
    id = crypto.randomUUID();
    secret = crypto.randomUUID();
    await ctx.secrets.store(ID_KEY, id);
    await ctx.secrets.store(SECRET_KEY, secret);
    persistentIdentity = false;
    log('[identity] generated a fresh workspace identity (use "Set Workspace Identity" to restore a previous one)');
  } else {
    persistentIdentity = true;
  }
  s.emit('hello', { role: 'vscode', workspaceName: name, workspaceId: id, secret }, () => {});
}

function connect(): void {
  const root = rootPath();
  if (!root) {
    vscode.window.showWarningMessage('AI Code Agent: open a folder (your workspace) first, then connect.');
    return;
  }
  const base = serverUrl();
  if (!base) {
    vscode.window
      .showWarningMessage('AI Code Agent: no server URL configured. Set "AI Code Agent: Server URL" first.', 'Open Settings')
      .then((pick) => { if (pick === 'Open Settings') void vscode.commands.executeCommand('aiCodeAgent.openSettings'); });
    return;
  }
  if (socket) {
    manualDisconnect = true;
    socket.close();
    socket = null;
    manualDisconnect = false;
  }
  connState = 'connecting';
  shownConnectedOnce = false;
  refreshUi();

  const url = `${base}/?XTransformPort=${bridgePort()}`;
  log(`[conn] connecting to ${url}`);
  const s = io(url, {
    transports: ['websocket', 'polling'],
    forceNew: true,
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1500,
    timeout: 20000,
  });
  socket = s;

  s.on('connect', () => {
    log('[conn] socket connected — sending hello');
    void sendHello(s);
  });

  s.on('connect_error', (err: Error) => {
    connState = 'connecting';
    const now = Date.now();
    if (now - lastConnectErrorLog > 60_000) {
      lastConnectErrorLog = now;
      log(`[conn] error: ${err.message}`);
    }
    refreshUi();
  });

  s.on('disconnect', (reason: string) => {
    if (manualDisconnect) return;
    connState = 'connecting';
    log(`[conn] socket dropped (${reason}) — reconnecting…`);
    refreshUi();
  });

  /* ---- registration lifecycle ---- */

  s.on('vscode:registered', (d: any) => {
    connState = 'connected';
    persistentIdentity = !!d?.persistent;
    log(`[conn] registered as "${d?.name}" (persistent=${!!d?.persistent})`);
    refreshUi();
    if (!shownConnectedOnce) {
      shownConnectedOnce = true;
      vscode.window.showInformationMessage(
        `AI Code Agent: workspace "${d?.name}" connected to the bridge${d?.persistent ? ' — identity persisted, journal kept' : ''}.`,
      );
    }
    publishTreeSoon(0);
  });

  s.on('vscode:rejected', (d: any) => {
    connState = 'rejected';
    log(`[conn] rejected: ${d?.reason}`);
    manualDisconnect = true;
    s.close();
    manualDisconnect = false;
    socket = null;
    refreshUi();
    vscode.window.showErrorMessage(`AI Code Agent: bridge rejected the connection — ${d?.reason}`);
  });

  s.on('vscode:evicted', (d: any) => {
    connState = 'evicted';
    log(`[conn] evicted: ${d?.reason}`);
    manualDisconnect = true;
    s.close();
    manualDisconnect = false;
    socket = null;
    refreshUi();
    vscode.window.showWarningMessage('AI Code Agent: another VS Code window took over this bridge connection.');
  });

  s.on('pair:code', (d: any) => {
    pairingCode = d?.code ? String(d.code).toUpperCase() : null;
    refreshUi();
  });

  s.on('status', (_d: any) => {
    refreshUi();
  });

  s.on('fs:refresh', () => {
    publishTreeSoon(0);
  });

  /* ---- tool execution ---- */

  s.on('tool:exec', async (d: any) => {
    const callId = d?.id;
    const name = String(d?.name ?? '');
    if (callId === undefined || callId === null) return;
    log(`[tool] ← ${name} ${safeJson(d?.args)}`);
    const r = await runTool(name, d?.args);
    log(`[tool] → ${name} ${r.ok ? 'ok' : 'FAILED'} (${r.result.length} chars)`);
    s.emit('tool:result', { callId, ok: r.ok, result: r.result, meta: r.meta });
  });

  /* ---- chat / agent display ---- */

  s.on('chat:user', (d: any) => log(`> (${d?.from}) ${d?.text}`));
  s.on('agent:text', (d: any) => log(`AGENT: ${d?.text}${d?.final ? ' (final)' : ''}`));
  s.on('agent:note', (d: any) => log(`agent: ${d?.text}`));
  s.on('agent:round', (d: any) => log(`agent: round ${d?.round}/${d?.max}`));
  s.on('agent:busy', () => log('agent: busy…'));
  s.on('agent:done', () => log('agent: done'));
  s.on('agent:error', (d: any) => log(`agent ERROR: ${d?.message}`));
  s.on('tool:call', (d: any) => log(`[tool] ${d?.name} ${safeJson(d?.args)}`));
  s.on('session:cleared', () => log('[chat] session cleared'));

  refreshUi();
}

function disconnect(): void {
  if (!socket) {
    connState = 'disconnected';
    refreshUi();
    return;
  }
  manualDisconnect = true;
  socket.close();
  socket = null;
  manualDisconnect = false;
  connState = 'disconnected';
  pairingCode = null;
  log('[conn] disconnected');
  refreshUi();
}

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v ?? {}).slice(0, 200);
  } catch {
    return String(v);
  }
}

/* ------------------------------------------------------------------ */
/* Workspace tree publication                                          */
/* ------------------------------------------------------------------ */

interface TreeNode {
  name: string;
  path: string;
  type: 'dir' | 'file';
  size: number | null;
  children: TreeNode[];
}

function publishTreeSoon(delayMs = 2500): void {
  if (treePublishTimer) return;
  treePublishTimer = setTimeout(() => {
    treePublishTimer = null;
    publishTree();
  }, delayMs);
}

function publishTree(): void {
  const root = rootPath();
  if (!root || !socket || !socket.connected) return;
  const { tree, stats } = buildTree(root);
  socket.emit('workspace:tree', { name: workspaceLabel, tree, stats });
  socket.emit('workspace:info', { name: workspaceLabel, stats });
}

function buildTree(root: string): { tree: TreeNode; stats: Record<string, unknown> } {
  const rootNode: TreeNode = { name: workspaceLabel, path: '', type: 'dir', size: null, children: [] };
  let files = 0, dirs = 0, totalBytes = 0, nodes = 1, truncated = false;

  const walk = (abs: string, rel: string, parent: TreeNode): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(abs, { withFileTypes: true });
    } catch {
      return;
    }
    // Sort: dirs first, then case-insensitive names.
    entries.sort((a, b) => {
      const ad = a.isDirectory(), bd = b.isDirectory();
      if (ad !== bd) return ad ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const e of entries) {
      if (nodes >= TREE_NODE_CAP) { truncated = true; return; }
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (IGNORED_DIRS.has(e.name)) continue;
        nodes++; dirs++;
        const node: TreeNode = { name: e.name, path: childRel, type: 'dir', size: null, children: [] };
        parent.children.push(node);
        walk(path.join(abs, e.name), childRel, node);
      } else {
        nodes++; files++;
        let size: number | null = null;
        try { size = fs.statSync(path.join(abs, e.name)).size; totalBytes += size ?? 0; } catch { /* ignore */ }
        parent.children.push({ name: e.name, path: childRel, type: 'file', size, children: [] });
      }
    }
  };

  try {
    walk(root, '', rootNode);
  } catch { /* ignore */ }

  const stats = {
    files, dirs, totalBytes, nodes, truncated,
    scannedAt: new Date().toISOString(),
  };
  return { tree: rootNode, stats };
}

/* ------------------------------------------------------------------ */
/* File watcher → fs:event                                            */
/* ------------------------------------------------------------------ */

const pendingFsEvents = new Map<string, { type: string; path: string }>();
let fsFlushTimer: ReturnType<typeof setTimeout> | null = null;

function queueFsEvent(type: 'created' | 'changed' | 'deleted', uri: vscode.Uri): void {
  const rel = relPathOf(uri.fsPath);
  if (!rel) return;
  const key = `${type}:${rel}`;
  if (!pendingFsEvents.has(key)) {
    pendingFsEvents.set(key, { type, path: rel });
  }
  if (fsFlushTimer) return;
  fsFlushTimer = setTimeout(() => {
    fsFlushTimer = null;
    const events = [...pendingFsEvents.values()].slice(0, 100);
    pendingFsEvents.clear();
    if (events.length && socket && socket.connected) {
      socket.emit('fs:event', { events, ts: Date.now() });
    }
    publishTreeSoon(3000); // keep the dashboard tree fresh after local edits
  }, 900);
}

/* ------------------------------------------------------------------ */
/* Tool execution                                                      */
/* ------------------------------------------------------------------ */

interface ToolResult {
  ok: boolean;
  result: string;
  meta?: Record<string, unknown>;
}

function fail(msg: string): ToolResult {
  return { ok: false, result: msg };
}

async function runTool(name: string, args: any): Promise<ToolResult> {
  try {
    switch (name) {
      case 'list_files': return listFiles(args);
      case 'read_file': return readFileTool(args);
      case 'write_file': return writeFileTool(args);
      case 'edit_file': return editFileTool(args);
      case 'delete_file': return await deleteFileTool(args);
      case 'create_directory': return createDirectoryTool(args);
      case 'move_path': return movePathTool(args);
      case 'search_code': return searchCodeTool(args);
      case 'run_command': return await runCommandTool(args);
      case 'get_diagnostics': return getDiagnosticsTool();
      default: return fail(`Unknown tool "${name}".`);
    }
  } catch (e: unknown) {
    return fail(`${name} failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/* ---- list_files ---- */

function listFiles(args: any): ToolResult {
  const root = rootPath();
  if (!root) return fail('No workspace folder is open in VS Code.');
  const subRel = args?.path ? String(args.path) : '';
  const subAbs = subRel ? safeJoin(subRel) : root;
  if (!subAbs) return fail(`Path escapes the workspace: ${subRel}`);
  if (!fs.existsSync(subAbs)) return fail(`Folder not found: ${subRel || '(workspace root)'}`);
  if (!fs.statSync(subAbs).isDirectory()) return fail(`Not a folder: ${subRel}`);

  const want = Math.min(Math.max(1, Number(args?.max_files) || LIST_DEFAULT_MAX), LIST_HARD_MAX);
  const lines: string[] = [];
  let count = 0;
  const walk = (abs: string, rel: string): void => {
    if (count >= want) return;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(abs, { withFileTypes: true }); } catch { return; }
    entries.sort((a, b) => {
      const ad = a.isDirectory(), bd = b.isDirectory();
      if (ad !== bd) return ad ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const e of entries) {
      if (count >= want) return;
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (IGNORED_DIRS.has(e.name)) continue;
        lines.push(`${childRel}/`);
        count++;
        walk(path.join(abs, e.name), childRel);
      } else {
        lines.push(childRel);
        count++;
      }
    }
  };
  walk(subAbs, subRel.replace(/^\/+|\/+$/g, ''));
  if (count === 0) {
    return { ok: true, result: `No files found in "${subRel || workspaceLabel}" (empty or fully ignored).` };
  }
  const header = `Workspace "${workspaceLabel}" — ${count} entries`;
  return { ok: true, result: [header, ...lines].join('\n'), meta: { entries: count, scoped: subRel || null } };
}

/* ---- read_file ---- */

function readFileTool(args: any): ToolResult {
  const rel = String(args?.path ?? '');
  const abs = safeJoin(rel);
  if (!abs) return fail(`Path escapes the workspace: ${rel}`);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return fail(`File not found: ${rel}`);
  const buf = fs.readFileSync(abs);
  if (buf.subarray(0, 8000).includes(0)) {
    return fail(`"${rel}" is a binary file (${buf.length} bytes) — raw content not returned.`);
  }
  const text = buf.toString('utf8');
  if (text.length > READ_CHAR_CAP) {
    return {
      ok: true,
      result: `${text.slice(0, READ_CHAR_CAP)}\n\n… [truncated: file has ${text.length} chars, first ${READ_CHAR_CAP} shown]`,
      meta: { path: rel, truncated: true },
    };
  }
  return { ok: true, result: text, meta: { path: rel, chars: text.length } };
}

/* ---- write_file ---- */

function writeFileTool(args: any): ToolResult {
  const rel = String(args?.path ?? '');
  const content = String(args?.content ?? '');
  const abs = safeJoin(rel);
  if (!abs) return fail(`Path escapes the workspace: ${rel}`);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
  publishTreeSoon();
  return { ok: true, result: `Wrote ${content.length} chars to ${rel}`, meta: { path: rel, chars: content.length } };
}

/* ---- edit_file ---- */

function editFileTool(args: any): ToolResult {
  const rel = String(args?.path ?? '');
  const oldStr = String(args?.old_string ?? '');
  const newStr = String(args?.new_string ?? '');
  const replaceAll = !!args?.replace_all;
  const abs = safeJoin(rel);
  if (!abs) return fail(`Path escapes the workspace: ${rel}`);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return fail(`File not found: ${rel}`);
  if (oldStr === '') return fail('old_string is empty — provide the exact text to replace.');
  if (oldStr === newStr) return fail('old_string and new_string are identical.');

  const text = fs.readFileSync(abs, 'utf8');
  let occurrences = 0;
  let idx = text.indexOf(oldStr);
  while (idx !== -1) { occurrences++; idx = text.indexOf(oldStr, idx + oldStr.length); }
  if (occurrences === 0) {
    return fail(`old_string not found in ${rel} — read the file and copy the exact text (whitespace matters).`);
  }
  if (occurrences > 1 && !replaceAll) {
    return fail(`old_string matches ${occurrences} places in ${rel} — add surrounding context to make it unique, or set replace_all=true.`);
  }
  const next = replaceAll
    ? text.split(oldStr).join(newStr)
    : text.replace(oldStr, newStr);
  fs.writeFileSync(abs, next);
  publishTreeSoon();
  return {
    ok: true,
    result: `Replaced ${replaceAll ? occurrences : 1} occurrence(s) in ${rel}`,
    meta: { path: rel, replacements: replaceAll ? occurrences : 1 },
  };
}

/* ---- delete_file ---- */

async function deleteFileTool(args: any): Promise<ToolResult> {
  const rel = String(args?.path ?? '');
  const abs = safeJoin(rel);
  if (!abs) return fail(`Path escapes the workspace: ${rel}`);
  if (!fs.existsSync(abs)) return fail(`Not found: ${rel}`);
  const isDir = fs.statSync(abs).isDirectory();
  try {
    await vscode.workspace.fs.delete(vscode.Uri.file(abs), { useTrash: true });
    publishTreeSoon();
    return { ok: true, result: `${isDir ? 'Folder' : 'File'} moved to trash: ${rel}`, meta: { path: rel, trashed: true } };
  } catch {
    try {
      fs.rmSync(abs, { recursive: true });
      publishTreeSoon();
      return { ok: true, result: `Deleted (not recoverable): ${rel}`, meta: { path: rel, trashed: false } };
    } catch (e: unknown) {
      return fail(`Could not delete ${rel}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}

/* ---- create_directory ---- */

function createDirectoryTool(args: any): ToolResult {
  const rel = String(args?.path ?? '');
  const abs = safeJoin(rel);
  if (!abs) return fail(`Path escapes the workspace: ${rel}`);
  fs.mkdirSync(abs, { recursive: true });
  publishTreeSoon();
  return { ok: true, result: `Created directory ${rel}`, meta: { path: rel } };
}

/* ---- move_path ---- */

function movePathTool(args: any): ToolResult {
  const fromRel = String(args?.from ?? '');
  const toRel = String(args?.to ?? '');
  const from = safeJoin(fromRel);
  const to = safeJoin(toRel);
  if (!from || !to) return fail(`Path escapes the workspace: ${!from ? fromRel : toRel}`);
  if (!fs.existsSync(from)) return fail(`Source not found: ${fromRel}`);
  if (fs.existsSync(to)) return fail(`Destination already exists: ${toRel}`);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.renameSync(from, to);
  publishTreeSoon();
  return { ok: true, result: `Moved ${fromRel} → ${toRel}`, meta: { from: fromRel, to: toRel } };
}

/* ---- search_code ---- */

function globToRegExp(glob: string): RegExp {
  let src = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        // "**" — any chars incl. separators; consume extra '*'
        while (glob[i + 1] === '*') i++;
        src += '.*';
      } else {
        src += '[^/]*';
      }
    } else if (c === '?') {
      src += '[^/]';
    } else {
      src += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${src}$`);
}

function searchCodeTool(args: any): ToolResult {
  const query = String(args?.query ?? '');
  if (!query) return fail('No search query given.');
  const include = args?.include ? String(args.include) : null;
  const isRegex = !!args?.is_regex;
  let re: RegExp;
  if (isRegex) {
    try { re = new RegExp(query); }
    catch (e: unknown) { return fail(`Invalid regex: ${e instanceof Error ? e.message : String(e)}`); }
  } else {
    const esc = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    re = new RegExp(esc);
  }
  const includeRe = include ? globToRegExp(include) : null;

  const root = rootPath();
  if (!root) return fail('No workspace folder is open in VS Code.');

  const lines: string[] = [];
  let matches = 0;
  let scanned = 0;
  const walk = (abs: string): void => {
    if (matches >= SEARCH_RESULT_CAP) return;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(abs, { withFileTypes: true }); } catch { return; }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      if (matches >= SEARCH_RESULT_CAP) return;
      const childAbs = path.join(abs, e.name);
      if (e.isDirectory()) {
        if (IGNORED_DIRS.has(e.name)) continue;
        walk(childAbs);
      } else {
        if (includeRe) {
          const rel = relPathOf(childAbs);
          if (!includeRe.test(rel)) continue;
        }
        scanned++;
        let st: fs.Stats;
        try { st = fs.statSync(childAbs); } catch { continue; }
        if (st.size > 1_500_000) continue;
        let buf: Buffer;
        try { buf = fs.readFileSync(childAbs); } catch { continue; }
        if (buf.subarray(0, 8000).includes(0)) continue; // binary
        const text = buf.toString('utf8');
        const fileLines = text.split('\n');
        for (let i = 0; i < fileLines.length; i++) {
          if (re.test(fileLines[i])) {
            matches++;
            lines.push(`${relPathOf(childAbs)}:${i + 1}: ${fileLines[i].trim().slice(0, 200)}`);
            if (matches >= SEARCH_RESULT_CAP) {
              lines.push(`… [stopped at ${SEARCH_RESULT_CAP} matches]`);
              return;
            }
          }
        }
      }
    }
  };
  walk(root);

  if (matches === 0) {
    return { ok: true, result: `No matches for ${isRegex ? `/${query}/` : `"${query}"`}${include ? ` in ${include}` : ''} (scanned ${scanned} files).` };
  }
  const summary = `${matches} match(es) for ${isRegex ? `/${query}/` : `"${query}"`}${include ? ` · include ${include}` : ''}:`;
  return { ok: true, result: [summary, ...lines].join('\n'), meta: { matches, scannedFiles: scanned } };
}

/* ---- run_command ---- */

async function runCommandTool(args: any): Promise<ToolResult> {
  const command = String(args?.command ?? '').trim();
  if (!command) return fail('No command given.');
  const root = rootPath();
  if (!root) return fail('No workspace folder is open in VS Code.');
  const timeoutMs = Math.min(Math.max(Number(args?.timeout_ms) || 120_000, 5_000), 195_000);

  return new Promise<ToolResult>((resolve) => {
    const isWin = os.platform() === 'win32';
    const shell = isWin ? 'powershell.exe' : '/bin/bash';
    const shellArgs = isWin ? ['-NoProfile', '-NonInteractive', '-Command', command] : ['-c', command];

    let out = '';
    let killed = false;
    const child = spawn(shell, shellArgs, { cwd: root });

    const append = (chunk: Buffer | string): void => {
      if (out.length < RUN_OUTPUT_CAP * 2) out += chunk.toString('utf8');
    };
    child.stdout?.on('data', append);
    child.stderr?.on('data', append);

    const timer = setTimeout(() => {
      killed = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve(fail(`Failed to spawn ${shell}: ${err.message}`));
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      let result = `$ ${command}\n`;
      if (out.length > RUN_OUTPUT_CAP) {
        result += `${out.slice(0, RUN_OUTPUT_CAP)}\n… [output truncated — ${out.length} chars total]`;
      } else {
        result += out.trimEnd();
      }
      result += killed
        ? `\n[terminated: exceeded ${Math.round(timeoutMs / 1000)}s timeout]`
        : `\nexit code: ${code === null ? 'n/a' : code}`;
      resolve({ ok: !killed && (code === 0 || code === null), result, meta: { exitCode: code, timedOut: killed } });
    });
  });
}

/* ---- get_diagnostics ---- */

function getDiagnosticsTool(): ToolResult {
  const all = vscode.languages.getDiagnostics();
  const lines: string[] = [];
  let errors = 0, warnings = 0;
  for (const [uri, diags] of all) {
    for (const d of diags) {
      if (d.severity === vscode.DiagnosticSeverity.Error) errors++;
      else if (d.severity === vscode.DiagnosticSeverity.Warning) warnings++;
      else continue;
      if (lines.length < DIAGNOSTIC_LINE_CAP) {
        const rel = uri.scheme === 'file' ? relPathOf(uri.fsPath) : uri.toString();
        lines.push(`${rel}:${d.range.start.line + 1}:${d.range.start.character + 1}: ${d.severity === vscode.DiagnosticSeverity.Error ? 'error' : 'warning'} — ${d.message}${d.source ? ` [${d.source}]` : ''}`);
      }
    }
  }
  if (lines.length === 0) {
    return { ok: true, result: 'No errors or warnings reported by VS Code right now.', meta: { errors: 0, warnings: 0 } };
  }
  const summary = `Diagnostics: ${errors} error(s), ${warnings} warning(s)${lines.length >= DIAGNOSTIC_LINE_CAP ? ` (showing first ${DIAGNOSTIC_LINE_CAP})` : ''}`;
  return { ok: true, result: [summary, ...lines].join('\n'), meta: { errors, warnings } };
}

/* ------------------------------------------------------------------ */
/* Bridge panel (tree view in the activity bar)                        */
/* ------------------------------------------------------------------ */

class BridgePanel implements vscode.TreeDataProvider<vscode.TreeItem> {
  private emitter = new vscode.EventEmitter<vscode.TreeItem | undefined | null>();
  public readonly onDidChangeTreeData = this.event;

  get event() { return this.emitter.event; }

  public fire(): void {
    this.emitter.fire(undefined);
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(): vscode.TreeItem[] {
    const items: vscode.TreeItem[] = [];

    // Connection state
    const state = new vscode.TreeItem('Connection');
    switch (connState) {
      case 'connected':
        state.label = `Connected — "${workspaceLabel}"`;
        state.iconPath = new vscode.ThemeIcon('check');
        state.description = persistentIdentity ? 'persistent identity' : 'fresh identity';
        break;
      case 'connecting':
        state.label = 'Connecting…';
        state.iconPath = new vscode.ThemeIcon('sync~spin');
        break;
      case 'rejected':
        state.label = 'Rejected by bridge';
        state.iconPath = new vscode.ThemeIcon('error');
        break;
      case 'evicted':
        state.label = 'Evicted (other window took over)';
        state.iconPath = new vscode.ThemeIcon('warning');
        break;
      default:
        state.label = 'Disconnected';
        state.iconPath = new vscode.ThemeIcon('circle-slash');
        break;
    }
    state.tooltip = 'Click to connect/disconnect.';
    state.command = { command: 'aiCodeAgent.toggle', title: 'Connect or Disconnect' };
    state.collapsibleState = vscode.TreeItemCollapsibleState.None;
    items.push(state);

    // Pairing code — what the user types into the dashboard.
    const code = new vscode.TreeItem('Pairing code');
    code.description = pairingCode ?? '— appears when connected';
    code.iconPath = new vscode.ThemeIcon('key');
    code.tooltip = new vscode.MarkdownString(
      'Enter this code on the bridge dashboard to pair your browser.\n\nClick to copy.',
    );
    code.command = { command: 'aiCodeAgent.copyPairingCode', title: 'Copy Pairing Code' };
    code.collapsibleState = vscode.TreeItemCollapsibleState.None;
    items.push(code);

    // Server
    const base = serverUrl();
    const server = new vscode.TreeItem('Server');
    server.description = base || 'not set';
    server.iconPath = new vscode.ThemeIcon('globe');
    server.tooltip = 'The bridge base URL (aiCodeAgent.serverUrl). Click to open settings.';
    server.command = { command: 'aiCodeAgent.openSettings', title: 'Open Settings' };
    server.collapsibleState = vscode.TreeItemCollapsibleState.None;
    items.push(server);

    // Identity
    const identity = new vscode.TreeItem('Workspace identity');
    identity.description = persistentIdentity ? 'custom (persistent)' : 'auto-generated';
    identity.iconPath = new vscode.ThemeIcon('fingerprint');
    identity.tooltip = new vscode.MarkdownString(
      persistentIdentity
        ? 'A custom workspace ID + secret is stored. The bridge recognizes this workspace and keeps its activity journal.\n\nClick to change it.'
        : 'No custom identity set — the bridge re-pairs its workspace slot on connect and the server activity journal resets.\n\n**Set the identity from your previous setup to keep the journal.** Click to set it.',
    );
    identity.command = { command: 'aiCodeAgent.setIdentity', title: 'Set Workspace Identity…' };
    identity.collapsibleState = vscode.TreeItemCollapsibleState.None;
    items.push(identity);

    // Actions
    const msg = new vscode.TreeItem('Send message to the bridge chat');
    msg.iconPath = new vscode.ThemeIcon('comment');
    msg.command = { command: 'aiCodeAgent.sendMessage', title: 'Send Message…' };
    msg.collapsibleState = vscode.TreeItemCollapsibleState.None;
    if (connState === 'connected') items.push(msg);

    return items;
  }
}

/* ------------------------------------------------------------------ */
/* Commands                                                            */
/* ------------------------------------------------------------------ */

async function cmdSetIdentity(): Promise<void> {
  const currentId = await ctx.secrets.get(ID_KEY);
  const id = await vscode.window.showInputBox({
    prompt: 'Workspace ID (UUID) — from your previous setup / the bridge state',
    placeHolder: 'workspace UUID from the previous setup',
    value: currentId ?? '',
    ignoreFocusOut: true,
  });
  if (id === undefined) return;
  const trimmedId = id.trim();
  if (!trimmedId) {
    vscode.window.showWarningMessage('Workspace ID cannot be empty.');
    return;
  }
  const secret = await vscode.window.showInputBox({
    prompt: 'Workspace secret (UUID) — the paired secret for that ID',
    password: true,
    ignoreFocusOut: true,
  });
  if (secret === undefined) return;
  const trimmedSecret = secret.trim();
  if (!trimmedSecret) {
    vscode.window.showWarningMessage('Workspace secret cannot be empty.');
    return;
  }
  await ctx.secrets.store(ID_KEY, trimmedId);
  await ctx.secrets.store(SECRET_KEY, trimmedSecret);
  persistentIdentity = true;
  log('[identity] workspace identity updated');
  refreshUi();
  if (socket?.connected || connState === 'connecting') {
    const reconnect = await vscode.window.showInformationMessage(
      'Workspace identity saved. Reconnect now so the bridge recognizes it?',
      'Reconnect', 'Later',
    );
    if (reconnect === 'Reconnect') connect();
  } else {
    vscode.window.showInformationMessage('Workspace identity saved.');
  }
}

async function cmdClearIdentity(): Promise<void> {
  const pick = await vscode.window.showWarningMessage(
    'Clear the stored workspace identity? The next connect generates a fresh one and the bridge re-pairs its workspace slot (the dashboard activity journal on the server resets).',
    { modal: true },
    'Clear it',
  );
  if (pick !== 'Clear it') return;
  await ctx.secrets.delete(ID_KEY);
  await ctx.secrets.delete(SECRET_KEY);
  persistentIdentity = false;
  log('[identity] cleared');
  refreshUi();
  vscode.window.showInformationMessage('Workspace identity cleared.');
}

async function cmdSendMessage(): Promise<void> {
  if (!socket?.connected) {
    vscode.window.showWarningMessage('AI Code Agent: not connected.');
    return;
  }
  const text = await vscode.window.showInputBox({
    prompt: 'Message to send to the bridge chat',
    ignoreFocusOut: true,
  });
  if (text === undefined || text.trim() === '') return;
  socket.emit('chat:send', { text: text.trim() });
  log(`> (vscode-you) ${text.trim()}`);
}

async function cmdCopyPairingCode(): Promise<void> {
  if (!pairingCode) {
    vscode.window.showInformationMessage('AI Code Agent: no pairing code yet — connect first.');
    return;
  }
  await vscode.env.clipboard.writeText(pairingCode);
  vscode.window.showInformationMessage(`Pairing code copied: ${pairingCode}`);
}

function cmdOpenSettings(): void {
  void vscode.commands.executeCommand('workbench.action.openSettings', 'aiCodeAgent');
}

/* ------------------------------------------------------------------ */
/* Entry points                                                        */
/* ------------------------------------------------------------------ */

export function activate(context: vscode.ExtensionContext): void {
  ctx = context;

  output = vscode.window.createOutputChannel('AI Code Agent');
  statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 60);
  statusBar.name = 'AI Code Agent';
  statusBar.command = 'aiCodeAgent.toggle';

  panel = new BridgePanel();
  context.subscriptions.push(
    output,
    statusBar,
    vscode.window.registerTreeDataProvider('aiCodeAgentPanel', panel),
    vscode.commands.registerCommand('aiCodeAgent.connect', () => connect()),
    vscode.commands.registerCommand('aiCodeAgent.disconnect', () => disconnect()),
    vscode.commands.registerCommand('aiCodeAgent.toggle', () => {
      if (connState === 'connected' || connState === 'connecting') disconnect();
      else connect();
    }),
    vscode.commands.registerCommand('aiCodeAgent.sendMessage', () => void cmdSendMessage()),
    vscode.commands.registerCommand('aiCodeAgent.setIdentity', () => void cmdSetIdentity()),
    vscode.commands.registerCommand('aiCodeAgent.clearIdentity', () => void cmdClearIdentity()),
    vscode.commands.registerCommand('aiCodeAgent.copyPairingCode', () => void cmdCopyPairingCode()),
    vscode.commands.registerCommand('aiCodeAgent.openSettings', () => cmdOpenSettings()),
  );

  /* Local file watching → fs:event + tree refresh nudges. */
  const watcher = vscode.workspace.createFileSystemWatcher('**/*');
  context.subscriptions.push(
    watcher,
    watcher.onDidChange((uri) => queueFsEvent('changed', uri)),
    watcher.onDidCreate((uri) => queueFsEvent('created', uri)),
    watcher.onDidDelete((uri) => queueFsEvent('deleted', uri)),
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      workspaceLabel = vscode.workspace.workspaceFolders?.[0]?.name ?? 'workspace';
      publishTreeSoon(0);
      refreshUi();
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('aiCodeAgent.serverUrl') || e.affectsConfiguration('aiCodeAgent.bridgePort')) {
        if (connState === 'connected' || connState === 'connecting') {
          log('[conn] server configuration changed — reconnecting');
          connect();
        } else {
          refreshUi();
        }
      }
    }),
  );

  refreshUi();
  log(`AI Code Agent extension v0.5.0 activated — workspace: ${rootPath() ?? '(no folder open)'}`);

  if (config().get('autoConnect') && serverUrl()) {
    connect();
  }
}

export function deactivate(): void {
  manualDisconnect = true;
  socket?.close();
  socket = null;
  if (treePublishTimer) clearTimeout(treePublishTimer);
  if (fsFlushTimer) clearTimeout(fsFlushTimer);
}
