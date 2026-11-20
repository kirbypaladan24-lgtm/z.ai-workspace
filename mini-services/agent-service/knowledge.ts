/**
 * knowledge.ts — the Workspace Bridge Adaptive Intelligence layer (v1).
 *
 * A JSONL knowledge store that lives in the USER'S workspace (knowledge/
 * folder) and is synced through the connected VS Code extension. The
 * workspace is the single source of truth — copy the folder to migrate
 * every record, attempt, feedback and audit line to another machine.
 *
 * Lifecycle (plan §5, first-release subset):
 *   candidate → verification_pending → verified | rejected
 *   then: deprecated / archived (owner), deleted (soft)
 *   Failed attempts are separate records used as negative retrieval signal.
 *
 * Core principle (plan §1): GLM may PROPOSE knowledge; the bridge controls
 * verification, promotion and auditability. The operator (admin API) can
 * submit/attempt/feedback/propose/verify — but can never set "verified"
 * directly. Promotion happens ONLY through:
 *   a) the verification gate: checks executed BY THE SERVICE through the
 *      bridge tool layer (real exit codes captured from the extension), or
 *   b) explicit owner approval from the paired dashboard.
 *
 * Store files (workspace-relative):
 *   knowledge/experiences.jsonl   one experience per line (nested versions)
 *   knowledge/attempts.jsonl      unsuccessful attempts (negative signal)
 *   knowledge/feedback.jsonl      reuse feedback (worked / failed / incompatible)
 *   knowledge/audit.jsonl         append-only audit history
 *   knowledge/meta.json           schema version + ID counters
 *   knowledge/README.md           self-documentation (seeded once)
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export type KnowledgeScope = 'global' | 'project';
export type ExperienceStatus =
  | 'candidate'
  | 'verification_pending'
  | 'verified'
  | 'rejected'
  | 'deprecated'
  | 'archived';
export type VerificationStatus = 'pending' | 'passed' | 'failed' | 'unable_to_verify' | 'human_approved';
export type AttemptResult = 'failed' | 'partially_resolved' | 'unresolved';
export type FeedbackOutcome = 'worked' | 'failed' | 'incompatible';

export interface EvidenceItem {
  ts: number;
  source: 'run_command' | 'owner';
  command?: string;
  exitCode?: number | null;
  timedOut?: boolean;
  summary: string;
  journalRef?: string;
  actor: string;
}

export interface ExperienceVersion {
  version: number;
  createdBy: string;
  createdAt: string;
  symptoms: string;
  rootCause: string;
  solutionSteps: string;
  environment: string;
  applicableVersions: string;
  limitations: string;
  compatibilityNotes?: string;
  changeReason?: string;
  verificationStatus: VerificationStatus;
  verificationSummary: string;
  evidence: EvidenceItem[];
  supersedes?: number;
  /**
   * When this proposal ALSO corrected record-level fields (title /
   * problemSummary — e.g. to retract an unsupported superlative that lives
   * outside the versioned fields), the prior values are preserved here
   * verbatim. The revision never overwrites historical knowledge: v1's
   * wording stays inspectable on the version that caused the change.
   */
  recordFieldChanges?: {
    title?: { from: string; to: string };
    problemSummary?: { from: string; to: string };
  };
}

export interface ExperienceRecord {
  id: string;
  scope: KnowledgeScope;
  projectId: string | null;
  category: string;
  title: string;
  problemSummary: string;
  status: ExperienceStatus;
  activeVersion: number;
  versions: ExperienceVersion[];
  reuseStats: { used: number; worked: number; failed: number };
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  deletedAt: string | null;
}

export interface AttemptRecord {
  id: string;
  experienceId: string | null;
  projectId: string | null;
  sessionId: string;
  problemSummary: string;
  approach: string;
  result: AttemptResult;
  failureReason: string;
  environment: string;
  createdAt: string;
}

export interface FeedbackRecord {
  id: string;
  experienceId: string;
  experienceVersion: number;
  sessionId: string;
  outcome: FeedbackOutcome;
  notes: string;
  createdAt: string;
}

export interface AuditRecord {
  id: string;
  ts: number;
  actor: string;
  operation: string;
  entityType: 'experience' | 'attempt' | 'feedback' | 'store';
  entityId: string;
  oldVersion: number | null;
  newVersion: number | null;
  reason: string;
}

export interface KnowledgeCounts {
  verified: number;
  candidate: number;
  verificationPending: number;
  rejected: number;
  deprecated: number;
  archived: number;
  deleted: number;
  attempts: number;
  feedback: number;
  audit: number;
}

export interface KnowledgeSummary {
  ok: boolean;
  online: boolean;
  syncedAt: number | null;
  note?: string;
  counts: KnowledgeCounts;
  projectName: string | null;
}

export interface SearchHit {
  id: string;
  title: string;
  scope: KnowledgeScope;
  projectId: string | null;
  category: string;
  status: ExperienceStatus;
  activeVersion: number;
  score: number;
  problemSummary: string;
  solutionExcerpt: string;
  environment: string;
  applicableVersions: string;
  limitations: string;
  verificationStatus: VerificationStatus;
  verificationSummary: string;
  evidenceCount: number;
  reuseStats: { used: number; worked: number; failed: number };
  updatedAt: string;
  warning?: boolean;
}

export interface SearchOutcome {
  ok: boolean;
  query: string;
  hits: SearchHit[];
  attemptWarnings: Array<{
    id: string;
    problemSummary: string;
    approach: string;
    failureReason: string;
    result: AttemptResult;
    createdAt: string;
    score: number;
  }>;
  note?: string;
  error?: string;
}

export interface CheckSpec {
  command: string;
  timeoutMs?: number;
}

/* Dependencies injected by index.ts (keeps this module decoupled). */
export interface KnowledgeDeps {
  /** Is the VS Code extension connected right now? */
  isOnline(): boolean;
  /** Stable project identifier (the workspace name) or null. */
  projectName(): string | null;
  /**
   * Run one verification check. MUST go through the journaled tool path so
   * evidence carries a real activity-journal reference and a real exit code
   * captured by the extension — the thing GLM cannot fabricate.
   */
  runCheck(command: string, timeoutMs?: number): Promise<{
    ok: boolean;
    exitCode: number | null;
    timedOut: boolean;
    result: string;
    entryId?: string;
  }>;
  /** Write one knowledge activity entry to the journal. */
  logKnowledge(e: {
    source: 'operator' | 'web' | 'system';
    actor: string;
    tool: string;
    ok?: boolean;
    result?: string;
    meta?: Record<string, unknown>;
  }): unknown;
  /** Push knowledge:state to every paired web client. */
  broadcastState(): void;
  /** Local cache directory (sandbox-side mirror, NOT the source of truth). */
  dataDir: string;
}

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

const STORE_DIR = 'knowledge';
const FILES = {
  experiences: `${STORE_DIR}/experiences.jsonl`,
  attempts: `${STORE_DIR}/attempts.jsonl`,
  feedback: `${STORE_DIR}/feedback.jsonl`,
  audit: `${STORE_DIR}/audit.jsonl`,
  meta: `${STORE_DIR}/meta.json`,
  readme: `${STORE_DIR}/README.md`,
} as const;

const SCHEMA_VERSION = 1;
const MAX_AUDIT_IN_MEMORY = 10_000;
const MAX_EVIDENCE_PER_VERSION = 40;
const MAX_ATTEMPT_WARNINGS = 3;
const MAX_SYNC_READ_CHARS = 1_400_000; // below the extension READ_CHAR_CAP
const DEFAULT_SEARCH_LIMIT = 5;

const CATEGORIES = [
  'build-error', 'runtime-bug', 'config', 'dependency', 'tooling',
  'debugging-technique', 'pattern', 'setup', 'other',
] as const;

/* High-confidence secret shapes — submitting these is BLOCKED (plan §13.8). */
const SECRET_BLOCK_PATTERNS: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\b(?:sk|rk)-[A-Za-z0-9_-]{20,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bghp_[A-Za-z0-9]{30,}\b/,
  /\bgho_[A-Za-z0-9]{30,}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/,
  /\beyJ[A-Za-z0-9_-]{20,}\.eyJ[A-Za-z0-9_-]{20,}\b/,
];
/* Softer heuristic — allowed but flagged in the response + journal. */
const SECRET_WARN_RE = /\b(password|passwd|secret|api[_-]?key|access[_-]?token)\b\s*[:=]\s*\S+/i;

/* ------------------------------------------------------------------ */
/* Module state                                                        */
/* ------------------------------------------------------------------ */

interface StoreState {
  experiences: ExperienceRecord[];
  attempts: AttemptRecord[];
  feedback: FeedbackRecord[];
  audit: AuditRecord[];
  meta: { schemaVersion: number; counters: { exp: number; att: number; fbk: number; aud: number } };
  syncedAt: number | null;
  online: boolean;
  note?: string;
}

function emptyStore(): StoreState {
  return {
    experiences: [],
    attempts: [],
    feedback: [],
    audit: [],
    meta: { schemaVersion: SCHEMA_VERSION, counters: { exp: 0, att: 0, fbk: 0, aud: 0 } },
    syncedAt: null,
    online: false,
  };
}

let store: StoreState = emptyStore();
let deps: KnowledgeDeps | null = null;
let cacheFile = '';
let syncPromise: Promise<StoreState> | null = null;
let mutationChain: Promise<unknown> = Promise.resolve();

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

function truncate(s: unknown, max: number): string {
  const v = String(s ?? '');
  return v.length <= max ? v : v.slice(0, max) + `… (${v.length} chars)`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function tokenize(s: string): Set<string> {
  return new Set(
    String(s ?? '')
      .toLowerCase()
      .split(/[^a-z0-9+#.]+/)
      .filter((t) => t.length > 1),
  );
}

/** 0.5 * Jaccard(doc, query) + 0.5 * fraction of query tokens covered. */
function textOverlap(queryTokens: Set<string>, doc: string): number {
  if (queryTokens.size === 0) return 0;
  const docTokens = tokenize(doc);
  if (docTokens.size === 0) return 0;
  let inter = 0;
  for (const t of queryTokens) if (docTokens.has(t)) inter++;
  const union = docTokens.size + queryTokens.size - inter;
  const jaccard = union > 0 ? inter / union : 0;
  const coverage = inter / queryTokens.size;
  return 0.5 * jaccard + 0.5 * coverage;
}

function nextId(kind: 'exp' | 'att' | 'fbk' | 'aud'): string {
  const prefix = kind === 'exp' ? 'EXP' : kind === 'att' ? 'ATT' : kind === 'fbk' ? 'FBK' : 'AUD';
  const n = ++store.meta.counters[kind];
  return `${prefix}-${String(n).padStart(6, '0')}`;
}

function findExperience(id: string): ExperienceRecord | undefined {
  return store.experiences.find((e) => e.id === id);
}

function activeVersionOf(exp: ExperienceRecord): ExperienceVersion | undefined {
  return exp.versions.find((v) => v.version === exp.activeVersion);
}

function scanSecrets(text: string): { blocked: boolean; warned: boolean } {
  const blocked = SECRET_BLOCK_PATTERNS.some((re) => re.test(text));
  const warned = !blocked && SECRET_WARN_RE.test(text);
  return { blocked, warned };
}

/* ------------------------------------------------------------------ */
/* Local cache (sandbox mirror — the workspace store is the truth)     */
/* ------------------------------------------------------------------ */

function persistLocalCache() {
  if (!cacheFile) return;
  try {
    mkdirSync(deps!.dataDir, { recursive: true });
    writeFileSync(cacheFile, JSON.stringify(store));
  } catch (e) {
    console.error('[knowledge] local cache save failed:', e);
  }
}

function loadLocalCache() {
  try {
    const raw = JSON.parse(readFileSync(cacheFile, 'utf8')) as StoreState;
    if (raw && Array.isArray(raw.experiences) && Array.isArray(raw.attempts) && raw.meta) {
      store = {
        experiences: raw.experiences,
        attempts: raw.attempts,
        feedback: Array.isArray(raw.feedback) ? raw.feedback : [],
        audit: Array.isArray(raw.audit) ? raw.audit : [],
        meta: raw.meta,
        syncedAt: raw.syncedAt ?? null,
        online: false,
        note: 'loaded from local cache — re-syncs when the workspace connects',
      };
    }
  } catch {
    /* no cache yet — fresh start */
  }
}

/* ------------------------------------------------------------------ */
/* Workspace file I/O (through the extension, NOT journaled per-file)  */
/* ------------------------------------------------------------------ */

async function wsReadFile(path: string): Promise<{ ok: boolean; text: string; missing: boolean }> {
  // injected lazily to avoid a circular import at module scope
  const r = await rawExec('read_file', { path });
  if (r.ok) {
    let text = typeof (r as any).content === 'string' ? (r as any).content : String(r.result ?? '');
    if (!(r as any).content && text.startsWith(path)) {
      const idx = text.indexOf('):\n\n'); // strip the "<path> (size, N lines):" preamble
      if (idx > 0) text = text.slice(idx + 4);
    }
    if (text.length > MAX_SYNC_READ_CHARS) {
      return { ok: false, text: '', missing: false };
    }
    return { ok: true, text, missing: false };
  }
  const msg = String(r.result ?? '');
  return { ok: false, text: '', missing: /not (exist|found)|no such/i.test(msg) };
}

async function wsWriteFile(path: string, content: string): Promise<boolean> {
  const r = await rawExec('write_file', { path, content });
  return r.ok;
}

/* rawExec is set by index.ts via initKnowledge — the service owns the
 * extension socket; this module only borrows it for store sync writes. */
let rawExec: (name: 'read_file' | 'write_file', args: Record<string, unknown>) => Promise<{ ok: boolean; result: string; content?: string }> =
  async () => ({ ok: false, result: 'knowledge module not initialized' });

/* ------------------------------------------------------------------ */
/* JSONL (de)serialization                                             */
/* ------------------------------------------------------------------ */

function parseJsonl<T>(text: string): { items: T[]; badLines: number } {
  const items: T[] = [];
  let badLines = 0;
  for (const line of String(text ?? '').split('\n')) {
    const l = line.trim();
    if (!l) continue;
    try {
      items.push(JSON.parse(l) as T);
    } catch {
      badLines++;
    }
  }
  return { items, badLines };
}

function toJsonl(items: unknown[]): string {
  return items.map((i) => JSON.stringify(i)).join('\n') + (items.length ? '\n' : '');
}

/* ------------------------------------------------------------------ */
/* Audit + journal + broadcast                                         */
/* ------------------------------------------------------------------ */

function audit(
  actor: string,
  operation: string,
  entityType: AuditRecord['entityType'],
  entityId: string,
  opts: { oldVersion?: number | null; newVersion?: number | null; reason?: string } = {},
): AuditRecord {
  const rec: AuditRecord = {
    id: nextId('aud'),
    ts: Date.now(),
    actor,
    operation,
    entityType,
    entityId,
    oldVersion: opts.oldVersion ?? null,
    newVersion: opts.newVersion ?? null,
    reason: truncate(opts.reason ?? '', 500),
  };
  store.audit.push(rec);
  if (store.audit.length > MAX_AUDIT_IN_MEMORY) {
    store.audit.splice(0, store.audit.length - MAX_AUDIT_IN_MEMORY);
  }
  // Every audit append must persist: audit.jsonl is append-only history, and
  // a line that exists only in memory is lost on restart. (This exact gap
  // dropped 9 propose audit lines on 2026-11-19 — see AUD-000036 in the
  // store. Call sites that also set dirty.audit are harmless duplicates.)
  dirty.audit = true;
  return rec;
}

function journal(
  source: 'operator' | 'web' | 'system',
  actor: string,
  tool: string,
  ok: boolean,
  result: string,
  meta?: Record<string, unknown>,
) {
  deps?.logKnowledge({ source, actor, tool, ok, result: truncate(result, 1000), meta });
}

/* Serialize mutations: one at a time, in order. */
function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const run = mutationChain.then(fn, fn);
  mutationChain = run.catch(() => undefined);
  return run;
}

/* Dirty-collection tracking so a mutation only writes changed files. */
const dirty = { experiences: false, attempts: false, feedback: false, audit: false, meta: false };

async function persistDirty(actor: string): Promise<{ ok: boolean; error?: string }> {
  /* No isOnline gate: bun realms can split the liveness flag from the live
   * socket. The writes themselves fail honestly when the workspace is truly
   * offline — that error is the real signal, not a cached flag. */
  if (!deps) {
    return { ok: false, error: 'module not initialized' };
  }
  const writes: Array<{ flag: 'experiences' | 'attempts' | 'feedback' | 'audit' | 'meta'; p: Promise<boolean> }> = [];
  if (dirty.experiences) writes.push({ flag: 'experiences', p: wsWriteFile(FILES.experiences, toJsonl(store.experiences)) });
  if (dirty.attempts) writes.push({ flag: 'attempts', p: wsWriteFile(FILES.attempts, toJsonl(store.attempts)) });
  if (dirty.feedback) writes.push({ flag: 'feedback', p: wsWriteFile(FILES.feedback, toJsonl(store.feedback)) });
  if (dirty.audit) writes.push({ flag: 'audit', p: wsWriteFile(FILES.audit, toJsonl(store.audit)) });
  if (dirty.meta) writes.push({ flag: 'meta', p: wsWriteFile(FILES.meta, JSON.stringify(store.meta, null, 2)) });
  const results = await Promise.all(writes.map((w) => w.p));
  /* Clear a dirty flag ONLY when its write succeeded: clearing on failure
   * leaves the mutation memory-only (the AUD-000036 incident class — a
   * failed flush must be retried by the next persist, not silently
   * forgotten). */
  let anyFailed = false;
  for (let i = 0; i < writes.length; i++) {
    if (results[i]) dirty[writes[i].flag] = false;
    else anyFailed = true;
  }
  persistLocalCache();
  if (anyFailed) {
    return { ok: false, error: 'writing the knowledge store to the workspace failed — the failed file(s) stay dirty and will be retried on the next write' };
  }
  void actor;
  return { ok: true };
}

function markAllDirty() {
  dirty.experiences = dirty.attempts = dirty.feedback = dirty.audit = dirty.meta = true;
}

/* ------------------------------------------------------------------ */
/* Sync — the workspace folder is the source of truth                  */
/* ------------------------------------------------------------------ */

const STORE_README = `# Knowledge Store

This folder is the shared, persistent engineering knowledge base of the
Workspace Bridge ("Adaptive Intelligence" layer). It is plain JSONL —
portable with the repo, versioned by git, and human-readable.

| File              | Contents                                              |
|-------------------|-------------------------------------------------------|
| experiences.jsonl | One experience record per line (nested version array) |
| attempts.jsonl    | Unsuccessful attempts — negative retrieval signal     |
| feedback.jsonl    | Reuse feedback: worked / failed / incompatible        |
| audit.jsonl       | Append-only audit history (never edit or truncate)    |
| meta.json         | Schema version + ID counters (managed by the bridge)  |

Lifecycle: candidate -> verification_pending -> verified | rejected,
then deprecated / archived / soft-deleted by the owner. A record only
becomes "verified" through the bridge's verification gate (checks run by
the service with real exit codes) or explicit owner approval on the
dashboard. Failed attempts are never shown as solutions — only warnings.

Edit records on the dashboard (or via the bridge CLI). Avoid hand-editing
JSONL while the bridge is running; if you do, use "knowledge sync" after.
`;

async function syncFromWorkspace(source: 'operator' | 'web' | 'system', actor: string): Promise<StoreState> {
  if (syncPromise) return syncPromise;
  syncPromise = (async () => {
    /* The WHOLE body runs inside try/finally: the offline early-return used
     * to skip the finally that clears syncPromise, poisoning every future
     * sync in this process with a cached "offline" result (web clients
     * reconnect faster than the extension after a restart — their connect
     * sync hit the offline branch first and the store never re-synced). */
    try {
    /* No isOnline gate: if the workspace is truly offline the meta read below
     * fails and the honest catch reports it. (A previous gate here poisoned
     * syncPromise with a cached "offline" result whenever web clients
     * reconnected faster than the extension after a restart.) */
    try {
      const meta = await wsReadFile(FILES.meta);
      if (meta.missing) {
        if (store.experiences.length > 0 || store.attempts.length > 0) {
          // folder lost on the workspace side but we hold a cache — self-heal
          markAllDirty();
          const w = await persistDirty(actor);
          await wsWriteFile(FILES.readme, STORE_README);
          store.note = w.ok ? 'knowledge folder was missing — cache re-published to the workspace' : 'knowledge folder missing and re-publish failed';
        } else {
          // fresh seed
          store.meta.counters = { exp: 0, att: 0, fbk: 0, aud: 0 };
          markAllDirty();
          await persistDirty(actor);
          await wsWriteFile(FILES.readme, STORE_README);
          store.note = 'knowledge folder created in the workspace — empty store seeded';
        }
      } else if (meta.ok) {
        const parsedMeta = JSON.parse(meta.text) as StoreState['meta'];
        if ((parsedMeta?.schemaVersion ?? 0) > SCHEMA_VERSION) {
          store.online = true;
          store.note = `workspace store schema v${parsedMeta.schemaVersion} is newer than this bridge (v${SCHEMA_VERSION}) — update the bridge before using knowledge`;
          deps?.broadcastState();
          return store;
        }
        const [exp, att, fbk, aud] = await Promise.all([
          wsReadFile(FILES.experiences),
          wsReadFile(FILES.attempts),
          wsReadFile(FILES.feedback),
          wsReadFile(FILES.audit),
        ]);
        const failures: string[] = [];
        const experiences = exp.ok ? parseJsonl<ExperienceRecord>(exp.text) : (failures.push('experiences'), null);
        const attempts = att.ok ? parseJsonl<AttemptRecord>(att.text) : (failures.push('attempts'), null);
        const feedback = fbk.ok ? parseJsonl<FeedbackRecord>(fbk.text) : (failures.push('feedback'), null);
        const auditRecs = aud.ok ? parseJsonl<AuditRecord>(aud.text) : (failures.push('audit'), null);
        store.experiences = experiences ? experiences.items : store.experiences;
        store.attempts = attempts ? attempts.items : store.attempts;
        store.feedback = feedback ? feedback.items : store.feedback;
        store.audit = auditRecs ? auditRecs.items.slice(-MAX_AUDIT_IN_MEMORY) : store.audit;
        store.meta = parsedMeta;
        store.syncedAt = Date.now();
        store.online = true;
        store.note =
          failures.length > 0 ? `some knowledge files could not be read (${failures.join(', ')}) — cached data kept for those collections` : undefined;
        // counters must never go backwards (protect IDs after hand edits)
        for (const e of store.experiences) {
          const n = parseInt(e.id?.slice(4) ?? '0', 10);
          if (Number.isFinite(n) && n > store.meta.counters.exp) store.meta.counters.exp = n;
        }
        for (const a of store.attempts) {
          const n = parseInt(a.id?.slice(4) ?? '0', 10);
          if (Number.isFinite(n) && n > store.meta.counters.att) store.meta.counters.att = n;
        }
        for (const f of store.feedback) {
          const n = parseInt(f.id?.slice(4) ?? '0', 10);
          if (Number.isFinite(n) && n > store.meta.counters.fbk) store.meta.counters.fbk = n;
        }
        for (const a of store.audit) {
          const n = parseInt(a.id?.slice(4) ?? '0', 10);
          if (Number.isFinite(n) && n > store.meta.counters.aud) store.meta.counters.aud = n;
        }
        persistLocalCache();
      } else {
        store.online = true;
        store.note = `could not read ${FILES.meta}: ${truncate(meta.text, 200)}`;
      }
      journal(source, actor, 'knowledge:sync', true,
        `Knowledge store synced with the workspace — ${store.experiences.length} experiences, ${store.attempts.length} attempts, ${store.audit.length} audit lines.`,
        { experiences: store.experiences.length, attempts: store.attempts.length, online: true });
      deps?.broadcastState();
      return store;
    } catch (e: unknown) {
      store.online = false;
      store.note = `sync failed: ${e instanceof Error ? e.message : String(e)}`;
      journal(source, actor, 'knowledge:sync', false, store.note);
      deps?.broadcastState();
      return store;
    }
    } finally {
      syncPromise = null;
    }
  })();
  return syncPromise;
}

/* ------------------------------------------------------------------ */
/* Search + ranking (plan §7 — metadata + text scoring, no vectors v1) */
/* ------------------------------------------------------------------ */

function statusWeight(s: ExperienceStatus): number {
  switch (s) {
    case 'verified': return 1.0;
    case 'candidate': return 0.4;
    case 'verification_pending': return 0.3;
    case 'rejected': return 0.15;
    case 'deprecated': return -0.4;
    case 'archived': return -1; // excluded below, kept for completeness
    default: return 0;
  }
}

function recencyBoost(iso: string): number {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return 0;
  const days = Math.max(0, (Date.now() - t) / 86_400_000);
  return 0.15 / (1 + days / 30);
}

function reuseSuccessRate(r: { used: number; worked: number; failed: number }): number {
  if (r.used <= 0) return 0;
  return (r.worked - r.failed) / r.used; // -1 .. 1
}

export interface SearchOptions {
  scope?: 'global' | 'project' | 'all';
  category?: string;
  limit?: number;
  includeRejected?: boolean;
  preflight?: boolean;
}

function search(query: string, opts: SearchOptions, source: 'operator' | 'web' | 'system', actor: string): SearchOutcome {
  const q = String(query ?? '').trim();
  if (!q) return { ok: false, query: q, hits: [], attemptWarnings: [], error: 'empty query' };

  const project = deps?.projectName() ?? null;
  const scopeFilter = opts.scope ?? 'all';
  const limit = Math.max(1, Math.min(20, opts.limit ?? DEFAULT_SEARCH_LIMIT));
  const qTokens = tokenize(q);

  const hits: SearchHit[] = [];
  for (const exp of store.experiences) {
    if (exp.deletedAt) continue;
    if (exp.status === 'archived') continue;
    if (exp.scope === 'project' && project && exp.projectId && exp.projectId !== project) continue; // project isolation
    if (scopeFilter !== 'all' && exp.scope !== scopeFilter) continue;
    if (opts.category && exp.category !== opts.category) continue;
    if (exp.status === 'rejected' && !opts.includeRejected) continue;

    const v = activeVersionOf(exp);
    if (!v) continue;

    const text = [exp.title, exp.problemSummary, exp.category, v.symptoms, v.rootCause, v.solutionSteps].join(' \n ');
    const overlap = textOverlap(qTokens, text);
    if (overlap <= 0) continue; // relevance gate — never surface unrelated records

    const scopeMatch = exp.scope === 'project' ? (exp.projectId === project ? 1 : 0) : 0.6;
    const score =
      3.0 * overlap +
      0.6 * scopeMatch +
      statusWeight(exp.status) +
      0.2 * reuseSuccessRate(exp.reuseStats) +
      recencyBoost(exp.updatedAt);

    hits.push({
      id: exp.id,
      title: exp.title,
      scope: exp.scope,
      projectId: exp.projectId,
      category: exp.category,
      status: exp.status,
      activeVersion: exp.activeVersion,
      score: Math.round(score * 1000) / 1000,
      problemSummary: truncate(exp.problemSummary, 400),
      solutionExcerpt: truncate(v.solutionSteps, 600),
      environment: v.environment,
      applicableVersions: v.applicableVersions,
      limitations: v.limitations,
      verificationStatus: v.verificationStatus,
      verificationSummary: v.verificationSummary,
      evidenceCount: v.evidence.length,
      reuseStats: exp.reuseStats,
      updatedAt: exp.updatedAt,
      warning: exp.status === 'deprecated',
    });
  }

  hits.sort((a, b) => b.score - a.score);
  const top = hits.slice(0, limit);

  const attemptWarnings = store.attempts
    .filter((a) => !a.experienceId)
    .map((a) => ({
      rec: a,
      score: 3.0 * textOverlap(qTokens, [a.problemSummary, a.approach, a.failureReason].join(' \n ')),
    }))
    .filter((x) => x.score > 0.6)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_ATTEMPT_WARNINGS)
    .map((x) => ({
      id: x.rec.id,
      problemSummary: truncate(x.rec.problemSummary, 300),
      approach: truncate(x.rec.approach, 300),
      failureReason: truncate(x.rec.failureReason, 300),
      result: x.rec.result,
      createdAt: x.rec.createdAt,
      score: Math.round(x.score * 1000) / 1000,
    }));

  const note =
    top.length === 0 && attemptWarnings.length === 0
      ? 'no relevant knowledge found — proceed normally and do not invent prior experience'
      : undefined;

  journal(source, actor, 'knowledge:' + (opts.preflight ? 'preflight' : 'search'), true,
    `${opts.preflight ? 'Experience preflight' : 'Knowledge search'} “${truncate(q, 120)}” → ${top.length} record(s)${attemptWarnings.length ? `, ${attemptWarnings.length} failed-attempt warning(s)` : ''}${note ? ` (${note})` : ''}.`,
    { query: truncate(q, 200), hits: top.map((h) => h.id), warnings: attemptWarnings.map((w) => w.id), preflight: !!opts.preflight });

  return { ok: true, query: q, hits: top, attemptWarnings, note };
}

/* ------------------------------------------------------------------ */
/* Submit / attempt / feedback (agent-writable surfaces)               */
/* ------------------------------------------------------------------ */

export interface SubmitInput {
  scope?: KnowledgeScope;
  category?: string;
  title?: string;
  problemSummary?: string;
  symptoms?: string;
  rootCause?: string;
  solutionSteps?: string;
  environment?: string;
  applicableVersions?: string;
  limitations?: string;
}

async function submitExperience(
  input: SubmitInput,
  source: 'operator' | 'web',
  actor: string,
  sessionId = 'z.ai-web',
): Promise<{ ok: boolean; id?: string; flagged?: boolean; error?: string }> {
  return enqueue(async () => {
    const title = String(input.title ?? '').trim();
    const problem = String(input.problemSummary ?? '').trim();
    const solution = String(input.solutionSteps ?? '').trim();
    if (!title || !problem || !solution) {
      return { ok: false, error: 'title, problemSummary and solutionSteps are required' };
    }
    const scope: KnowledgeScope = input.scope === 'project' ? 'project' : 'global';
    const category = CATEGORIES.includes((input.category ?? '') as typeof CATEGORIES[number]) ? input.category! : 'other';

    const blob = [title, problem, solution, input.symptoms, input.rootCause, input.environment].join('\n');
    const secrets = scanSecrets(blob);
    if (secrets.blocked) {
      journal(source, actor, 'knowledge:submit', false,
        'Submission BLOCKED: the content matches a high-confidence secret pattern (private key / API token). Secrets must never be stored (plan §13.8).');
      return { ok: false, error: 'submission blocked: content appears to contain a secret (private key / API token) — remove it and resubmit' };
    }

    const id = nextId('exp');
    const rec: ExperienceRecord = {
      id,
      scope,
      projectId: scope === 'project' ? deps?.projectName() ?? null : null,
      category,
      title: truncate(title, 300),
      problemSummary: truncate(problem, 2000),
      status: 'candidate',
      activeVersion: 1,
      versions: [
        {
          version: 1,
          createdBy: actor,
          createdAt: nowIso(),
          symptoms: truncate(input.symptoms ?? '', 2000),
          rootCause: truncate(input.rootCause ?? '', 2000),
          solutionSteps: truncate(solution, 6000),
          environment: truncate(input.environment ?? '', 1000),
          applicableVersions: truncate(input.applicableVersions ?? '', 500),
          limitations: truncate(input.limitations ?? '', 1000),
          verificationStatus: 'pending',
          verificationSummary: 'not verified yet — run knowledge verify with real checks, or approve on the dashboard',
          evidence: [],
        },
      ],
      reuseStats: { used: 0, worked: 0, failed: 0 },
      createdBy: actor,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      archivedAt: null,
      deletedAt: null,
    };
    store.experiences.push(rec);
    audit(actor, 'experience_submit', 'experience', id, { reason: truncate(problem, 300) });
    dirty.experiences = true;
    dirty.meta = true;
    const w = await persistDirty(actor);
    journal(source, actor, 'knowledge:submit', w.ok,
      w.ok
        ? `Experience ${id} submitted as candidate${secrets.warned ? ' (⚠ possible secret-like text — review before promoting to global)' : ''}: “${truncate(title, 120)}”. ${w.ok ? `Saved to ${FILES.experiences}.` : ''}`
        : `Experience ${id} created in memory but NOT saved: ${w.error}`,
      { id, scope, category, flagged: secrets.warned || undefined, saved: w.ok });
    deps?.broadcastState();
    return { ok: w.ok, id, flagged: secrets.warned || undefined, error: w.ok ? undefined : w.error };
  });
}

export interface AttemptInput {
  problemSummary?: string;
  approach?: string;
  result?: AttemptResult;
  failureReason?: string;
  environment?: string;
  experienceId?: string;
}

async function recordAttempt(
  input: AttemptInput,
  source: 'operator' | 'web',
  actor: string,
  sessionId = 'z.ai-web',
): Promise<{ ok: boolean; id?: string; error?: string }> {
  return enqueue(async () => {
    const problem = String(input.problemSummary ?? '').trim();
    const approach = String(input.approach ?? '').trim();
    if (!problem || !approach) {
      return { ok: false, error: 'problemSummary and approach are required' };
    }
    const result: AttemptResult =
      input.result === 'partially_resolved' || input.result === 'unresolved' ? input.result : 'failed';
    const id = nextId('att');
    const rec: AttemptRecord = {
      id,
      experienceId: input.experienceId && findExperience(input.experienceId) ? input.experienceId : null,
      projectId: deps?.projectName() ?? null,
      sessionId,
      problemSummary: truncate(problem, 2000),
      approach: truncate(approach, 4000),
      result,
      failureReason: truncate(input.failureReason ?? '', 2000),
      environment: truncate(input.environment ?? '', 1000),
      createdAt: nowIso(),
    };
    store.attempts.push(rec);
    audit(actor, 'attempt_record', 'attempt', id, { reason: truncate(problem, 300) });
    dirty.attempts = true;
    dirty.meta = true;
    const w = await persistDirty(actor);
    journal(source, actor, 'knowledge:attempt', w.ok,
      w.ok ? `Unsuccessful attempt ${id} recorded — future sessions retrieve it as a warning, not a solution.` : `Attempt ${id} NOT saved: ${w.error}`,
      { id, result, saved: w.ok });
    deps?.broadcastState();
    return { ok: w.ok, id, error: w.error };
  });
}

export interface FeedbackInput {
  experienceId?: string;
  outcome?: FeedbackOutcome;
  notes?: string;
}

async function recordFeedback(
  input: FeedbackInput,
  source: 'operator' | 'web',
  actor: string,
  sessionId = 'z.ai-web',
): Promise<{ ok: boolean; id?: string; error?: string }> {
  return enqueue(async () => {
    const exp = findExperience(String(input.experienceId ?? ''));
    if (!exp) return { ok: false, error: `unknown experience "${input.experienceId}"` };
    const outcome: FeedbackOutcome =
      input.outcome === 'failed' || input.outcome === 'incompatible' ? input.outcome : 'worked';
    const id = nextId('fbk');
    store.feedback.push({
      id,
      experienceId: exp.id,
      experienceVersion: exp.activeVersion,
      sessionId,
      outcome,
      notes: truncate(input.notes ?? '', 1000),
      createdAt: nowIso(),
    });
    exp.reuseStats.used += 1;
    if (outcome === 'worked') exp.reuseStats.worked += 1;
    if (outcome === 'failed') exp.reuseStats.failed += 1;
    exp.updatedAt = nowIso();
    audit(actor, 'experience_feedback', 'feedback', id, {
      reason: `${outcome} for ${exp.id} v${exp.activeVersion}`,
    });
    dirty.feedback = true;
    dirty.experiences = true;
    dirty.meta = true;
    const w = await persistDirty(actor);
    journal(source, actor, 'knowledge:feedback', w.ok,
      w.ok ? `Reuse feedback recorded for ${exp.id} v${exp.activeVersion}: ${outcome}.` : `Feedback NOT saved: ${w.error}`,
      { id, experienceId: exp.id, outcome, saved: w.ok });
    deps?.broadcastState();
    return { ok: w.ok, id, error: w.error };
  });
}

/* ------------------------------------------------------------------ */
/* Verification gate + promotion (plan §5.1, §5.2)                     */
/* ------------------------------------------------------------------ */

export interface VerifyOutcome {
  ok: boolean;
  id?: string;
  version?: number;
  promoted?: boolean;
  verificationStatus?: VerificationStatus;
  checks?: Array<{ command: string; exitCode: number | null; timedOut: boolean; passed: boolean; journalRef?: string }>;
  error?: string;
}

async function verifyExperience(
  id: string,
  checks: CheckSpec[],
  source: 'operator' | 'web',
  actor: string,
  versionOverride?: number,
): Promise<VerifyOutcome> {
  return enqueue(async () => {
    const exp = findExperience(id);
    if (!exp) return { ok: false, error: `unknown experience "${id}"` };
    const list = (checks ?? []).filter((c) => c && String(c.command ?? '').trim());
    if (list.length === 0) {
      return { ok: false, error: 'at least one check command is required — a successful exit code alone is not evidence unless it exercises the original failure' };
    }
    if (!deps) {
      return { ok: false, error: 'knowledge module not initialized' };
    }
    const version = exp.versions.find((v) => v.version === (versionOverride ?? exp.activeVersion));
    if (!version) return { ok: false, error: `version ${versionOverride ?? exp.activeVersion} not found on ${id}` };

    // capture the ORIGINAL state before the pending transition — the
    // fail/pass branches below must reason about pre-verification trust
    const originalStatus = exp.status;
    const originalActive = exp.activeVersion;
    const wasActiveVerified = originalStatus === 'verified' && originalActive === version.version;
    const otherTrustedActive = originalStatus === 'verified' && originalActive !== version.version;
    exp.status = 'verification_pending';
    exp.updatedAt = nowIso();
    dirty.experiences = true;
    await persistDirty(actor);

    const results: VerifyOutcome['checks'] = [];
    let allPassed = true;
    let anyUnable = false;
    for (const c of list) {
      const r = await deps.runCheck(c.command, c.timeoutMs);
      const passed = r.ok && !r.timedOut && r.exitCode === 0;
      if (r.timedOut || r.exitCode === null) anyUnable = true;
      else if (!passed) allPassed = false;
      results.push({ command: c.command, exitCode: r.exitCode, timedOut: r.timedOut, passed, journalRef: r.entryId });
      version.evidence.push({
        ts: Date.now(),
        source: 'run_command',
        command: truncate(c.command, 500),
        exitCode: r.exitCode,
        timedOut: r.timedOut,
        summary: truncate(r.result, 400),
        journalRef: r.entryId,
        actor,
      });
    }
    if (version.evidence.length > MAX_EVIDENCE_PER_VERSION) {
      version.evidence.splice(0, version.evidence.length - MAX_EVIDENCE_PER_VERSION);
    }

    let promoted = false;
    let verificationStatus: VerificationStatus;
    if (anyUnable && allPassed) {
      verificationStatus = 'unable_to_verify';
      version.verificationStatus = 'unable_to_verify';
      version.verificationSummary = `${results.length} check(s) ran but at least one produced no usable exit code (timeout / spawn failure) — NOT promoted`;
      // honest uncertainty: the verified target stays pending; a proposal that
      // could not be verified never demotes its trusted active version
      exp.status = otherTrustedActive ? 'verified' : 'verification_pending';
    } else if (allPassed) {
      verificationStatus = 'passed';
      version.verificationStatus = 'passed';
      version.verificationSummary = `verification gate PASSED — ${results.length} check(s) executed by the bridge on the workspace, all exit 0 (evidence refs: ${results.map((r) => r.journalRef ?? '?').join(', ')})`;
      exp.activeVersion = version.version;
      exp.status = 'verified';
      promoted = true;
      audit(actor, 'experience_promote', 'experience', exp.id, {
        oldVersion: originalActive,
        newVersion: version.version,
        reason: 'verification gate: all checks exit 0',
      });
    } else {
      verificationStatus = 'failed';
      version.verificationStatus = 'failed';
      version.verificationSummary = `verification gate FAILED — ${results.filter((r) => !r.passed).length}/${results.length} check(s) did not pass`;
      if (wasActiveVerified) {
        // the ACTIVE version of a verified record failed re-verification —
        // honest demotion: no longer recommended (plan §5 state table)
        exp.status = 'deprecated';
      } else if (otherTrustedActive) {
        // a PROPOSAL failed while a different version stays trusted —
        // the trusted version remains active and verified (plan §16)
        exp.status = 'verified';
      } else {
        exp.status = 'rejected'; // candidate rejected by evidence
      }
    }
    exp.updatedAt = nowIso();
    dirty.experiences = true;
    dirty.audit = true;
    const w = await persistDirty(actor);
    journal(source, actor, 'knowledge:verify', w.ok && verificationStatus !== 'failed',
      `${exp.id} v${version.version} verification ${verificationStatus.toUpperCase()}${promoted ? ' → PROMOTED to verified' : ''}: ${results.map((r) => `exit ${r.exitCode ?? 'n/a'}`).join(', ')}.${w.ok ? '' : ` (⚠ store save failed: ${w.error})`}`,
      { id: exp.id, version: version.version, verificationStatus, promoted, checks: results, saved: w.ok });
    deps?.broadcastState();
    return { ok: w.ok, id: exp.id, version: version.version, promoted, verificationStatus, checks: results, error: w.error };
  });
}

/* ------------------------------------------------------------------ */
/* Improvement proposals (plan §9)                                     */
/* ------------------------------------------------------------------ */

export interface ProposalInput {
  solutionSteps?: string;
  symptoms?: string;
  rootCause?: string;
  environment?: string;
  applicableVersions?: string;
  limitations?: string;
  compatibilityNotes?: string;
  reason?: string;
  /**
   * Optional corrections of RECORD-LEVEL metadata (title / problemSummary).
   * Used when a technical review retracts a claim that lives outside the
   * versioned fields. The original values are snapshotted verbatim into the
   * new version's recordFieldChanges before the record is updated — the
   * active pointer still does not move until the proposal passes the gate.
   */
  title?: string;
  problemSummary?: string;
}

async function proposeImprovement(
  id: string,
  input: ProposalInput,
  source: 'operator' | 'web',
  actor: string,
): Promise<{ ok: boolean; id?: string; proposedVersion?: number; error?: string }> {
  return enqueue(async () => {
    const exp = findExperience(id);
    if (!exp) return { ok: false, error: `unknown experience "${id}"` };
    const solution = String(input.solutionSteps ?? '').trim();
    const reason = String(input.reason ?? '').trim();
    if (!solution || !reason) return { ok: false, error: 'solutionSteps and reason are required' };

    const secrets = scanSecrets(solution + reason);
    if (secrets.blocked) {
      return { ok: false, error: 'proposal blocked: content appears to contain a secret (private key / API token)' };
    }

    const maxV = exp.versions.reduce((m, v) => Math.max(m, v.version), 0);
    const proposedVersion = maxV + 1;
    const previousActive = exp.activeVersion;

    // Record-level corrections (title / problemSummary) are snapshotted BEFORE
    // the record is touched, so the prior wording survives verbatim on the
    // version that caused the change (plan §9: revisions, never overwrites).
    const newTitle = String(input.title ?? '').trim();
    const newProblem = String(input.problemSummary ?? '').trim();
    const recordFieldChanges: NonNullable<ExperienceVersion['recordFieldChanges']> = {};
    if (newTitle && newTitle !== exp.title) {
      recordFieldChanges.title = { from: exp.title, to: truncate(newTitle, 300) };
    }
    if (newProblem && newProblem !== exp.problemSummary) {
      recordFieldChanges.problemSummary = { from: exp.problemSummary, to: truncate(newProblem, 2000) };
    }
    const revisedRecordFields = Object.keys(recordFieldChanges);

    exp.versions.push({
      version: proposedVersion,
      createdBy: actor,
      createdAt: nowIso(),
      symptoms: truncate(input.symptoms ?? activeVersionOf(exp)?.symptoms ?? '', 2000),
      rootCause: truncate(input.rootCause ?? activeVersionOf(exp)?.rootCause ?? '', 2000),
      solutionSteps: truncate(solution, 6000),
      environment: truncate(input.environment ?? activeVersionOf(exp)?.environment ?? '', 1000),
      applicableVersions: truncate(input.applicableVersions ?? activeVersionOf(exp)?.applicableVersions ?? '', 500),
      limitations: truncate(input.limitations ?? '', 1000),
      compatibilityNotes: truncate(input.compatibilityNotes ?? '', 1000),
      changeReason: truncate(reason, 1000),
      verificationStatus: 'pending',
      verificationSummary: 'proposal awaiting verification — the currently active version stays trusted until this passes the gate',
      evidence: [],
      supersedes: previousActive,
      ...(revisedRecordFields.length > 0 ? { recordFieldChanges } : {}),
    });
    // Apply the record-level corrections only after the snapshot is stored.
    if (recordFieldChanges.title) exp.title = recordFieldChanges.title.to;
    if (recordFieldChanges.problemSummary) exp.problemSummary = recordFieldChanges.problemSummary.to;
    // The active pointer does NOT move yet. A previously rejected/deprecated
    // record becomes a candidate again; a verified one stays verified (v-old).
    if (exp.status === 'rejected' || exp.status === 'deprecated') exp.status = 'candidate';
    exp.updatedAt = nowIso();
    audit(actor, 'experience_propose', 'experience', exp.id, {
      oldVersion: previousActive,
      newVersion: proposedVersion,
      reason: truncate(reason + (revisedRecordFields.length > 0 ? ` [record-level fields revised, originals preserved on v${proposedVersion}: ${revisedRecordFields.join(', ')}]` : ''), 300),
    });
    dirty.experiences = true;
    dirty.meta = true;
    const w = await persistDirty(actor);
    journal(source, actor, 'knowledge:propose', w.ok,
      w.ok
        ? `Improvement proposal for ${exp.id} stored as version ${proposedVersion} (supersedes v${previousActive}).${revisedRecordFields.length > 0 ? ` Record-level field(s) corrected with originals preserved on v${proposedVersion}: ${revisedRecordFields.join(', ')}.` : ''} The active version stays v${exp.activeVersion} until the proposal passes verification.`
        : `Proposal for ${exp.id} NOT saved: ${w.error}`,
      { id: exp.id, proposedVersion, activeVersion: exp.activeVersion, saved: w.ok });
    deps?.broadcastState();
    return { ok: w.ok, id: exp.id, proposedVersion, error: w.error };
  });
}

/* ------------------------------------------------------------------ */
/* Owner actions — paired dashboard ONLY (never the admin API)         */
/* ------------------------------------------------------------------ */

export type OwnerAction = 'approve' | 'reject' | 'deprecate' | 'archive' | 'restore' | 'delete';

async function ownerAction(
  id: string,
  action: OwnerAction,
  reason: string,
  actor: string,
  versionOverride?: number,
): Promise<{ ok: boolean; record?: ExperienceRecord; error?: string }> {
  return enqueue(async () => {
    const exp = findExperience(id);
    if (!exp) return { ok: false, error: `unknown experience "${id}"` };
    const why = truncate(reason, 500) || `owner ${action} from dashboard`;

    switch (action) {
      case 'approve': {
        const version = exp.versions.find((v) => v.version === (versionOverride ?? exp.activeVersion));
        if (!version) return { ok: false, error: `version ${versionOverride ?? exp.activeVersion} not found` };
        const oldActive = exp.activeVersion;
        version.verificationStatus = 'human_approved';
        version.verificationSummary = `owner approval on the dashboard by ${actor} — human review stands in for automated checks`;
        exp.activeVersion = version.version;
        exp.status = 'verified';
        audit(actor, 'experience_promote', 'experience', exp.id, { oldVersion: oldActive, newVersion: version.version, reason: why });
        break;
      }
      case 'reject': {
        const version = exp.versions.find((v) => v.version === (versionOverride ?? exp.activeVersion));
        if (version && version.verificationStatus === 'pending') {
          version.verificationStatus = 'failed';
          version.verificationSummary = `rejected by owner: ${why}`;
        }
        exp.status = 'rejected';
        audit(actor, 'experience_reject', 'experience', exp.id, { reason: why });
        break;
      }
      case 'deprecate': {
        exp.status = 'deprecated';
        audit(actor, 'experience_deprecate', 'experience', exp.id, { reason: why });
        break;
      }
      case 'archive': {
        exp.status = 'archived';
        exp.archivedAt = nowIso();
        audit(actor, 'experience_archive', 'experience', exp.id, { reason: why });
        break;
      }
      case 'restore': {
        if (!exp.archivedAt && exp.status !== 'deprecated' && exp.status !== 'rejected') {
          return { ok: false, error: 'record is not archived/deprecated/rejected — nothing to restore' };
        }
        exp.status = 'candidate'; // honest default: re-verify to re-trust
        exp.archivedAt = null;
        audit(actor, 'experience_restore', 'experience', exp.id, { reason: `${why} (restored as candidate — re-verify to re-trust)` });
        break;
      }
      case 'delete': {
        if (exp.deletedAt) return { ok: false, error: 'record already deleted' };
        exp.deletedAt = nowIso(); // soft delete — audit history is preserved (plan §9)
        audit(actor, 'experience_delete', 'experience', exp.id, { reason: why });
        break;
      }
      default:
        return { ok: false, error: `unknown action "${action}"` };
    }

    exp.updatedAt = nowIso();
    dirty.experiences = true;
    dirty.audit = true;
    const w = await persistDirty(actor);
    journal('web', actor, 'knowledge:action', w.ok,
      w.ok ? `Owner action “${action}” on ${exp.id}: ${why}` : `Owner action “${action}” on ${exp.id} NOT saved: ${w.error}`,
      { id: exp.id, action, saved: w.ok });
    deps?.broadcastState();
    return { ok: w.ok, record: exp, error: w.error };
  });
}

/* ------------------------------------------------------------------ */
/* Read APIs + dashboard state                                         */
/* ------------------------------------------------------------------ */

function getExperience(id: string): { ok: boolean; record?: ExperienceRecord; feedback?: FeedbackRecord[]; error?: string } {
  const exp = findExperience(id);
  if (!exp) return { ok: false, error: `unknown experience "${id}"` };
  return { ok: true, record: exp, feedback: store.feedback.filter((f) => f.experienceId === id).slice(-50).reverse() };
}

function counts(): KnowledgeCounts {
  const live = store.experiences.filter((e) => !e.deletedAt);
  return {
    verified: live.filter((e) => e.status === 'verified').length,
    candidate: live.filter((e) => e.status === 'candidate').length,
    verificationPending: live.filter((e) => e.status === 'verification_pending').length,
    rejected: live.filter((e) => e.status === 'rejected').length,
    deprecated: live.filter((e) => e.status === 'deprecated').length,
    archived: live.filter((e) => e.status === 'archived').length,
    deleted: store.experiences.filter((e) => e.deletedAt).length,
    attempts: store.attempts.length,
    feedback: store.feedback.length,
    audit: store.audit.length,
  };
}

function summary(): KnowledgeSummary {
  return {
    ok: true,
    online: store.online,
    syncedAt: store.syncedAt,
    note: store.note,
    counts: counts(),
    projectName: deps?.projectName() ?? null,
  };
}

function stateForWeb() {
  return {
    ok: true,
    online: store.online,
    syncedAt: store.syncedAt,
    note: store.note,
    counts: counts(),
    projectName: deps?.projectName() ?? null,
    storeDir: STORE_DIR,
    experiences: store.experiences
      .filter((e) => !e.deletedAt)
      .map((e) => ({
        ...e,
        versions: e.versions.map((v) => ({
          ...v,
          evidence: v.evidence.slice(-10).map((ev) => ({ ...ev, summary: truncate(ev.summary, 300) })),
        })),
      })),
    attempts: store.attempts.slice(-100).reverse(),
    feedback: store.feedback.slice(-100).reverse(),
    audit: store.audit.slice(-100).reverse(),
  };
}

/* ------------------------------------------------------------------ */
/* Init — hot-reload probe comment */
/* ------------------------------------------------------------------ */

export interface KnowledgeApi {
  sync: (source?: 'operator' | 'web' | 'system', actor?: string) => Promise<StoreState>;
  search: (query: string, opts: SearchOptions, source?: 'operator' | 'web' | 'system', actor?: string) => SearchOutcome;
  submit: (input: SubmitInput, source: 'operator' | 'web', actor: string, sessionId?: string) => Promise<{ ok: boolean; id?: string; flagged?: boolean; error?: string }>;
  attempt: (input: AttemptInput, source: 'operator' | 'web', actor: string, sessionId?: string) => Promise<{ ok: boolean; id?: string; error?: string }>;
  feedback: (input: FeedbackInput, source: 'operator' | 'web', actor: string, sessionId?: string) => Promise<{ ok: boolean; id?: string; error?: string }>;
  verify: (id: string, checks: CheckSpec[], source: 'operator' | 'web', actor: string, version?: number) => Promise<VerifyOutcome>;
  propose: (id: string, input: ProposalInput, source: 'operator' | 'web', actor: string) => Promise<{ ok: boolean; id?: string; proposedVersion?: number; error?: string }>;
  ownerAction: (id: string, action: OwnerAction, reason: string, actor: string, version?: number) => Promise<{ ok: boolean; record?: ExperienceRecord; error?: string }>;
  get: (id: string) => { ok: boolean; record?: ExperienceRecord; feedback?: FeedbackRecord[]; error?: string };
  summary: () => KnowledgeSummary;
  stateForWeb: () => ReturnType<typeof stateForWeb>;
  categories: readonly string[];
}

export function initKnowledge(
  injected: KnowledgeDeps & {
    /** raw extension tool exec used for store-file sync (not journaled) */
    rawExec: typeof rawExec;
  },
): KnowledgeApi {
  deps = injected;
  rawExec = injected.rawExec;
  cacheFile = join(injected.dataDir, 'knowledge-cache.json');
  loadLocalCache();
  return {
    sync: (source = 'system', actor = 'System') => syncFromWorkspace(source, actor),
    search: (query, opts, source = 'operator', actor = 'GLM (z.ai web)') => search(query, opts, source, actor),
    submit: submitExperience,
    attempt: recordAttempt,
    feedback: recordFeedback,
    verify: verifyExperience,
    propose: proposeImprovement,
    ownerAction,
    get: getExperience,
    summary,
    stateForWeb,
    categories: CATEGORIES,
  };
}
