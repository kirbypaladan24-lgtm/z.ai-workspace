/**
 * agent-service v2 — "Z.ai Workspace Bridge" server.
 *
 * The extension connectivity is UNCHANGED from v1 (ai-code-agent 0.3.1/0.4.0):
 *   VSCode → server : hello {role:"vscode", workspaceName, workspaceId, secret}
 *                     chat:send {text} · stop · session:clear
 *                     tool:result {callId, ok, result, meta?, content?}
 *                     workspace:info {name, stats}      (new, additive)
 *                     workspace:tree {name, tree, stats} (new, additive)
 *                     fs:event {events, ts}              (new, additive)
 *   Server → VSCode : vscode:registered · vscode:rejected · vscode:evicted
 *                     pair:code · status · chat:user · agent:* · tool:call
 *                     tool:exec {id, name, args} · fs:refresh (new, additive)
 *
 * NEW in v2 (observability core):
 *   - Persistent activity journal: every tool run (who, what, args, result,
 *     diff meta, duration) from ANY source — GLM agent, web viewer, operator.
 *   - Workspace mirror: the extension publishes the full file tree; the web
 *     dashboard renders it as a file explorer.
 *   - Web events: file:read, activity:list, activity:clear, tree:refresh.
 *   - Operator admin API on 127.0.0.1:3004 (localhost only — the GLM session
 *     on z.ai web drives the workspace through it, fully observable).
 *   - Skills: the user keeps skill documents in a ".skills/" folder in the
 *     workspace itself (loose files, or a sub-folder per skill with a
 *     SKILL.md). The service discovers them LIVE through the connected
 *     extension (list_files + read_file) at agent-run start and on demand,
 *     injects them into the agent system prompt BEFORE the agent starts
 *     thinking, and lists them for web viewers and the operator
 *     (GET /skills, GET /skill?name=, socket events skill:list / skill:get /
 *     skill:refresh). No upload pipeline — the folder is the single source
 *     of truth.
 *
 * Socket.io path is "/" — the Caddy gateway routes ?XTransformPort=3003 here.
 */
import { createServer, IncomingMessage, ServerResponse } from 'http';
import { Server, Socket } from 'socket.io';
import { randomUUID } from 'crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import ZAI from 'z-ai-web-dev-sdk';

const PORT = parseInt(process.env.AGENT_PORT ?? '3003', 10);
const ADMIN_PORT = parseInt(process.env.AGENT_ADMIN_PORT ?? '3004', 10);
const DATA_DIR = process.env.AGENT_DATA_DIR
  ?? join(dirname(typeof __filename !== 'undefined' ? __filename : process.cwd()), 'data');
const STATE_FILE = join(DATA_DIR, 'state.json');
const ACTIVITY_FILE = join(DATA_DIR, 'activity.json');
const TREE_FILE = join(DATA_DIR, 'tree.json');
const SKILLS_FOLDER = '.skills';               // workspace folder the user drops skill documents into

const MAX_ITERATIONS = 12;
const TOOL_TIMEOUT_MS = 200_000;
const MAX_TOOL_RESULT_DISPLAY = 4000;
const MAX_ACTIVITY = 500;
const MAX_ACTIVITY_ARGS = 1200;
const SKILLS_SCAN_TTL_MS = 15_000;            // rescan at most this often unless forced
const MAX_SKILL_FILES_SCAN = 24;              // files read per .skills/ scan
const MAX_SKILL_FILE_CHARS = 96_000;          // per-file text cap kept for injection
const MAX_SKILLS_PROMPT_CHARS = 32_000;       // total skills text in the system prompt

/* ------------------------------------------------------------------ */
/* Tool definitions — MUST match what the VS Code extension executes.  */
/* ------------------------------------------------------------------ */
const TOOLS = [
  {
    name: 'list_files',
    description:
      'List files and folders in the workspace (relative paths). Optionally scope to a sub-folder. Excludes node_modules/.git/dist etc.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Optional sub-folder to scope the listing to, e.g. "src"' },
        max_files: { type: 'number', description: 'Max entries to return (default 200, max 500)' },
      },
    },
  },
  {
    name: 'read_file',
    description: 'Read the full contents of a file (workspace-relative path). Use this before editing a file.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Workspace-relative file path' } },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description:
      'Create a new file or fully overwrite an existing file with the given content. Parent folders are created automatically.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Workspace-relative file path' },
        content: { type: 'string', description: 'Full new file content' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'edit_file',
    description:
      'Replace an exact text snippet inside a file. `old_string` must match the file content exactly (including whitespace) and should be unique.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Workspace-relative file path' },
        old_string: { type: 'string', description: 'Exact text to find' },
        new_string: { type: 'string', description: 'Replacement text' },
        replace_all: { type: 'boolean', description: 'Replace every occurrence (default false)' },
      },
      required: ['path', 'old_string', 'new_string'],
    },
  },
  {
    name: 'delete_file',
    description: 'Delete a file or folder. When possible it is moved to the OS trash (recoverable).',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Workspace-relative path of file or folder to delete' } },
      required: ['path'],
    },
  },
  {
    name: 'create_directory',
    description: 'Create a folder (including missing parents) in the workspace.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Workspace-relative folder path' } },
      required: ['path'],
    },
  },
  {
    name: 'move_path',
    description: 'Rename or move a file/folder within the workspace.',
    parameters: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Workspace-relative source path' },
        to: { type: 'string', description: 'Workspace-relative destination path' },
      },
      required: ['from', 'to'],
    },
  },
  {
    name: 'search_code',
    description:
      'Search for a text string (or regex) across the workspace. Returns file:line: text matches. Skips node_modules and binaries.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Text or regex pattern to search for' },
        include: { type: 'string', description: 'Optional glob filter, e.g. "src/**/*.ts"' },
        is_regex: { type: 'boolean', description: 'Treat query as a regular expression (default false)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'run_command',
    description:
      'Run a shell command in the workspace root (build / test / install). Output is returned. Use for verification after changes.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Shell command to execute, e.g. "npm test"' },
        timeout_ms: { type: 'number', description: 'Optional timeout in milliseconds' },
      },
      required: ['command'],
    },
  },
  {
    name: 'get_diagnostics',
    description: 'Get the current errors and warnings reported by VS Code across the workspace (compiler/linter problems).',
    parameters: { type: 'object', properties: {} },
  },
];

const SYSTEM_PROMPT = (workspaceName: string) =>
  `You are an autonomous AI coding agent operating on the user's real VS Code workspace "${workspaceName}". ` +
  `You have tools to list, read, write, edit, delete and move files, search code, run shell commands and read VS Code diagnostics. ` +
  `The user may keep skill documents in a ".skills/" folder at the workspace root — always follow them, and re-check that folder with list_files when starting a task or when the user references a skill by name ("use the skill <name>"). ` +
  `Work step by step: explore first (list_files / search_code / read_file), then make changes, then verify (run_command / get_diagnostics). ` +
  `When you produce tool calls, also include one short sentence saying what you are about to do. ` +
  `Your tool activity is shown live to the user in both VS Code and the web page. Keep final answers concise and actionable.`;

const UNPAIRED_SYSTEM_PROMPT = (workspaceName: string) =>
  `You are a chat assistant for the AI Code Agent service bound to workspace "${workspaceName}". ` +
  `IMPORTANT: This browser is NOT paired with the workspace, so you have NO tools in this conversation — you cannot list, read, modify or delete any files. ` +
  `Never pretend to execute tools, never output tool-call syntax or fake results, and never claim you performed an action. ` +
  `If the user asks for file operations, briefly explain that pairing is required: the 6-character code shown in the VS Code connector panel unlocks full agent capabilities.`;

/* ------------------------------------------------------------------ */
/* Persistent state (survives service restarts)                       */
/* ------------------------------------------------------------------ */
interface WorkspaceIdentity {
  workspaceId: string;
  secret: string;
  name: string;
  pairingCode: string;
  webTokens: string[];
}

interface QueuedMessage {
  text: string;
  from: string;
  ts: number;
}

interface State {
  workspace: WorkspaceIdentity | null;
  history: any[];
  queue?: QueuedMessage[];
}

interface ActivityEntry {
  id: string;
  ts: number;
  source: 'operator' | 'web' | 'vscode' | 'local' | 'system';
  actor: string;
  kind: 'tool' | 'note' | 'fs' | 'conn' | 'skill';
  tool?: string;
  fsType?: 'created' | 'changed' | 'deleted';
  path?: string;
  args?: any;
  ok?: boolean;
  result?: string;
  meta?: any;
  durMs?: number;
  text?: string;
}

interface TreeStats {
  files: number;
  dirs: number;
  totalBytes: number;
  nodes: number;
  truncated: boolean;
  scannedAt: string;
}

function loadJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

function saveJson(file: string, data: unknown): void {
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(file, JSON.stringify(data));
  } catch (e) {
    console.error('[state] save failed:', e);
  }
}

const state: State = (() => {
  const s = loadJson<State>(STATE_FILE, { workspace: null, history: [] });
  if (!s.workspace) s.workspace = null;
  if (!Array.isArray(s.history)) s.history = [];
  return s;
})();
const queue: QueuedMessage[] = Array.isArray((state as any).queue) ? (state as any).queue : [];

const activity: ActivityEntry[] = loadJson<ActivityEntry[]>(ACTIVITY_FILE, []);

let treeCache: { name: string; tree: any; stats: TreeStats } | null = loadJson<any | null>(TREE_FILE, null);
let treeCacheBytes = 0;
try {
  treeCacheBytes = treeCache ? JSON.stringify(treeCache).length : 0;
  if (treeCacheBytes > 2_500_000) { treeCache = null; treeCacheBytes = 0; }
} catch { treeCache = null; }

function persistState() {
  (state as any).queue = queue;
  saveJson(STATE_FILE, state);
}

function persistActivity() {
  saveJson(ACTIVITY_FILE, activity.slice(-MAX_ACTIVITY));
}

function persistTree() {
  try {
    if (treeCache && JSON.stringify(treeCache).length <= 2_500_000) {
      saveJson(TREE_FILE, treeCache);
    }
  } catch { /* too big — skip */ }
}

/* ------------------------------------------------------------------ */
/* Skills — the user keeps skill documents in the ".skills/" folder    */
/* of the workspace itself. The service discovers them live through    */
/* the connected VS Code extension (list_files + read_file) and        */
/* injects them into the agent system prompt BEFORE the agent starts   */
/* thinking. The folder is the single source of truth — no uploads.    */
/* ------------------------------------------------------------------ */

interface SkillFileMeta {
  path: string; // package-relative path
  size: number;
  main?: boolean; // the package entry point (SKILL.md / README.md / first .md)
}

interface WorkspaceSkill {
  name: string; // display name: file name, or package folder name
  path: string; // entry file, workspace-relative (".skills/…")
  format: 'text' | 'package';
  size: number; // total text bytes
  files?: SkillFileMeta[]; // package only
  content?: string; // entry-file text (snapshot taken at scan time)
  fileContents?: Record<string, string>; // package only: package-relative path → text
}

interface SkillsScan {
  skills: WorkspaceSkill[];
  scannedAt: number;
  online: boolean;
  note?: string;
}

type SkillTrigger = { source: ActivityEntry['source']; actor: string } | null;

let skillsScan: SkillsScan = { skills: [], scannedAt: 0, online: false };
let skillsScanPromise: Promise<SkillsScan> | null = null;

function fmtSize(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
}

function looksBinary(content: string): boolean {
  if (content.includes('\u0000')) return true;
  const bad = (content.match(/\uFFFD/g) ?? []).length;
  if (bad > 8 && bad > content.length * 0.02) return true;
  // dense C0 control bytes (bell/backspace/escape…) — e.g. raw image or audio
  // data that happens to decode as "valid" UTF-8. Scan the head only.
  let ctrl = 0;
  const head = content.slice(0, 8192);
  for (let i = 0; i < head.length; i++) {
    const c = head.charCodeAt(i);
    if (c < 32 && c !== 9 && c !== 10 && c !== 13) ctrl++;
  }
  return ctrl > 8 && ctrl > head.length * 0.02;
}

/** Parse a list_files result into workspace-relative entries (dirs end with "/"). */
function parseSkillsListing(result: string): string[] {
  const out: string[] = [];
  for (const raw of String(result ?? '').split('\n')) {
    const l = raw.trim();
    if (!l || /^Workspace "/.test(l) || /^No files found/i.test(l)) continue;
    out.push(l);
  }
  if (out.length === 0) return out;
  // entries are workspace-relative; tolerate scope-relative listings too
  return out.every((e) => e.startsWith(`${SKILLS_FOLDER}/`))
    ? out
    : out.map((e) => `${SKILLS_FOLDER}/${e.replace(/^\.?\//, '')}`);
}

/**
 * Read one text file from the workspace. Scan reads are NOT journaled
 * individually — each scan logs a single summary entry instead.
 */
async function readSkillFile(path: string): Promise<string | null> {
  const r = await execToolViaVscode('read_file', { path });
  if (!r.ok) return null;
  let text = typeof r.content === 'string' ? r.content : String(r.result ?? '');
  if (!r.content && text.startsWith(path)) {
    const idx = text.indexOf('):\n\n'); // strip the "<path> (size, N lines):" preamble
    if (idx > 0) text = text.slice(idx + 4);
  }
  if (!text.trim() || looksBinary(text)) return null;
  return text.length > MAX_SKILL_FILE_CHARS ? text.slice(0, MAX_SKILL_FILE_CHARS) : text;
}

/**
 * Discover the skills in the workspace ".skills/" folder. Loose files are
 * single skills; each sub-folder becomes one package skill (entry point:
 * SKILL.md > README.md > shallowest .md > first file). Results are cached
 * briefly; `force` re-reads the folder through the extension.
 */
async function scanWorkspaceSkills(force = false, trigger: SkillTrigger = null): Promise<SkillsScan> {
  if (!force && skillsScan.scannedAt > Date.now() - SKILLS_SCAN_TTL_MS) return skillsScan;
  if (skillsScanPromise) return skillsScanPromise;
  skillsScanPromise = (async () => {
    if (!vscodeSocket || !vscodeSocket.connected) {
      skillsScan = { skills: [], scannedAt: Date.now(), online: false, note: 'Workspace offline — .skills/ cannot be checked right now.' };
      return skillsScan;
    }
    const list = await execToolViaVscode('list_files', { path: SKILLS_FOLDER, max_files: 300 });
    if (!list.ok) {
      const missing = /does not exist/i.test(String(list.result ?? ''));
      skillsScan = {
        skills: [],
        scannedAt: Date.now(),
        online: true,
        note: missing
          ? `No ${SKILLS_FOLDER}/ folder in the workspace yet — create it and drop skill documents in.`
          : String(list.result ?? 'Could not list .skills/.'),
      };
      logSkillScan(skillsScan, trigger);
      return skillsScan;
    }

    // group entries: loose files vs sub-folder packages
    const loose: string[] = [];
    const packages = new Map<string, string[]>();
    for (const e of parseSkillsListing(String(list.result ?? ''))) {
      const rel = e.startsWith(`${SKILLS_FOLDER}/`) ? e.slice(SKILLS_FOLDER.length + 1) : e;
      if (!rel || rel.endsWith('/')) continue;
      const slash = rel.indexOf('/');
      if (slash < 0) { loose.push(e); continue; }
      const dir = rel.slice(0, slash);
      if (!packages.has(dir)) packages.set(dir, []);
      packages.get(dir)!.push(rel.slice(slash + 1));
    }

    const found: WorkspaceSkill[] = [];
    let budget = MAX_SKILL_FILES_SCAN;

    for (const path of loose) {
      if (budget <= 0) break;
      const content = await readSkillFile(path);
      if (content == null) continue; // binary / unreadable — not a skill document
      budget--;
      found.push({ name: path.split('/').pop() ?? path, path, format: 'text', size: Buffer.byteLength(content), content });
    }

    for (const [dir, rels] of packages) {
      if (budget <= 0) break;
      const mainRel = pickEntryPoint(rels);
      const fileContents: Record<string, string> = {};
      const files: SkillFileMeta[] = [];
      let size = 0;
      for (const rel of rels) {
        if (budget <= 0) break;
        const text = await readSkillFile(`${SKILLS_FOLDER}/${dir}/${rel}`);
        if (text == null) continue;
        budget--;
        fileContents[rel] = text;
        const b = Buffer.byteLength(text);
        files.push({ path: rel, size: b, ...(rel === mainRel ? { main: true } : {}) });
        size += b;
      }
      if (files.length === 0) continue;
      const main = files.find((f) => f.main) ?? files[0];
      found.push({
        name: dir,
        path: `${SKILLS_FOLDER}/${dir}/${main.path}`,
        format: 'package',
        size,
        files,
        content: fileContents[main.path],
        fileContents,
      });
    }

    skillsScan = { skills: found, scannedAt: Date.now(), online: true };
    logSkillScan(skillsScan, trigger);
    return skillsScan;
  })();
  try {
    return await skillsScanPromise;
  } finally {
    skillsScanPromise = null;
  }
}

/** One visible journal entry + live list push per real scan. */
function logSkillScan(scan: SkillsScan, trigger: SkillTrigger) {
  const names = scan.skills.slice(0, 6).map((s) => s.name).join(', ');
  logActivity({
    source: trigger?.source ?? 'system',
    actor: trigger?.actor ?? 'System',
    kind: 'skill',
    tool: 'skill:scan',
    ok: true,
    result: scan.skills.length > 0
      ? `Checked workspace ${SKILLS_FOLDER}/ — ${scan.skills.length} skill${scan.skills.length === 1 ? '' : 's'} found: ${names}${scan.skills.length > 6 ? ', …' : ''}.`
      : (scan.note ?? `Checked workspace ${SKILLS_FOLDER}/ — no skill documents found.`),
    meta: { skills: scan.skills.length, source: 'workspace' },
  });
  broadcastPaired('skill:list', { skills: skillsForWeb(), scannedAt: scan.scannedAt, online: scan.online, note: scan.note });
}

/** Entry point: SKILL.md > README.md > shallowest .md > first file. */
function pickEntryPoint(paths: string[]): string {
  const byDepth = [...paths].sort((a, b) =>
    a.split('/').length - b.split('/').length || a.localeCompare(b));
  const lower = byDepth.map((p) => p.toLowerCase());
  let i = lower.findIndex((p) => p === 'skill.md');
  if (i < 0) i = lower.findIndex((p) => p === 'readme.md');
  if (i < 0) i = lower.findIndex((p) => p.endsWith('.md'));
  if (i < 0) i = 0;
  return byDepth[i];
}

/** Lightweight shape for web viewers / the operator. */
function skillsForWeb() {
  return skillsScan.skills.map((s) => ({
    name: s.name,
    path: s.path,
    format: s.format,
    size: s.size,
    files: s.files,
    source: 'workspace',
  }));
}

function skillsSummary() {
  return { count: skillsScan.skills.length, source: 'workspace' };
}

/**
 * Learned skills are injected into the agent system prompt (paired runs
 * only) — the agent reads them BEFORE it starts thinking, and applies
 * them when the user says "use the skill <name>".
 */
function skillsPromptSegment(): string {
  const found = skillsScan.online ? skillsScan.skills.filter((s) => (s.content ?? '').trim()) : [];
  if (found.length === 0) return '';
  const parts: string[] = [];
  for (const s of found) {
    if (s.format === 'package') {
      const chunks: string[] = [];
      for (const f of s.files ?? []) {
        const t = s.fileContents?.[f.path];
        if (t && t.trim()) chunks.push(`#### FILE: ${f.path}${f.main ? ' (entry point)' : ''}\n${truncateStr(t, 6000)}`);
      }
      if (chunks.length > 0) {
        parts.push(`### Skill: ${s.name} (package, ${s.files?.length ?? chunks.length} files)\n${chunks.join('\n\n').slice(0, 16000)}`);
      }
      continue;
    }
    parts.push(`### Skill: ${s.name} (${s.path})\n${truncateStr(s.content ?? '', 6000)}`);
  }
  if (parts.length === 0) return '';
  return (
    `\n\nSKILLS: the user keeps skill documents in the workspace "${SKILLS_FOLDER}/" folder and expects you to have ` +
    `already read and learned them. Study them carefully and FOLLOW their rules while working on this workspace. ` +
    `When the user says "use the skill <name>" (e.g. "use the skill ${found[0].name} to build something"), apply that ` +
    `skill to the task at hand. If a referenced skill is not in this list, re-check the folder with ` +
    `list_files {path:"${SKILLS_FOLDER}"} and read_file the matching document before proceeding.\n\n${parts.join('\n\n').slice(0, MAX_SKILLS_PROMPT_CHARS)}`
  );
}

/** Read one skill (by name, path or package folder name) from the last scan. */
async function readWorkspaceSkill(name: string): Promise<{ skill?: WorkspaceSkill; content?: string; files?: { path: string; size: number; content: string }[]; error?: string }> {
  const match = (list: WorkspaceSkill[]) => list.find(
    (s) => s.name === name || s.path === name || s.path === `${SKILLS_FOLDER}/${name}`,
  );
  let skill = match(skillsScan.skills);
  if (!skill) {
    // not in the cached scan — re-check the folder before giving up
    const fresh = await scanWorkspaceSkills(true, { source: 'operator', actor: 'GLM (z.ai web)' });
    skill = match(fresh.skills);
  }
  if (!skill) return { error: `No skill named "${name}" in the workspace ${SKILLS_FOLDER}/ folder.` };
  const sk = skill;
  if (sk.format === 'package') {
    const files = (sk.files ?? [])
      .map((f) => ({ path: f.path, size: f.size, content: sk.fileContents?.[f.path] ?? '' }))
      .filter((f) => f.content);
    if (files.length === 0) return { skill: sk, error: 'Skill package files could not be read from the workspace.' };
    const mainMeta = (sk.files ?? []).find((m) => m.main);
    const main = files.find((f) => f.path === mainMeta?.path) ?? files[0];
    const ordered = [main, ...files.filter((f) => f !== main)];
    const content = ordered.map((f) => `## FILE: ${f.path}\n\n${f.content}`).join('\n\n');
    return { skill: sk, content: content.slice(0, 100_000), files };
  }
  if (!sk.content) return { skill: sk, error: 'Skill content could not be read from the workspace.' };
  return { skill: sk, content: sk.content };
}

/* ------------------------------------------------------------------ */
/* Live connections                                                    */
/* ------------------------------------------------------------------ */
let vscodeSocket: Socket | null = null; // the one connected workspace
const webSockets = new Map<Socket, { paired: boolean; token: string | null }>();

/* Pending tool executions: callId -> {resolve, timer} */
interface ToolOutcome { ok: boolean; result: string; meta?: any; content?: string }
const pendingToolCalls = new Map<string, { resolve: (r: ToolOutcome) => void; timer: any }>();

/* Agent run state (dormant chat path — kept for protocol compatibility) */
let running = false;
let abortRun = false;
let zai: any = null;

async function getZAI() {
  if (!zai) zai = await ZAI.create();
  return zai;
}

function statusPayload() {
  return {
    connected: !!vscodeSocket,
    workspaceName: state.workspace?.name ?? null,
    workspaceOnline: !!vscodeSocket,
    running,
    queued: queue.length,
    webClients: webSockets.size,
    serverTime: new Date().toISOString(),
    tree: treeCache ? { ...treeCache.stats, name: treeCache.name } : null,
    activityCount: activity.length,
    skills: skillsSummary(),
    extensionVersion: '0.4.0+',
  };
}

function broadcast(event: string, payload?: any) {
  io.emit(event, payload);
}

function broadcastPaired(event: string, payload?: any) {
  for (const [sock, info] of webSockets) {
    if (info.paired) sock.emit(event, payload);
  }
}

function emitStatus() {
  broadcast('status', statusPayload());
}

function genCode(): string {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 6; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return s;
}

function shortId(): string {
  return Math.random().toString(36).slice(2, 10);
}

function truncateStr(s: string, max: number): string {
  const v = String(s ?? '');
  return v.length <= max ? v : v.slice(0, max) + `… (${v.length} chars)`;
}

function truncateArgs(args: any): any {
  try {
    const json = JSON.stringify(args ?? {});
    if (json.length <= MAX_ACTIVITY_ARGS) return args ?? {};
    // keep path-ish fields, drop huge ones
    const out: any = {};
    for (const [k, v] of Object.entries(args ?? {})) {
      const vj = JSON.stringify(v);
      out[k] = vj && vj.length > 300 ? truncateStr(String(v), 300) : v;
    }
    return out;
  } catch {
    return { note: 'unserializable args' };
  }
}

/* ------------------------------------------------------------------ */
/* Activity journal                                                    */
/* ------------------------------------------------------------------ */
function logActivity(entry: Omit<ActivityEntry, 'id' | 'ts'> & { id?: string; ts?: number }): ActivityEntry {
  const full: ActivityEntry = { id: entry.id ?? shortId(), ts: entry.ts ?? Date.now(), ...entry } as ActivityEntry;
  activity.push(full);
  if (activity.length > MAX_ACTIVITY) activity.splice(0, activity.length - MAX_ACTIVITY);
  persistActivityDebounced();
  // Paired viewers get everything; unpaired visitors only see system events.
  if (full.source === 'system') broadcast('activity', full);
  else broadcastPaired('activity', full);
  return full;
}

let activitySaveTimer: any = null;
function persistActivityDebounced() {
  if (activitySaveTimer) return;
  activitySaveTimer = setTimeout(() => {
    activitySaveTimer = null;
    persistActivity();
  }, 1500);
}

function activityForWeb(paired: boolean): ActivityEntry[] {
  const recent = activity.slice(-300);
  return paired ? recent : recent.filter((e) => e.source === 'system');
}

/* ------------------------------------------------------------------ */
/* Tool execution through the VS Code extension                        */
/* ------------------------------------------------------------------ */
function execToolViaVscode(name: string, args: any): Promise<ToolOutcome> {
  return new Promise((resolve) => {
    if (!vscodeSocket || !vscodeSocket.connected) {
      resolve({ ok: false, result: 'Workspace is not connected (VS Code offline).' });
      return;
    }
    const callId = shortId();
    const timer = setTimeout(() => {
      pendingToolCalls.delete(callId);
      resolve({ ok: false, result: `Tool "${name}" timed out after ${TOOL_TIMEOUT_MS / 1000}s.` });
    }, TOOL_TIMEOUT_MS);
    pendingToolCalls.set(callId, {
      resolve: (r) => {
        clearTimeout(timer);
        resolve(r);
      },
      timer,
    });
    vscodeSocket.emit('tool:exec', { id: callId, name, args });
  });
}

/**
 * Run a tool and record it in the activity journal.
 * `source`/`actor` describe WHO initiated it:
 *   operator → "GLM (z.ai web)"  — the AI session driving via admin API
 *   web      → "Web viewer"      — dashboard file explorer
 *   vscode   → "GLM (server chat)" — legacy chat loop (compat)
 */
async function runTool(name: string, args: any, source: ActivityEntry['source'], actor: string) {
  const started = Date.now();
  const displayId = shortId();
  const label = toolLabel(name, args);
  broadcast('tool:call', { id: displayId, name, args: truncateArgs(args) });
  console.log(`[tool] ${actor} → ${name}`, JSON.stringify(truncateArgs(args)).slice(0, 160));

  const r = await execToolViaVscode(name, args);
  const durMs = Date.now() - started;

  const resultForBroadcast = truncateStr(r.result, MAX_TOOL_RESULT_DISPLAY);
  broadcastPaired('tool:result', { id: displayId, name, ok: r.ok, result: resultForBroadcast });

  const entry = logActivity({
    id: displayId,
    source,
    actor,
    kind: 'tool',
    tool: name,
    path: label,
    args: truncateArgs(args),
    ok: r.ok,
    result: r.ok ? truncateStr(r.result, 2000) : truncateStr(r.result, 2000),
    meta: r.meta ?? undefined,
    durMs,
  });

  return { ...r, durMs, entryId: entry.id };
}

function toolLabel(name: string, args: any): string | undefined {
  const a = args ?? {};
  if (typeof a.path === 'string' && a.path) return a.path;
  if (typeof a.from === 'string' && a.from) return `${a.from} → ${a.to ?? '?'}`;
  if (typeof a.query === 'string' && a.query) return `"${a.query}"`;
  if (typeof a.command === 'string' && a.command) return a.command;
  return undefined;
}

/* ------------------------------------------------------------------ */
/* The agent loop (legacy chat path — kept for protocol compatibility) */
/* ------------------------------------------------------------------ */
async function runAgent(text: string, from: string, opts: { allowTools: boolean }) {
  if (running) {
    broadcast('agent:busy');
    return;
  }
  running = true;
  abortRun = false;
  emitStatus();

  const ws = state.workspace;
  const label = ws?.name ?? 'workspace';
  const toolsForRun = opts.allowTools
    ? TOOLS.map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.parameters },
      }))
    : [];

  // paired runs re-check the workspace .skills/ folder so the agent has
  // read and learned every skill BEFORE it starts thinking
  let skillsSegment = '';
  if (opts.allowTools) {
    await scanWorkspaceSkills(true);
    skillsSegment = skillsPromptSegment();
  }

  try {
    state.history.push({ role: 'user', content: text });

    for (let round = 1; round <= MAX_ITERATIONS; round++) {
      if (abortRun) throw new Error('Stopped by user.');

      broadcast('agent:round', { round, max: MAX_ITERATIONS });
      broadcast('agent:note', { text: `thinking (round ${round}/${MAX_ITERATIONS})…` });

      const baseHistory = opts.allowTools
        ? state.history.slice(-40)
        : state.history
            .slice(-40)
            .filter((m: any) => m.role === 'user' || (m.role === 'assistant' && !m.tool_calls))
            .map((m: any) => ({ role: m.role, content: m.content }));

      const messages: any[] = [
        {
          role: 'system',
          // paired runs internalize the workspace .skills/ documents BEFORE thinking
          content: opts.allowTools ? SYSTEM_PROMPT(label) + skillsSegment : UNPAIRED_SYSTEM_PROMPT(label),
        },
        ...baseHistory,
      ];

      const z = await getZAI();
      const completion = await z.chat.completions.create({
        messages,
        tools: toolsForRun,
        tool_choice: toolsForRun.length ? 'auto' : undefined,
        thinking: { type: 'disabled' },
      });

      const msg = completion?.choices?.[0]?.message;
      const toolCalls: any[] = msg?.tool_calls ?? [];

      if (toolCalls.length > 0) {
        if (!opts.allowTools) {
          state.history.push(msg);
          const refusal =
            'This browser is not paired with the workspace, so file tools are disabled. ' +
            'Enter the pairing code shown in the VS Code connector panel to unlock full agent capabilities.';
          state.history.push({ role: 'assistant', content: refusal });
          broadcast('agent:text', { text: refusal, final: true });
          break;
        }
        if (msg?.content && String(msg.content).trim()) {
          broadcast('agent:note', { text: String(msg.content).trim() });
        }
        state.history.push(msg);

        for (const tc of toolCalls) {
          if (abortRun) throw new Error('Stopped by user.');
          const name = tc?.function?.name ?? '';
          let args: any = {};
          try {
            args = JSON.parse(tc?.function?.arguments || '{}');
          } catch {
            args = {};
          }
          const actor = from === 'vscode' ? 'GLM (VS Code chat)' : 'GLM (web chat)';
          const r = await runTool(name, args, from === 'vscode' ? 'vscode' : 'web', actor);
          state.history.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: String(r.result ?? '').slice(0, 30_000),
          });
        }
        continue;
      }

      const finalText = String(msg?.content ?? '').trim() || '(no content)';
      state.history.push({ role: 'assistant', content: finalText });
      broadcast('agent:text', { text: finalText, final: true });
      break;
    }

    if (!abortRun && state.history.length && state.history[state.history.length - 1].role !== 'assistant') {
      const cutoff = 'Reached the maximum number of tool rounds for this message. Ask me to continue.';
      state.history.push({ role: 'assistant', content: cutoff });
      broadcast('agent:text', { text: cutoff, final: true });
    }

    broadcast('agent:done');
  } catch (e: any) {
    const message = String(e?.message ?? e ?? 'Agent error');
    broadcast('agent:error', { message });
  } finally {
    running = false;
    abortRun = false;
    emitStatus();
    persistState();
  }
}

/* Flush the queue once the workspace comes online (legacy chat path) */
async function flushQueue() {
  while (queue.length > 0) {
    if (!vscodeSocket) break;
    const item = queue.shift()!;
    broadcast('agent:note', { text: `delivering queued message from ${item.from}…` });
    await runAgent(item.text, item.from, { allowTools: true });
  }
  persistState();
  emitStatus();
}

/* ------------------------------------------------------------------ */
/* Tree refresh coordination                                           */
/* ------------------------------------------------------------------ */
let treeWaiters: { resolve: (t: any) => void; timer: any }[] = [];
let treeVersion = 0; // bumped on every accepted tree (real or fallback)

function requestTreeRefresh(waitMs = 25_000): Promise<any | null> {
  return new Promise((resolve) => {
    if (!vscodeSocket || !vscodeSocket.connected) {
      resolve(null);
      return;
    }
    const versionAtStart = treeVersion;
    const timer = setTimeout(() => {
      const i = treeWaiters.findIndex((w) => w.resolve === resolve);
      if (i >= 0) treeWaiters.splice(i, 1);
      resolve(treeVersion > versionAtStart ? treeCache : treeCache);
    }, waitMs);
    treeWaiters.push({ resolve, timer });
    vscodeSocket.emit('fs:refresh');
  });
}

/**
 * Ensure a tree exists for the dashboard. With the 0.4.0 extension the real
 * structured tree arrives on connect; with the legacy 0.3.1 extension we fall
 * back to synthesizing one from the list_files text output.
 */
async function ensureTree(): Promise<any | null> {
  if (treeCache || !vscodeSocket || !vscodeSocket.connected) return treeCache;
  const versionAtStart = treeVersion;
  // 1) ask the extension directly (0.4.0 answers with workspace:tree)
  vscodeSocket.emit('fs:refresh');
  await new Promise((r) => setTimeout(r, 3000));
  if (treeVersion > versionAtStart) return treeCache;
  // 2) legacy fallback — build a tree from list_files text
  try {
    const r = await execToolViaVscode('list_files', { max_files: 500 });
    if (r.ok) {
      const fallback = treeFromListing(String(r.result ?? ''));
      if (fallback) {
        treeVersion++;
        treeCache = fallback;
        persistTree();
        broadcastPaired('workspace:tree', { ...treeCache, fallback: true });
        return treeCache;
      }
    }
  } catch { /* ignore */ }
  return treeCache;
}

/** Parse the list_files text format into a tree payload. */
function treeFromListing(text: string): any | null {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const entries: string[] = [];
  for (const l of lines) {
    if (l.startsWith('Workspace "') || l.startsWith('The workspace appears') || l.startsWith('No files found')) continue;
    if (/^[A-Za-z0-9 _\-./()]+\s*—\s*\d+ entries/.test(l)) continue;
    entries.push(l);
  }
  if (entries.length === 0) return null;

  const rootName = state.workspace?.name ?? 'workspace';
  const root: any = { name: rootName, path: '', type: 'dir', children: [] };
  const dirIndex = new Map<string, any>([['', root]]);
  const ensureDir = (p: string): any => {
    if (dirIndex.has(p)) return dirIndex.get(p);
    const parts = p.split('/');
    const name = parts.pop() as string;
    const parent = ensureDir(parts.join('/'));
    const node = { name, path: p, type: 'dir', children: [] };
    parent.children.push(node);
    dirIndex.set(p, node);
    return node;
  };
  let files = 0;
  for (const e of entries) {
    const isDir = e.endsWith('/');
    const p = isDir ? e.slice(0, -1) : e;
    if (isDir) { ensureDir(p); }
    else {
      const parts = p.split('/');
      const name = parts.pop() as string;
      const parent = ensureDir(parts.join('/'));
      parent.children.push({ name, path: p, type: 'file', size: null });
      files++;
    }
  }
  let dirs = dirIndex.size - 1;
  const sortRec = (n: any) => {
    n.children?.sort((a: any, b: any) => (a.type !== b.type ? (a.type === 'dir' ? -1 : 1) : a.name.localeCompare(b.name)));
    n.children?.forEach(sortRec);
  };
  sortRec(root);
  return {
    name: rootName,
    tree: root,
    stats: { files, dirs, totalBytes: 0, nodes: files + dirs, truncated: files + dirs >= 500, scannedAt: new Date().toISOString() },
  };
}

function onWorkspaceTree(payload: any) {
  if (!payload || !payload.tree) return;
  treeVersion++;
  treeCache = { name: payload.name ?? state.workspace?.name ?? 'workspace', tree: payload.tree, stats: payload.stats };
  try { treeCacheBytes = JSON.stringify(treeCache).length; } catch { treeCacheBytes = 0; }
  persistTree();
  broadcastPaired('workspace:tree', treeCache);
  logActivity({
    source: 'system',
    actor: 'System',
    kind: 'conn',
    text: `Workspace scanned — ${treeCache.stats.files} files, ${treeCache.stats.dirs} folders${treeCache.stats.truncated ? ' (tree truncated at cap)' : ''}.`,
  });
  // Wake anyone waiting on a refresh.
  const waiters = treeWaiters.splice(0, treeWaiters.length);
  for (const w of waiters) {
    clearTimeout(w.timer);
    w.resolve(treeCache);
  }
}

/* ------------------------------------------------------------------ */
/* Socket server                                                       */
/* ------------------------------------------------------------------ */
const httpServer = createServer();
const io = new Server(httpServer, {
  // DO NOT change the path — the Caddy gateway forwards /?XTransformPort=3003 here
  path: '/',
  cors: { origin: '*', methods: ['GET', 'POST'] },
  pingTimeout: 60_000,
  pingInterval: 25_000,
});

io.on('connection', (socket) => {
  let role: 'vscode' | 'web' | null = null;

  socket.on('hello', (data: any, cb?: any) => {
    role = data?.role === 'vscode' ? 'vscode' : 'web';

    if (role === 'vscode') {
      const workspaceId = String(data?.workspaceId ?? '');
      const secret = String(data?.secret ?? '');
      const name = String(data?.workspaceName ?? 'workspace');
      const ws = state.workspace;

      if (vscodeSocket && vscodeSocket.connected && vscodeSocket !== socket) {
        if (ws && workspaceId && workspaceId === ws.workspaceId && secret === ws.secret) {
          vscodeSocket.emit('vscode:evicted', { reason: 'This VS Code window took over the connection.' });
          vscodeSocket.disconnect(true);
          console.log('[vscode] old connection evicted (takeover)');
        } else {
          socket.emit('vscode:rejected', {
            reason: `Another workspace ("${ws?.name ?? 'unknown'}") is already connected to this server.`,
          });
          return;
        }
      }

      let persistent = false;
      if (!ws) {
        state.workspace = {
          workspaceId: workspaceId || randomUUID(),
          secret: secret || randomUUID(),
          name,
          pairingCode: genCode(),
          webTokens: [],
        };
      } else if (workspaceId && workspaceId === ws.workspaceId && secret && secret === ws.secret) {
        persistent = true;
        state.workspace.name = name;
      } else if (workspaceId && secret) {
        state.workspace = {
          workspaceId,
          secret,
          name,
          pairingCode: genCode(),
          webTokens: [],
        };
        state.history = [];
        activity.length = 0; // the activity journal belongs to the workspace
        persistActivity();
        treeCache = null;
        persistTree();
        console.log(`[vscode] workspace slot re-paired to "${name}"`);
      } else {
        socket.emit('vscode:rejected', { reason: 'Invalid workspace identity (missing id or secret).' });
        return;
      }
      vscodeSocket = socket;
      persistState();

      socket.emit('vscode:registered', { name, persistent });
      socket.emit('pair:code', { code: state.workspace!.pairingCode, persistent: true });
      logActivity({
        source: 'system',
        actor: 'System',
        kind: 'conn',
        text: persistent
          ? `Workspace "${name}" reconnected (identity persisted).`
          : `Workspace "${name}" connected — the bridge is live.`,
      });
      emitStatus();
      console.log(`[vscode] workspace "${name}" connected (persistent=${persistent})`);

      /* ---- events from the extension ---- */

      socket.on('workspace:info', (d: any) => {
        if (d?.name) {
          // name refresh only — the tree follows in workspace:tree
        }
      });

      socket.on('workspace:tree', (d: any) => onWorkspaceTree(d));

      socket.on('fs:event', (d: any) => {
        const events: any[] = Array.isArray(d?.events) ? d.events.slice(0, 100) : [];
        if (events.length === 0) return;
        for (const ev of events) {
          const type = ev?.type === 'created' ? 'created' : ev?.type === 'deleted' ? 'deleted' : 'changed';
          logActivity({
            source: 'local',
            actor: 'You (VS Code)',
            kind: 'fs',
            fsType: type,
            path: String(ev?.path ?? ''),
          });
        }
      });

      socket.on('chat:send', async (d: any) => {
        const text = String(d?.text ?? '').trim();
        if (!text) return;
        broadcast('chat:user', { from: 'vscode', text });
        await runAgent(text, 'vscode', { allowTools: true });
      });

      socket.on('tool:result', (d: any) => {
        const callId = String(d?.callId ?? '');
        const pending = pendingToolCalls.get(callId);
        if (pending) {
          pendingToolCalls.delete(callId);
          pending.resolve({
            ok: !!(d?.ok ?? true),
            result: String(d?.result ?? ''),
            meta: d?.meta ?? undefined,
            content: typeof d?.content === 'string' ? d.content : undefined,
          });
        }
      });

      socket.on('stop', () => {
        abortRun = true;
      });

      socket.on('session:clear', () => {
        state.history = [];
        persistState();
        broadcast('session:cleared');
        console.log('[vscode] session cleared');
      });

      socket.on('disconnect', () => {
        if (vscodeSocket === socket) {
          vscodeSocket = null;
          logActivity({
            source: 'system',
            actor: 'System',
            kind: 'conn',
            text: 'Workspace disconnected — VS Code went offline.',
          });
          console.log('[vscode] workspace disconnected');
          emitStatus();
        }
      });

      if (typeof cb === 'function') cb({ ok: true });
      if (queue.length > 0) void flushQueue();
      return;
    }

    /* ---- web client ---- */
    const token = data?.token ? String(data.token) : null;
    let paired = !!(token && state.workspace?.webTokens?.includes(token));
    webSockets.set(socket, { paired, token });
    socket.emit('status', statusPayload());
    socket.emit('activity:list', { entries: activityForWeb(paired) });
    if (paired) {
      socket.emit('pair:ok', { token });
      if (treeCache) socket.emit('workspace:tree', treeCache);
      else void ensureTree(); // legacy-extension fallback or first scan
      socket.emit('skill:list', { skills: skillsForWeb(), scannedAt: skillsScan.scannedAt, online: skillsScan.online, note: skillsScan.note });
      void scanWorkspaceSkills(false); // background refresh if stale — broadcasts a fresh list when it scans
    }
    console.log(`[web] client connected (paired=${paired})`);

    socket.on('pair', (d: any) => {
      const code = String(d?.code ?? '').toUpperCase().match(/[A-Z0-9]/g)?.join('') ?? '';
      const info = webSockets.get(socket);
      if (state.workspace && code && code === state.workspace.pairingCode) {
        const newToken = randomUUID();
        state.workspace.webTokens = [...(state.workspace.webTokens ?? []), newToken].slice(-20);
        persistState();
        if (info) {
          info.paired = true;
          info.token = newToken;
        }
        socket.emit('pair:ok', { token: newToken });
        socket.emit('activity:list', { entries: activityForWeb(true) });
        if (treeCache) socket.emit('workspace:tree', treeCache);
        else void ensureTree();
        socket.emit('skill:list', { skills: skillsForWeb(), scannedAt: skillsScan.scannedAt, online: skillsScan.online, note: skillsScan.note });
      void scanWorkspaceSkills(false); // background refresh if stale — broadcasts a fresh list when it scans
        logActivity({
          source: 'system',
          actor: 'System',
          kind: 'conn',
          text: 'A browser paired with the workspace — dashboard unlocked.',
        });
        console.log('[web] client paired');
      } else {
        socket.emit('pair:rejected', { reason: 'Invalid pairing code.' });
      }
    });

    socket.on('chat:send', async (d: any) => {
      const text = String(d?.text ?? '').trim();
      if (!text) return;
      const info = webSockets.get(socket);
      const allowTools = !!info?.paired;
      if (vscodeSocket) {
        broadcast('chat:user', { from: 'web', text });
        await runAgent(text, 'web', { allowTools });
      } else if (info?.paired) {
        queue.push({ text, from: 'web', ts: Date.now() });
        persistState();
        emitStatus();
        socket.emit('agent:note', {
          text: 'Workspace is offline — message queued and will run when VS Code reconnects.',
        });
      } else {
        socket.emit('agent:text', {
          text:
            'The workspace is offline and this browser is not paired, so your message cannot be delivered. ' +
            'Pair with the code shown in the VS Code connector panel to unlock the agent.',
          final: true,
        });
      }
    });

    socket.on('stop', () => {
      abortRun = true;
    });

    socket.on('session:clear', () => {
      state.history = [];
      persistState();
      broadcast('session:cleared');
    });

    socket.on('files:peek', async () => {
      if (!vscodeSocket) {
        socket.emit('files:list', { files: null, error: 'Workspace offline.' });
        return;
      }
      const r = await runTool('list_files', {}, 'web', 'Web viewer');
      socket.emit('files:list', {
        files: r.ok ? String(r.result).slice(0, 8000) : null,
        error: r.ok ? null : r.result,
      });
    });

    socket.on('queue:peek', () => {
      socket.emit('queue:list', { items: queue });
    });

    /* ---- new observatory events ---- */

    socket.on('file:read', async (d: any) => {
      const info = webSockets.get(socket);
      const p = String(d?.path ?? '').trim();
      if (!info?.paired) {
        socket.emit('file:content', { path: p, ok: false, error: 'Pair with the workspace to read files.' });
        return;
      }
      if (!p) {
        socket.emit('file:content', { path: '', ok: false, error: 'Missing path.' });
        return;
      }
      const r = await runTool('read_file', { path: p }, 'web', 'Web viewer');
      socket.emit('file:content', {
        path: p,
        ok: r.ok,
        content: r.content ?? (r.ok ? String(r.result ?? '') : undefined),
        meta: r.meta,
        error: r.ok ? undefined : String(r.result ?? 'read failed'),
      });
    });

    socket.on('tree:refresh', async () => {
      const info = webSockets.get(socket);
      if (!info?.paired) {
        socket.emit('workspace:tree', treeCache ? treeCache : { error: 'Pair with the workspace to view files.' });
        return;
      }
      await requestTreeRefresh();
      // onWorkspaceTree broadcasts to every paired socket (including this one)
    });

    socket.on('activity:list', () => {
      const info = webSockets.get(socket);
      socket.emit('activity:list', { entries: activityForWeb(!!info?.paired) });
    });

    socket.on('activity:clear', () => {
      const info = webSockets.get(socket);
      if (!info?.paired) return;
      activity.length = 0;
      persistActivity();
      broadcast('activity:cleared');
      logActivity({
        source: 'system',
        actor: 'System',
        kind: 'conn',
        text: 'Activity log cleared from the web dashboard.',
      });
    });

    /* ---- skills (paired web viewers only — the workspace .skills/   */
    /* folder is the source of truth; viewers can list, read, re-check) */

    socket.on('skill:list', async (_d: any, cb?: any) => {
      const info = webSockets.get(socket);
      if (!info?.paired) { if (typeof cb === 'function') cb({ ok: false, error: 'not paired' }); return; }
      const scan = await scanWorkspaceSkills(false, { source: 'web', actor: 'Web viewer' });
      if (typeof cb === 'function') cb({ ok: true, skills: skillsForWeb(), scannedAt: scan.scannedAt, online: scan.online, note: scan.note });
    });

    socket.on('skill:refresh', async (_d: any, cb?: any) => {
      const info = webSockets.get(socket);
      if (!info?.paired) { if (typeof cb === 'function') cb({ ok: false, error: 'Pair with the workspace to check .skills/.' }); return; }
      const scan = await scanWorkspaceSkills(true, { source: 'web', actor: 'Web viewer' });
      if (typeof cb === 'function') cb({ ok: true, skills: skillsForWeb(), scannedAt: scan.scannedAt, online: scan.online, note: scan.note });
    });

    socket.on('skill:get', async (d: any, cb?: any) => {
      const info = webSockets.get(socket);
      const done = (r: any) => { if (typeof cb === 'function') cb(r); };
      if (!info?.paired) { done({ ok: false, error: 'Pair with the workspace to read skills.' }); return; }
      const r = await readWorkspaceSkill(String(d?.name ?? ''));
      done(r.skill
        ? { ok: true, skill: r.skill, content: r.content, files: r.files, error: r.error }
        : { ok: false, error: r.error });
    });

    socket.on('disconnect', () => {
      webSockets.delete(socket);
      emitStatus();
    });
  });

  // Health ping for the web page
  socket.on('ping:svc', (cb: any) => {
    if (typeof cb === 'function') cb({ ok: true, t: Date.now() });
  });
});

/* ------------------------------------------------------------------ */
/* Operator admin API — localhost only.                                */
/* This is how the GLM session on z.ai web drives the workspace:       */
/* every call goes through runTool() and is fully observable in the    */
/* activity journal + web dashboard.                                   */
/* ------------------------------------------------------------------ */
function isLoopback(req: IncomingMessage): boolean {
  const ra = req.socket.remoteAddress ?? '';
  return ra === '127.0.0.1' || ra === '::1' || ra === '::ffff:127.0.0.1';
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

function sendJson(res: ServerResponse, code: number, data: any) {
  const body = JSON.stringify(data);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function operatorNote(text: string) {
  logActivity({
    source: 'operator',
    actor: 'GLM (z.ai web)',
    kind: 'note',
    text: truncateStr(text, 1000),
  });
  broadcast('operator:note', { text: truncateStr(text, 1000), ts: Date.now() });
}

const adminServer = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const route = `${req.method ?? 'GET'} ${url.pathname}`;
  try {
    if (!isLoopback(req)) {
      sendJson(res, 403, { ok: false, error: 'Admin API is local-only.' });
      return;
    }

    // GET status
    if (req.method === 'GET' && url.pathname === '/status') {
      sendJson(res, 200, {
        ok: true,
        connected: !!vscodeSocket,
        workspaceName: state.workspace?.name ?? null,
        pairingCode: state.workspace?.pairingCode ?? null,
        webClients: webSockets.size,
        pairedWebs: [...webSockets.values()].filter((w) => w.paired).length,
        activityCount: activity.length,
        skills: skillsSummary(),
        tree: treeCache ? { name: treeCache.name, ...treeCache.stats } : null,
        running,
        queued: queue.length,
        historyLen: state.history.length,
        tools: TOOLS.map((t) => t.name),
        serverTime: new Date().toISOString(),
      });
      return;
    }

    // GET tree
    if (req.method === 'GET' && url.pathname === '/tree') {
      if (!treeCache && vscodeSocket) await ensureTree();
      sendJson(res, 200, treeCache ? { ok: true, ...treeCache } : { ok: false, error: vscodeSocket ? 'tree not available' : 'workspace offline' });
      return;
    }

    // GET file?path=
    if (req.method === 'GET' && url.pathname === '/file') {
      const p = url.searchParams.get('path') ?? '';
      if (!p) { sendJson(res, 400, { ok: false, error: 'missing ?path=' }); return; }
      const r = await runTool('read_file', { path: p }, 'operator', 'GLM (z.ai web)');
      sendJson(res, 200, { ok: r.ok, result: r.result, meta: r.meta, content: r.content, durMs: r.durMs });
      return;
    }

    // GET activity?limit=
    if (req.method === 'GET' && url.pathname === '/activity') {
      const limit = Math.max(1, Math.min(500, parseInt(url.searchParams.get('limit') ?? '200', 10) || 200));
      sendJson(res, 200, { ok: true, entries: activity.slice(-limit) });
      return;
    }

    // GET skills — live listing of the workspace .skills/ folder
    if (req.method === 'GET' && url.pathname === '/skills') {
      const scan = await scanWorkspaceSkills(true, { source: 'operator', actor: 'GLM (z.ai web)' });
      sendJson(res, 200, { ok: true, skills: skillsForWeb(), scannedAt: scan.scannedAt, online: scan.online, note: scan.note, summary: skillsSummary() });
      return;
    }

    // GET skill?name= — read one skill from the workspace .skills/ folder
    // (this is how the GLM operator reads a skill; packages also return a
    // files[] array with every document in the package)
    if (req.method === 'GET' && url.pathname === '/skill') {
      const name = url.searchParams.get('name') ?? '';
      if (!name) { sendJson(res, 400, { ok: false, error: 'missing ?name=' }); return; }
      const r = await readWorkspaceSkill(name);
      sendJson(res, 200, r.skill
        ? { ok: true, skill: r.skill, content: r.content, files: r.files, error: r.error }
        : { ok: false, error: r.error });
      return;
    }

    // POST run {tool, args}
    if (req.method === 'POST' && url.pathname === '/run') {
      const body = JSON.parse((await readBody(req)) || '{}');
      const name = String(body?.tool ?? '');
      if (!TOOLS.some((t) => t.name === name)) {
        sendJson(res, 400, { ok: false, error: `unknown tool "${name}"`, tools: TOOLS.map((t) => t.name) });
        return;
      }
      const args = body?.args ?? {};
      const r = await runTool(name, args, 'operator', 'GLM (z.ai web)');
      sendJson(res, 200, { ok: r.ok, result: r.result, meta: r.meta, content: r.content, durMs: r.durMs, entryId: r.entryId });
      return;
    }

    // POST note {text}
    if (req.method === 'POST' && url.pathname === '/note') {
      const body = JSON.parse((await readBody(req)) || '{}');
      const text = String(body?.text ?? '').trim();
      if (!text) { sendJson(res, 400, { ok: false, error: 'missing text' }); return; }
      operatorNote(text);
      sendJson(res, 200, { ok: true });
      return;
    }

    // POST refresh
    if (req.method === 'POST' && url.pathname === '/refresh') {
      if (treeCache) { const t = await requestTreeRefresh(20_000); sendJson(res, 200, t ? { ok: true, stats: t.stats } : { ok: false }); return; }
      const t = await ensureTree();
      sendJson(res, 200, t ? { ok: true, stats: t.stats } : { ok: false, error: 'workspace offline' });
      return;
    }

    // POST activity/clear
    if (req.method === 'POST' && url.pathname === '/activity/clear') {
      activity.length = 0;
      persistActivity();
      broadcast('activity:cleared');
      sendJson(res, 200, { ok: true });
      return;
    }

    sendJson(res, 404, { ok: false, error: `no route: ${route}` });
  } catch (e: any) {
    sendJson(res, 500, { ok: false, error: String(e?.message ?? e) });
  }
});

adminServer.listen(ADMIN_PORT, '127.0.0.1', () => {
  console.log(`Operator admin API listening on http://127.0.0.1:${ADMIN_PORT} (localhost only)`);
});

/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */
httpServer.listen(PORT, () => {
  console.log(`AI Code Agent service v2 listening on port ${PORT} (socket.io path "/")`);
  if (state.workspace) {
    console.log(`Paired workspace on file: "${state.workspace.name}" (pairing code ${state.workspace.pairingCode})`);
  }
  console.log(`Activity entries: ${activity.length}, queued messages: ${queue.length}, tree cache: ${treeCache ? `${treeCache.stats.files} files` : 'none'}`);
});

function shutdown() {
  try { httpServer.close(); } catch { /* noop */ }
  try { adminServer.close(); } catch { /* noop */ }
  setTimeout(() => process.exit(0), 300);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
