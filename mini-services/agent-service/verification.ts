/**
 * verification.ts — the Workspace Bridge SCIENTIFIC VERIFICATION ENGINE (v1).
 *
 * Extends the knowledge layer (knowledge.ts) with an evidence-driven
 * verification lifecycle. Core principle (spec §1):
 *
 *   AI-generated reasoning is not experimental evidence. GLM designs the
 *   experiments and interprets results — the BRIDGE executes the tests,
 *   records the real outputs/exit codes/durations, evaluates PASS/FAIL
 *   against the declared criteria, computes the statistics, and decides
 *   whether the evidence supports the proposed conclusion.
 *
 * Verification states (spec §3) — independent of knowledge approval:
 *   PENDING → PLANNING → READY → TESTING → ANALYZING →
 *   VERIFIED | PARTIALLY_VERIFIED | FAILED | BLOCKED
 *
 * A run never changes a knowledge record's approval status. Tests passing
 * does NOT approve knowledge — the owner stays in control (spec §3, §6F).
 *
 * Store files (workspace-relative, git-versioned, portable):
 *   knowledge/verification/runs.jsonl       one run per line (steps, rounds,
 *                                           analyses, conclusion, feedback)
 *   knowledge/verification/cases.jsonl      test cases (the plan)
 *   knowledge/verification/attempts.jsonl   every real execution attempt
 *   knowledge/verification/metrics.jsonl    measured/reported metrics
 *   knowledge/verification/evidence.jsonl   evidence artifacts (+ files in
 *                                           knowledge/verification/evidence/)
 *   knowledge/verification/meta.json        schema version + ID counters
 *   knowledge/verification/README.md        self-documentation
 *
 * Security (spec §9): commands run on the user's machine through the VS Code
 * extension (the existing trust model of the bridge). Enforced here: per-test
 * timeouts, a run time budget, secret redaction before persistence, owner
 * confirmation for tests flagged network/destructive, cancellation between
 * tests, and BLOCKED (never silent execution) for requirements we cannot
 * enforce. CPU/memory isolation is NOT enforceable through this transport —
 * documented honestly instead of pretended.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export type VRunStatus =
  | 'PENDING'
  | 'PLANNING'
  | 'READY'
  | 'TESTING'
  | 'ANALYZING'
  | 'PARTIALLY_VERIFIED'
  | 'VERIFIED'
  | 'FAILED'
  | 'BLOCKED';

export type VConclusionStatus = 'VERIFIED' | 'PARTIALLY_VERIFIED' | 'FAILED' | 'BLOCKED';
export type VStepStatus = 'pending' | 'running' | 'complete' | 'failed' | 'skipped';
export type VCaseStatus = 'NOT_EXECUTED' | 'PASS' | 'FAIL' | 'ERROR' | 'SKIPPED' | 'BLOCKED';
export type VAttemptStatus = 'PASS' | 'FAIL' | 'ERROR' | 'BLOCKED';
export type VCaseCategory =
  | 'unit' | 'integration' | 'functional' | 'regression' | 'boundary'
  | 'negative' | 'edge-case' | 'performance' | 'validation' | 'other';
export type VSource = 'operator' | 'web' | 'system';

export interface VStep {
  n: number;
  name: string;
  status: VStepStatus;
  startedAt: number | null;
  completedAt: number | null;
  durationMs: number | null;
  details: string;
}

export interface VRound {
  n: number;
  kind: 'initial' | 'regression';
  hypothesis: string;
  expectedObservation: string;
  changeNote: string;
  createdAt: string;
  outcome: string;
}

export interface VStats {
  planned: number;
  generated: number;
  executed: number;
  passed: number;
  failed: number;
  skipped: number;
  blocked: number;
  errors: number;
  attempts: number;
  iterations: number;
  /** Passed / (Passed + Failed) * 100 — null when nothing executed (N/A). */
  passRate: number | null;
}

export interface VAnalysis {
  id: string;
  round: number;
  submittedBy: string;
  createdAt: string;
  summary: string;
  comparison: string;
  alternativeExplanations: string;
  recommendedModifications: string;
  proposedConclusion: { status: VConclusionStatus; summary: string };
  engineDecision: { accepted: boolean; effectiveStatus: VConclusionStatus; reason: string };
  metricIds: string[];
}

export interface VConclusion {
  status: VConclusionStatus;
  summary: string;
  glmInterpretation: string;
  stats: VStats;
  decidedAt: string;
  decidedBy: string;
}

export interface VProblem {
  description: string;
  symptoms: string;
  expectedBehavior: string;
  actualBehavior: string;
  facts: string;
  assumptions: string;
  environment: string;
  constraints: string;
}

export interface VHypothesis {
  text: string;
  expectedObservation: string;
  supportingEvidence: string;
  contradictingEvidence: string;
}

export interface VFeedback {
  id: string;
  decision: 'accept' | 'reject' | 'comment';
  comment: string;
  actor: string;
  createdAt: string;
}

export interface VEnvironmentSnapshot {
  capturedAt: number;
  os: string;
  runtimes: string;
  sourceRevision: string | null;
  journalRefs: string[];
}

export interface VRun {
  id: string;
  knowledgeId: string;
  knowledgeVersion: number;
  title: string;
  problem: VProblem;
  hypothesis: VHypothesis;
  strategy: string;
  status: VRunStatus;
  currentStage: number;
  steps: VStep[];
  rounds: VRound[];
  analyses: VAnalysis[];
  environmentSnapshot: VEnvironmentSnapshot | null;
  stats: VStats;
  conclusion: VConclusion | null;
  cancelled: boolean;
  cancelReason: string;
  timeBudgetMs: number;
  elapsedMs: number;
  needsDangerousConfirm: boolean;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  reportEvidenceId: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  feedback: VFeedback[];
}

export interface VCriteria {
  exitCode: number;
  outputContains: string[];
  outputNotContains: string[];
}

export interface VTestCase {
  id: string;
  runId: string;
  round: number;
  name: string;
  objective: string;
  category: VCaseCategory;
  command: string;
  timeoutMs: number;
  expected: { expectedResult: string; successCriteria: string; failureCriteria: string };
  criteria: VCriteria;
  flags: { critical: boolean; requiresNetwork: boolean; destructive: boolean };
  status: VCaseStatus;
  latestAttemptId: string | null;
  createdAt: string;
}

export interface VAttempt {
  id: string;
  testCaseId: string;
  runId: string;
  round: number;
  attemptNumber: number;
  status: VAttemptStatus;
  command: string;
  exitCode: number | null;
  timedOut: boolean;
  output: string;
  durationMs: number;
  startedAt: string;
  completedAt: string;
  journalRef: string | null;
  evaluatedBy: string;
  note: string;
}

export interface VMetric {
  id: string;
  runId: string;
  testCaseId: string | null;
  name: string;
  value: string;
  unit: string;
  source: 'measured' | 'reported';
  verified: boolean;
  recordedAt: string;
}

export interface VEvidence {
  id: string;
  runId: string;
  testCaseId: string | null;
  type: 'report' | 'log' | 'dataset' | 'config' | 'screenshot' | 'other';
  filename: string;
  storageRef: string;
  sha256: string;
  bytes: number;
  createdAt: string;
  createdBy: string;
}

/* Run payload sent to the dashboard */
export interface VRunForWeb {
  id: string;
  knowledgeId: string;
  knowledgeVersion: number;
  title: string;
  status: VRunStatus;
  currentStage: number;
  stageName: string;
  hypothesis: string;
  stats: VStats;
  needsDangerousConfirm: boolean;
  cancelled: boolean;
  startedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
  createdBy: string;
  conclusion: VConclusion | null;
}

export interface VRunDetail {
  run: VRun;
  cases: VTestCase[];
  attempts: VAttempt[];
  metrics: VMetric[];
  evidence: VEvidence[];
}

export interface VCounts {
  total: number;
  byStatus: Record<VRunStatus, number>;
  cases: number;
  attempts: number;
  evidence: number;
}

export interface VStateForWeb {
  ok: boolean;
  online: boolean;
  syncedAt: number | null;
  note?: string;
  counts: VCounts;
  runs: VRunForWeb[];
}

/* ------------------------------------------------------------------ */
/* Inputs (from the admin API / dashboard / CLI)                       */
/* ------------------------------------------------------------------ */

export interface CreateRunInput {
  knowledgeId: string;
  knowledgeVersion?: number;
  title?: string;
  problem?: Partial<VProblem>;
  hypothesis?: Partial<VHypothesis>;
  strategy?: string;
}

export interface CaseInput {
  name: string;
  objective?: string;
  category?: string;
  command: string;
  timeoutMs?: number;
  expected?: Partial<VTestCase['expected']>;
  criteria?: Partial<VCriteria>;
  flags?: Partial<VTestCase['flags']>;
}

export interface PlanInput {
  runId: string;
  experiments?: string;
  cases: CaseInput[];
}

export interface AnalysisInput {
  runId: string;
  summary?: string;
  comparison?: string;
  alternativeExplanations?: string;
  recommendedModifications?: string;
  proposedConclusion?: { status?: string; summary?: string };
  metrics?: Array<{ name: string; value: string | number; unit?: string; testCaseId?: string }>;
}

export interface CaseUpdateInput {
  id: string;
  name?: string;
  objective?: string;
  command?: string;
  timeoutMs?: number;
  expected?: Partial<VTestCase['expected']>;
  criteria?: Partial<VCriteria>;
  reason?: string;
}

export interface RegressInput {
  runId: string;
  hypothesis?: string;
  expectedObservation?: string;
  changeNote?: string;
  /** Case IDs to RE-EXECUTE this round (attempts preserved as history, spec §11). */
  retry?: string[];
  /** Case DEFINITION revisions (criteria/command corrections from failure investigation). */
  updates?: CaseUpdateInput[];
  cases: CaseInput[];
}

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

const STORE_DIR = 'knowledge/verification';
const FILES = {
  runs: `${STORE_DIR}/runs.jsonl`,
  cases: `${STORE_DIR}/cases.jsonl`,
  attempts: `${STORE_DIR}/attempts.jsonl`,
  metrics: `${STORE_DIR}/metrics.jsonl`,
  evidence: `${STORE_DIR}/evidence.jsonl`,
  meta: `${STORE_DIR}/meta.json`,
  readme: `${STORE_DIR}/README.md`,
} as const;

export function verificationSandboxDir(runId: string): string {
  return `${STORE_DIR}/sandbox/${runId}`;
}
export function verificationEvidenceDir(runId: string): string {
  return `${STORE_DIR}/evidence/${runId}`;
}

const SCHEMA_VERSION = 1;
const STAGES = [
  'Problem Analysis',
  'Hypothesis Formulation',
  'Experiment Design',
  'Test Plan Generation',
  'Environment Preparation',
  'Test Execution',
  'Result Analysis',
  'Regression Testing',
  'Final Verification',
  'Report Generation',
] as const;
const CASE_CATEGORIES: readonly string[] = [
  'unit', 'integration', 'functional', 'regression', 'boundary',
  'negative', 'edge-case', 'performance', 'validation', 'other',
];
const MAX_SYNC_READ_CHARS = 1_400_000;
const MAX_ATTEMPT_OUTPUT_CHARS = 20_000;
/** Test-case commands are REFUSED beyond this length — never silently
 *  truncated. A truncated command changes semantics and executes as garbage
 *  (observed in VRUN-000003 round 1: five cases were mangled by the old
 *  truncate() and failed with SyntaxErrors). Long experiment scripts belong
 *  in the run sandbox dir (knowledge/verification/sandbox/<runId>/), staged
 *  via the journaled write_file tool and invoked by path. */
const MAX_CASE_COMMAND_CHARS = 2_000;
const DEFAULT_TEST_TIMEOUT_MS = 60_000;
const MAX_TEST_TIMEOUT_MS = 150_000;
const DEFAULT_RUN_BUDGET_MS = 15 * 60_000;
const MAX_METRICS_PER_ANALYSIS = 60;

/* Command patterns the engine refuses to execute at all (spec §9). */
const COMMAND_BLOCK_PATTERNS: RegExp[] = [
  /\brm\s+(-[a-zA-Z]*\s+)*\/(\s|$)/,        // rm -rf / — filesystem root
  /\bmkfs\b/,                                 // filesystem formatting
  /\bdd\s+[^|]*of=\/dev\/(sd|nvme|hd)/i,      // raw device writes
  /\bshutdown\b|\breboot\b/,                  // power actions
  /:\(\)\s*\{\s*:\|\:&\s*\}\s*;:/,            // fork bomb
  /\bcurl\b[^|]*\|\s*(ba)?sh\b/,              // curl | sh remote code exec
  />\s*\/dev\/(sd|nvme|hd)/i,                 // redirect to raw device
];

/* High-confidence secrets — redacted from stored output before persist. */
const SECRET_REDACTIONS: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\b(?:sk|rk)-[A-Za-z0-9_-]{20,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bghp_[A-Za-z0-9]{30,}\b/g,
  /\bgho_[A-Za-z0-9]{30,}\b/g,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
  /\beyJ[A-Za-z0-9_-]{20,}\.eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\b/g,
];
const SECRET_ASSIGN_RE = /\b(password|passwd|secret|api[_-]?key|access[_-]?token)\b(\s*[:=]\s*)\S+/gi;

/* ------------------------------------------------------------------ */
/* Module state                                                        */
/* ------------------------------------------------------------------ */

interface StoreState {
  runs: VRun[];
  cases: VTestCase[];
  attempts: VAttempt[];
  metrics: VMetric[];
  evidence: VEvidence[];
  meta: { schemaVersion: number; counters: { vrun: number; vtc: number; vta: number; vmet: number; vev: number; vfb: number } };
  syncedAt: number | null;
  online: boolean;
  note?: string;
}

function emptyStore(): StoreState {
  return {
    runs: [],
    cases: [],
    attempts: [],
    metrics: [],
    evidence: [],
    meta: { schemaVersion: SCHEMA_VERSION, counters: { vrun: 0, vtc: 0, vta: 0, vmet: 0, vev: 0, vfb: 0 } },
    syncedAt: null,
    online: false,
  };
}

let store: StoreState = emptyStore();
let deps: VerificationDeps | null = null;
let cacheFile = '';
let syncPromise: Promise<StoreState> | null = null;
let mutationChain: Promise<unknown> = Promise.resolve();
const activeExecutions = new Set<string>(); // runIds with a live execute loop

/* ------------------------------------------------------------------ */
/* Dependencies injected by index.ts                                   */
/* ------------------------------------------------------------------ */

export interface VerificationDeps {
  isOnline(): boolean;
  projectName(): string | null;
  /**
   * Execute ONE command on the user's machine through the journaled tool
   * path. MUST return the real exit code captured by the extension, the
   * full output, the duration and the activity-journal reference.
   */
  runTest(
    command: string,
    timeoutMs?: number,
    ctx?: { source?: VSource; actor?: string },
  ): Promise<{
    ok: boolean;
    exitCode: number | null;
    timedOut: boolean;
    output: string;
    durationMs: number;
    journalRef?: string;
  }>;
  /** Write one verification activity entry to the journal. */
  logVerification(e: {
    source: VSource;
    actor: string;
    tool: string;
    ok: boolean;
    result: string;
    meta?: Record<string, unknown>;
  }): void;
  /** Push verification:state to paired web clients. */
  broadcastState(): void;
  /** Push a full run detail to paired web clients (live updates). */
  broadcastRun(detail: VRunDetail): void;
  dataDir: string;
  /** raw extension tool exec used for store-file sync (not journaled) */
  rawExec: typeof rawExec;
}

let rawExec: (name: 'read_file' | 'write_file' | 'list_files', args: Record<string, unknown>) => Promise<{ ok: boolean; result: string; content?: string }> =
  async () => ({ ok: false, result: 'verification module not initialized' });

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

function nextId(kind: 'vrun' | 'vtc' | 'vta' | 'vmet' | 'vev' | 'vfb'): string {
  const prefix = kind === 'vrun' ? 'VRUN' : kind === 'vtc' ? 'VTC' : kind === 'vta' ? 'VTA'
    : kind === 'vmet' ? 'VMET' : kind === 'vev' ? 'VEVA' : 'VFBK';
  const n = ++store.meta.counters[kind];
  return `${prefix}-${String(n).padStart(6, '0')}`;
}

function findRun(id: string): VRun | undefined {
  return store.runs.find((r) => r.id === id);
}

function runCases(runId: string): VTestCase[] {
  return store.cases.filter((c) => c.runId === runId);
}

function caseAttempts(testCaseId: string): VAttempt[] {
  return store.attempts.filter((a) => a.testCaseId === testCaseId);
}

function freshSteps(): VStep[] {
  return STAGES.map((name, i) => ({
    n: i + 1,
    name,
    status: 'pending' as VStepStatus,
    startedAt: null,
    completedAt: null,
    durationMs: null,
    details: '',
  }));
}

function emptyStats(): VStats {
  return {
    planned: 0, generated: 0, executed: 0, passed: 0, failed: 0,
    skipped: 0, blocked: 0, errors: 0, attempts: 0, iterations: 0, passRate: null,
  };
}

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const run = mutationChain.then(fn, fn);
  mutationChain = run.catch(() => undefined);
  return run;
}

function journal(
  source: VSource,
  actor: string,
  tool: string,
  ok: boolean,
  result: string,
  meta?: Record<string, unknown>,
) {
  deps?.logVerification({ source, actor, tool, ok, result: truncate(result, 1000), meta });
}

/** Redact secrets from captured output BEFORE anything is persisted. */
function redact(text: string): string {
  let out = String(text ?? '');
  for (const re of SECRET_REDACTIONS) out = out.replace(re, '[REDACTED:secret]');
  out = out.replace(SECRET_ASSIGN_RE, '$1$2[REDACTED]');
  return out;
}

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/* ------------------------------------------------------------------ */
/* Local cache + workspace file I/O (mirrors knowledge.ts)             */
/* ------------------------------------------------------------------ */

function persistLocalCache() {
  if (!cacheFile) return;
  try {
    mkdirSync(deps!.dataDir, { recursive: true });
    writeFileSync(cacheFile, JSON.stringify(store));
  } catch (e) {
    console.error('[verification] local cache save failed:', e);
  }
}

function loadLocalCache() {
  try {
    const raw = JSON.parse(readFileSync(cacheFile, 'utf8')) as StoreState;
    if (raw && Array.isArray(raw.runs) && raw.meta) {
      store = {
        runs: raw.runs,
        cases: Array.isArray(raw.cases) ? raw.cases : [],
        attempts: Array.isArray(raw.attempts) ? raw.attempts : [],
        metrics: Array.isArray(raw.metrics) ? raw.metrics : [],
        evidence: Array.isArray(raw.evidence) ? raw.evidence : [],
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

async function wsReadFile(path: string): Promise<{ ok: boolean; text: string; missing: boolean }> {
  const r = await rawExec('read_file', { path });
  if (r.ok) {
    let text = typeof (r as any).content === 'string' ? (r as any).content : String(r.result ?? '');
    if (!(r as any).content && text.startsWith(path)) {
      const idx = text.indexOf('):\n\n');
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

const dirty = { runs: false, cases: false, attempts: false, metrics: false, evidence: false, meta: false };

function markAllDirty() {
  dirty.runs = dirty.cases = dirty.attempts = dirty.metrics = dirty.evidence = dirty.meta = true;
}

async function persistDirty(): Promise<{ ok: boolean; error?: string }> {
  /* No isOnline gate (see knowledge.ts): real write results are the truth. */
  if (!deps) {
    return { ok: false, error: 'module not initialized' };
  }
  const writes: Array<{ flag: 'runs' | 'cases' | 'attempts' | 'metrics' | 'evidence' | 'meta'; p: Promise<boolean> }> = [];
  if (dirty.runs) writes.push({ flag: 'runs', p: wsWriteFile(FILES.runs, toJsonl(store.runs)) });
  if (dirty.cases) writes.push({ flag: 'cases', p: wsWriteFile(FILES.cases, toJsonl(store.cases)) });
  if (dirty.attempts) writes.push({ flag: 'attempts', p: wsWriteFile(FILES.attempts, toJsonl(store.attempts)) });
  if (dirty.metrics) writes.push({ flag: 'metrics', p: wsWriteFile(FILES.metrics, toJsonl(store.metrics)) });
  if (dirty.evidence) writes.push({ flag: 'evidence', p: wsWriteFile(FILES.evidence, toJsonl(store.evidence)) });
  if (dirty.meta) writes.push({ flag: 'meta', p: wsWriteFile(FILES.meta, JSON.stringify(store.meta, null, 2)) });
  const results = await Promise.all(writes.map((w) => w.p));
  /* Clear a dirty flag ONLY when its write succeeded (AUD-000036 incident
   * class: a failed flush must stay dirty and be retried, not forgotten). */
  let anyFailed = false;
  for (let i = 0; i < writes.length; i++) {
    if (results[i]) dirty[writes[i].flag] = false;
    else anyFailed = true;
  }
  persistLocalCache();
  if (anyFailed) {
    return { ok: false, error: 'writing the verification store to the workspace failed — the failed file(s) stay dirty and will be retried on the next write' };
  }
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Stats + evaluation — computed BY THE BRIDGE, never by GLM (spec §8) */
/* ------------------------------------------------------------------ */

export function computeStats(runId: string): VStats {
  const cases = runCases(runId);
  const s = emptyStats();
  s.planned = cases.length;
  s.generated = cases.length;
  s.attempts = store.attempts.filter((a) => a.runId === runId).length;
  const run = findRun(runId);
  s.iterations = run ? run.rounds.length : 0;
  for (const c of cases) {
    switch (c.status) {
      case 'PASS': s.passed++; s.executed++; break;
      case 'FAIL': s.failed++; s.executed++; break;
      case 'ERROR': s.errors++; s.executed++; break;
      case 'SKIPPED': s.skipped++; break;
      case 'BLOCKED': s.blocked++; break;
      default: break; // NOT_EXECUTED
    }
  }
  const denom = s.passed + s.failed;
  s.passRate = denom > 0 ? Math.round((s.passed / denom) * 1000) / 10 : null;
  return s;
}

/**
 * The bridge-side evaluator. Applies the DECLARED criteria to the REAL
 * execution result. GLM never assigns PASS/FAIL itself.
 */
function evaluateAttempt(
  criteria: VCriteria,
  r: { exitCode: number | null; timedOut: boolean; output: string },
): { status: VAttemptStatus; note: string } {
  if (r.timedOut) return { status: 'ERROR', note: 'timed out — infrastructure error, not a criteria result' };
  if (r.exitCode === null) return { status: 'ERROR', note: 'no exit code captured — infrastructure error' };
  if (r.exitCode !== criteria.exitCode) {
    return { status: 'FAIL', note: `exit code ${r.exitCode} ≠ expected ${criteria.exitCode}` };
  }
  const out = redact(r.output);
  for (const needle of criteria.outputContains) {
    if (!out.includes(needle)) return { status: 'FAIL', note: `output does not contain "${truncate(needle, 120)}"` };
  }
  for (const banned of criteria.outputNotContains) {
    if (out.includes(banned)) return { status: 'FAIL', note: `output contains forbidden "${truncate(banned, 120)}"` };
  }
  return { status: 'PASS', note: `exit ${r.exitCode} + ${criteria.outputContains.length} output assertion(s) satisfied` };
}

/**
 * The engine decides the effective conclusion from computed stats (spec §6F:
 * the verification system determines whether evidence satisfies the criteria).
 * Critical cases = explicitly flagged, or ALL cases when none is flagged.
 */
function engineConclusion(runId: string): { status: VConclusionStatus; reason: string } {
  const cases = runCases(runId);
  const critical = cases.filter((c) => c.flags.critical);
  const considered = critical.length > 0 ? critical : cases;
  if (considered.length === 0) {
    return { status: 'BLOCKED', reason: 'no test cases defined — nothing to verify against' };
  }
  const executed = considered.filter((c) => c.status !== 'NOT_EXECUTED' && c.status !== 'SKIPPED' && c.status !== 'BLOCKED');
  if (executed.length === 0) {
    return { status: 'BLOCKED', reason: 'no critical test was actually executed — evidence is missing' };
  }
  const passed = considered.filter((c) => c.status === 'PASS');
  const failed = considered.filter((c) => c.status === 'FAIL' || c.status === 'ERROR');
  if (passed.length === considered.length) {
    return { status: 'VERIFIED', reason: `all ${considered.length} critical test(s) passed against real executions` };
  }
  if (passed.length > 0) {
    return {
      status: 'PARTIALLY_VERIFIED',
      reason: `${passed.length}/${considered.length} critical tests passed; ${failed.length} failed/errored, the rest incomplete`,
    };
  }
  return { status: 'FAILED', reason: `0/${considered.length} critical tests passed — the hypothesis is not supported by the evidence` };
}

/* ------------------------------------------------------------------ */
/* Step helpers                                                        */
/* ------------------------------------------------------------------ */

function stepStart(run: VRun, n: number, details = '') {
  const st = run.steps.find((s) => s.n === n);
  if (!st || st.status === 'complete') return;
  st.status = 'running';
  st.startedAt = Date.now();
  st.details = details || st.details;
  run.currentStage = n;
  dirty.runs = true;
}

function stepComplete(run: VRun, n: number, details = '') {
  const st = run.steps.find((s) => s.n === n);
  if (!st) return;
  if (st.status !== 'running') st.startedAt = st.startedAt ?? Date.now();
  st.status = 'complete';
  st.completedAt = Date.now();
  st.durationMs = st.completedAt - (st.startedAt ?? st.completedAt);
  if (details) st.details = details;
  dirty.runs = true;
}

function stepSkip(run: VRun, n: number, reason: string) {
  const st = run.steps.find((s) => s.n === n);
  if (!st || st.status === 'complete') return;
  st.status = 'skipped';
  st.details = reason;
  dirty.runs = true;
}

function broadcastRunFor(runId: string) {
  const run = findRun(runId);
  if (!run || !deps) return;
  deps.broadcastRun(detailFor(runId));
  deps.broadcastState();
}

export function detailFor(runId: string): VRunDetail {
  const run = findRun(runId);
  return {
    run: run ?? ({} as VRun),
    cases: runCases(runId),
    attempts: store.attempts.filter((a) => a.runId === runId),
    metrics: store.metrics.filter((m) => m.runId === runId),
    evidence: store.evidence.filter((e) => e.runId === runId),
  };
}

/* ------------------------------------------------------------------ */
/* Sync — workspace is the source of truth (mirrors knowledge.ts)      */
/* ------------------------------------------------------------------ */

const STORE_README = `# Verification Store — Scientific Verification Engine

Evidence records for the Workspace Bridge verification runs. Plain JSONL —
portable with the repo, git-versioned, human-readable. GLM designs the
experiments; this store only ever contains results captured by the bridge
from REAL executions on this machine (exit codes, output, durations).

| File          | Contents                                              |
|---------------|-------------------------------------------------------|
| runs.jsonl    | One verification run per line (steps, rounds, analyses, conclusion) |
| cases.jsonl   | Test cases — the declared plan and criteria           |
| attempts.jsonl| Every real execution attempt (redacted output)        |
| metrics.jsonl | Measured/reported metrics, tied to test attempts      |
| evidence.jsonl| Evidence artifacts (reports live in evidence/<runId>/)|
| meta.json     | Schema version + ID counters (managed by the bridge)  |

Lifecycle: PENDING → PLANNING → READY → TESTING → ANALYZING →
VERIFIED | PARTIALLY_VERIFIED | FAILED | BLOCKED. Failed attempts are
never deleted — every round and every retry is preserved. A verification
run NEVER approves knowledge by itself; the owner stays in control.
`;

/** Runs stuck in TESTING when the service died mid-execution. */
function sweepInterruptedRuns() {
  let swept = 0;
  for (const run of store.runs) {
    if (run.status === 'TESTING' && !activeExecutions.has(run.id)) {
      run.status = 'BLOCKED';
      run.cancelReason = 'execution interrupted (service restarted mid-run) — restart verification to continue';
      stepSkip(run, 6, 'interrupted by service restart');
      for (const c of runCases(run.id)) {
        if (c.status === 'NOT_EXECUTED') c.status = 'SKIPPED';
      }
      run.stats = computeStats(run.id);
      run.updatedAt = nowIso();
      dirty.runs = dirty.cases = true;
      swept++;
    }
  }
  return swept;
}

async function syncFromWorkspace(source: VSource, actor: string): Promise<StoreState> {
  if (syncPromise) return syncPromise;
  syncPromise = (async () => {
    /* The WHOLE body runs inside try/finally: an offline early-return that
     * skips the finally would poison every future sync in this process with
     * a cached "offline" result (see the same fix in knowledge.ts). */
    try {
    /* No isOnline gate: if the workspace is truly offline the meta read below
     * fails and the honest catch reports it. (A previous gate here poisoned
     * syncPromise with a cached "offline" result whenever web clients
     * reconnected faster than the extension after a restart.) */
    try {
      const meta = await wsReadFile(FILES.meta);
      if (meta.missing) {
        if (store.runs.length > 0) {
          markAllDirty();
          const w = await persistDirty();
          await wsWriteFile(FILES.readme, STORE_README);
          store.note = w.ok ? 'verification folder was missing — cache re-published to the workspace' : 'verification folder missing and re-publish failed';
        } else {
          store.meta.counters = { vrun: 0, vtc: 0, vta: 0, vmet: 0, vev: 0, vfb: 0 };
          markAllDirty();
          await persistDirty();
          await wsWriteFile(FILES.readme, STORE_README);
          store.note = 'verification folder created in the workspace — empty store seeded';
        }
      } else if (meta.ok) {
        const parsedMeta = JSON.parse(meta.text) as StoreState['meta'];
        if ((parsedMeta?.schemaVersion ?? 0) > SCHEMA_VERSION) {
          store.online = true;
          store.note = `workspace verification store schema v${parsedMeta.schemaVersion} is newer than this bridge (v${SCHEMA_VERSION}) — update the bridge first`;
          deps?.broadcastState();
          return store;
        }
        const [runs, cases, attempts, metrics, evidence] = await Promise.all([
          wsReadFile(FILES.runs),
          wsReadFile(FILES.cases),
          wsReadFile(FILES.attempts),
          wsReadFile(FILES.metrics),
          wsReadFile(FILES.evidence),
        ]);
        const failures: string[] = [];
        store.runs = runs.ok ? parseJsonl<VRun>(runs.text).items : (failures.push('runs'), store.runs);
        store.cases = cases.ok ? parseJsonl<VTestCase>(cases.text).items : (failures.push('cases'), store.cases);
        store.attempts = attempts.ok ? parseJsonl<VAttempt>(attempts.text).items : (failures.push('attempts'), store.attempts);
        store.metrics = metrics.ok ? parseJsonl<VMetric>(metrics.text).items : (failures.push('metrics'), store.metrics);
        store.evidence = evidence.ok ? parseJsonl<VEvidence>(evidence.text).items : (failures.push('evidence'), store.evidence);
        store.meta = parsedMeta;
        store.syncedAt = Date.now();
        store.online = true;
        store.note = failures.length > 0
          ? `some verification files could not be read (${failures.join(', ')}) — cached data kept for those collections`
          : undefined;
        // counters never go backwards (protect IDs after hand edits)
        const bump = (maxId: string, key: 'vrun' | 'vtc' | 'vta' | 'vmet' | 'vev' | 'vfb') => {
          const n = parseInt(maxId.slice(4), 10);
          if (Number.isFinite(n) && n > store.meta.counters[key]) store.meta.counters[key] = n;
        };
        for (const r of store.runs) bump(r.id, 'vrun');
        for (const c of store.cases) bump(c.id, 'vtc');
        for (const a of store.attempts) bump(a.id, 'vta');
        for (const m of store.metrics) bump(m.id, 'vmet');
        for (const e of store.evidence) bump(e.id, 'vev');
        for (const r of store.runs) for (const f of r.feedback) bump(f.id, 'vfb');
        const swept = sweepInterruptedRuns();
        if (swept > 0) await persistDirty();
        persistLocalCache();
      } else {
        store.online = true;
        store.note = `could not read ${FILES.meta}: ${truncate(meta.text, 200)}`;
      }
      journal(source, actor, 'verification:sync', true,
        `Verification store synced — ${store.runs.length} runs, ${store.cases.length} test cases, ${store.attempts.length} attempts, ${store.evidence.length} evidence artifacts.`,
        { runs: store.runs.length, cases: store.cases.length, attempts: store.attempts.length });
      deps?.broadcastState();
      return store;
    } catch (e: unknown) {
      store.online = false;
      store.note = `sync failed: ${e instanceof Error ? e.message : String(e)}`;
      journal(source, actor, 'verification:sync', false, store.note);
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
/* Case normalization + validation                                     */
/* ------------------------------------------------------------------ */

function normalizeCase(
  input: CaseInput,
  run: VRun,
  round: number,
): { ok: true; tc: VTestCase } | { ok: false; error: string } {
  const name = String(input?.name ?? '').trim();
  const command = String(input?.command ?? '').trim();
  if (!name) return { ok: false, error: 'every test case needs a name' };
  if (!command) return { ok: false, error: `test case "${name}" needs a command` };
  if (command.length > MAX_CASE_COMMAND_CHARS) {
    return {
      ok: false,
      error: `test case "${name}" command is ${command.length} chars (limit ${MAX_CASE_COMMAND_CHARS}) — refusing rather than silently truncating: stage long scripts in the run sandbox (knowledge/verification/sandbox/<runId>/) and invoke them by path`,
    };
  }
  if (COMMAND_BLOCK_PATTERNS.some((re) => re.test(command))) {
    return { ok: false, error: `test case "${name}" was refused: its command matches a forbidden pattern (filesystem-destructive / power / remote-exec)` };
  }
  const timeoutMs = Math.max(5_000, Math.min(Number(input?.timeoutMs) > 0 ? Number(input.timeoutMs) : DEFAULT_TEST_TIMEOUT_MS, MAX_TEST_TIMEOUT_MS));
  const category = (CASE_CATEGORIES.includes(String(input?.category ?? '')) ? String(input.category) : 'other') as VCaseCategory;
  const crit = input?.criteria ?? {};
  const flags = input?.flags ?? {};
  return {
    ok: true,
    tc: {
      id: nextId('vtc'),
      runId: run.id,
      round,
      name: truncate(name, 200),
      objective: truncate(input?.objective ?? '', 1000),
      category,
      command,
      timeoutMs,
      expected: {
        expectedResult: truncate(input?.expected?.expectedResult ?? '', 1000),
        successCriteria: truncate(input?.expected?.successCriteria ?? '', 1000),
        failureCriteria: truncate(input?.expected?.failureCriteria ?? '', 1000),
      },
      criteria: {
        exitCode: Number.isFinite(crit.exitCode) ? Number(crit.exitCode) : 0,
        outputContains: (Array.isArray(crit.outputContains) ? crit.outputContains : []).map((x) => truncate(x, 300)).filter(Boolean),
        outputNotContains: (Array.isArray(crit.outputNotContains) ? crit.outputNotContains : []).map((x) => truncate(x, 300)).filter(Boolean),
      },
      flags: {
        critical: flags.critical !== false,
        requiresNetwork: !!flags.requiresNetwork,
        destructive: !!flags.destructive,
      },
      status: 'NOT_EXECUTED',
      latestAttemptId: null,
      createdAt: nowIso(),
    },
  };
}

/* ------------------------------------------------------------------ */
/* Workflow — PHASE 1/2: create run (observation + hypothesis)         */
/* ------------------------------------------------------------------ */

async function createRun(
  input: CreateRunInput,
  source: VSource,
  actor: string,
): Promise<{ ok: boolean; run?: VRun; error?: string }> {
  return enqueue(async () => {
    const knowledgeId = String(input?.knowledgeId ?? '').trim();
    if (!knowledgeId) return { ok: false, error: 'knowledgeId is required — a verification run always targets a knowledge record' };
    if (!deps) {
      return { ok: false, error: 'verification module not initialized' };
    }
    const id = nextId('vrun');
    const p = input?.problem ?? {};
    const h = input?.hypothesis ?? {};
    const rec: VRun = {
      id,
      knowledgeId,
      knowledgeVersion: Number(input?.knowledgeVersion) > 0 ? Number(input.knowledgeVersion) : 0,
      title: truncate(input?.title || `Verification of ${knowledgeId}`, 300),
      problem: {
        description: truncate(p.description ?? '', 4000),
        symptoms: truncate(p.symptoms ?? '', 2000),
        expectedBehavior: truncate(p.expectedBehavior ?? '', 1000),
        actualBehavior: truncate(p.actualBehavior ?? '', 1000),
        facts: truncate(p.facts ?? '', 2000),
        assumptions: truncate(p.assumptions ?? '', 2000),
        environment: truncate(p.environment ?? '', 1000),
        constraints: truncate(p.constraints ?? '', 1000),
      },
      hypothesis: {
        text: truncate(h.text ?? '', 4000),
        expectedObservation: truncate(h.expectedObservation ?? '', 2000),
        supportingEvidence: truncate(h.supportingEvidence ?? '', 2000),
        contradictingEvidence: truncate(h.contradictingEvidence ?? '', 2000),
      },
      strategy: truncate(input?.strategy ?? '', 4000),
      status: 'PENDING',
      currentStage: 1,
      steps: freshSteps(),
      rounds: [],
      analyses: [],
      environmentSnapshot: null,
      stats: emptyStats(),
      conclusion: null,
      cancelled: false,
      cancelReason: '',
      timeBudgetMs: DEFAULT_RUN_BUDGET_MS,
      elapsedMs: 0,
      needsDangerousConfirm: false,
      startedAt: null,
      completedAt: null,
      durationMs: null,
      reportEvidenceId: null,
      createdBy: actor,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      feedback: [],
    };
    if (!rec.problem.description || !rec.hypothesis.text) {
      return { ok: false, error: 'problem.description and hypothesis.text are required — observation and a testable hypothesis come first (scientific workflow §4)' };
    }
    store.runs.push(rec);

    // PHASE 1 + 2 recorded as completed stages with the actual content
    stepStart(rec, 1);
    stepComplete(rec, 1, 'problem, symptoms, expected vs actual behavior, facts and assumptions recorded');
    stepStart(rec, 2);
    stepComplete(rec, 2, truncate(rec.hypothesis.text, 300));
    rec.rounds.push({
      n: 1,
      kind: 'initial',
      hypothesis: rec.hypothesis.text,
      expectedObservation: rec.hypothesis.expectedObservation,
      changeNote: 'initial hypothesis',
      createdAt: nowIso(),
      outcome: '',
    });
    rec.status = 'PLANNING';
    rec.updatedAt = nowIso();
    dirty.runs = dirty.meta = true;

    // Environment snapshot — REAL commands on the user's machine (spec §12)
    stepStart(rec, 5, 'capturing the real execution environment…');
    try {
      const envCtx = { source, actor };
      // strip the "$ <command>" echo lines the extension prepends to output
      const clean = (s: string) =>
        redact(s).split('\n').filter((l) => !l.trim().startsWith('$')).join('\n').trim();
      const osR = await deps.runTest('uname -a 2>/dev/null || ver', 15_000, envCtx);
      const rtR = await deps.runTest(
        'python3 --version 2>&1; node --version 2>&1; git --version 2>&1; sqlite3 --version 2>&1 | head -1',
        20_000,
        envCtx,
      );
      const revR = await deps.runTest('git rev-parse --short HEAD 2>/dev/null || echo no-git', 15_000, envCtx);
      const revMatch = clean(revR.output).match(/^[0-9a-f]{7,40}$/m);
      rec.environmentSnapshot = {
        capturedAt: Date.now(),
        os: truncate(clean(osR.output), 500),
        runtimes: truncate(clean(rtR.output), 800),
        sourceRevision: revMatch ? revMatch[0] : null,
        journalRefs: [osR.journalRef, rtR.journalRef, revR.journalRef].filter(Boolean) as string[],
      };
      stepComplete(rec, 5, 'environment captured from the real machine via journaled commands');
    } catch (e) {
      stepComplete(rec, 5, `environment capture failed: ${e instanceof Error ? e.message : String(e)} — run may be BLOCKED at start if the workspace is unavailable`);
    }

    const w = await persistDirty();
    journal(source, actor, 'verification:create', w.ok,
      w.ok
        ? `Verification run ${id} created for ${knowledgeId} — observation + hypothesis recorded, environment captured. Next: submit the test plan.`
        : `Run ${id} created in memory but NOT saved: ${w.error}`,
      { id, knowledgeId });
    deps?.broadcastState();
    if (!w.ok) return { ok: false, error: w.error };
    return { ok: true, run: rec };
  });
}

/* ------------------------------------------------------------------ */
/* Workflow — PHASE 3/4: experiment design + test plan (→ READY)       */
/* ------------------------------------------------------------------ */

async function submitPlan(
  input: PlanInput,
  source: VSource,
  actor: string,
): Promise<{ ok: boolean; run?: VRun; error?: string; refused?: string[] }> {
  return enqueue(async () => {
    const run = findRun(String(input?.runId ?? ''));
    if (!run) return { ok: false, error: `unknown verification run "${input.runId}"` };
    if (run.status !== 'PLANNING' && run.status !== 'READY') {
      return { ok: false, error: `run ${run.id} is ${run.status} — plans can only be submitted while PLANNING (or amended while READY before start)` };
    }
    const casesIn = Array.isArray(input?.cases) ? input.cases : [];
    if (casesIn.length === 0) return { ok: false, error: 'a plan needs at least one test case' };
    if (run.status === 'READY') {
      // amend: drop previous unexecuted cases of round 1 and re-plan
      store.cases = store.cases.filter((c) => !(c.runId === run.id && c.status === 'NOT_EXECUTED'));
    }
    const refused: string[] = [];
    const added: VTestCase[] = [];
    for (const c of casesIn) {
      const n = normalizeCase(c, run, 1);
      if (!n.ok) {
        refused.push(n.error);
      } else {
        store.cases.push(n.tc);
        added.push(n.tc);
      }
    }
    if (added.length === 0) {
      return { ok: false, error: `no test case could be accepted: ${refused.join('; ')}`, refused };
    }
    if (run.strategy && input?.experiments) {
      run.strategy = truncate(`${run.strategy}\n\nExperiments: ${input.experiments}`, 6000);
    } else if (input?.experiments) {
      run.strategy = truncate(String(input.experiments), 4000);
    }
    stepStart(run, 3);
    stepComplete(run, 3, truncate(input?.experiments ?? added.map((c) => c.name).join(' · '), 300));
    stepStart(run, 4);
    stepComplete(run, 4, `${added.length} test case(s) planned — review on the dashboard, then start verification`);
    run.needsDangerousConfirm = added.some((c) => c.flags.requiresNetwork || c.flags.destructive);
    run.status = 'READY';
    run.stats = computeStats(run.id);
    run.updatedAt = nowIso();
    dirty.cases = dirty.runs = dirty.meta = true;
    const w = await persistDirty();
    journal(source, actor, 'verification:plan', w.ok,
      w.ok
        ? `Test plan for ${run.id} accepted: ${added.length} case(s)${run.needsDangerousConfirm ? ' (⚠ contains network/destructive tests — owner confirmation required at start)' : ''}. Plan is READY for review and execution.`
        : `Plan NOT saved: ${w.error}`,
      { runId: run.id, cases: added.length, refused: refused.length });
    deps?.broadcastState();
    if (!w.ok) return { ok: false, error: w.error, refused };
    return { ok: true, run, refused: refused.length ? refused : undefined };
  });
}

/* ------------------------------------------------------------------ */
/* Workflow — PHASE 5/6: execution engine                              */
/* ------------------------------------------------------------------ */

async function startRun(
  runId: string,
  source: VSource,
  actor: string,
  opts: { confirmDangerous?: boolean } = {},
): Promise<{ ok: boolean; error?: string }> {
  return enqueue(async () => {
    const run = findRun(String(runId ?? ''));
    if (!run) return { ok: false, error: `unknown verification run "${runId}"` };
    if (run.status !== 'READY' && run.status !== 'ANALYZING') {
      return { ok: false, error: `run ${run.id} is ${run.status} — only READY runs (or ANALYZING runs getting a regression round) can start execution` };
    }
    if (activeExecutions.has(run.id)) {
      return { ok: false, error: `run ${run.id} is already executing` };
    }
    if (!deps) {
      return { ok: false, error: 'verification module not initialized' };
    }
    const isRegressionContinuation = run.status === 'ANALYZING';
    const pendingCases = runCases(run.id).filter((c) => c.status === 'NOT_EXECUTED');
    if (pendingCases.length === 0) {
      return { ok: false, error: 'no unexecuted test cases — add a regression round or go straight to analysis/report' };
    }
    const dangerous = pendingCases.filter((c) => c.flags.requiresNetwork || c.flags.destructive);
    if (dangerous.length > 0 && !opts.confirmDangerous) {
      return {
        ok: false,
        error: `${dangerous.length} test(s) are flagged network/destructive (${dangerous.map((c) => c.name).join(', ')}). The owner must explicitly confirm before they can run.`,
      };
    }
    run.cancelled = false;
    run.cancelReason = '';
    run.status = 'TESTING';
    run.startedAt = run.startedAt ?? nowIso();
    run.updatedAt = nowIso();
    dirty.runs = true;
    const w = await persistDirty();
    if (!w.ok) return { ok: false, error: w.error };

    journal(source, actor, 'verification:start', true,
      `Verification ${run.id} execution STARTED by ${actor} — ${pendingCases.length} test(s)${dangerous.length ? ' (dangerous tests confirmed)' : ''}${isRegressionContinuation ? ' [regression round]' : ''}.`,
      { runId: run.id, cases: pendingCases.length });

    // fire-and-forget: the loop broadcasts progress; the caller returns now
    void executeLoop(run.id, source, actor).catch(async (e) => {
      const r = findRun(run.id);
      if (r) {
        r.status = 'BLOCKED';
        r.cancelReason = `execution engine error: ${e instanceof Error ? e.message : String(e)}`;
        r.updatedAt = nowIso();
        dirty.runs = true;
        await persistDirty();
        journal('system', 'System', 'verification:engine', false, r.cancelReason, { runId: r.id });
        deps?.broadcastState();
      }
    });
    return { ok: true };
  });
}

async function executeLoop(runId: string, source: VSource, actor: string): Promise<void> {
  activeExecutions.add(runId);
  try {
    const run = findRun(runId);
    if (!run) return;
    stepStart(run, 6, 'executing the test plan on the real workspace…');
    if (run.status !== 'TESTING') run.status = 'TESTING';
    dirty.runs = true;
    await persistDirty();
    broadcastRunFor(runId);

    // sandbox dir for this run's scratch files (created for real)
    await deps!.runTest(`mkdir -p ${verificationSandboxDir(runId)}`, 15_000, { source, actor });

    const loopStart = Date.now();
    const queue = runCases(runId).filter((c) => c.status === 'NOT_EXECUTED');
    for (const tc of queue) {
      const r = findRun(runId)!;
      if (r.cancelled) {
        for (const c of runCases(runId)) {
          if (c.status === 'NOT_EXECUTED') {
            c.status = 'SKIPPED';
          }
        }
        dirty.cases = true;
        break;
      }
      if (Date.now() - loopStart + r.elapsedMs > r.timeBudgetMs) {
        for (const c of runCases(runId)) {
          if (c.status === 'NOT_EXECUTED') c.status = 'BLOCKED';
        }
        r.cancelReason = `run time budget exceeded (${Math.round(r.timeBudgetMs / 1000)}s) — remaining tests BLOCKED`;
        dirty.cases = dirty.runs = true;
        break;
      }
      // real, journaled execution on the user's machine
      const startedAt = Date.now();
      const res = await deps!.runTest(tc.command, tc.timeoutMs, { source, actor });
      const completedAt = Date.now();
      const evalRes = evaluateAttempt(tc.criteria, {
        exitCode: res.exitCode,
        timedOut: res.timedOut,
        output: res.output,
      });
      const attempt: VAttempt = {
        id: nextId('vta'),
        testCaseId: tc.id,
        runId,
        round: r.rounds.length,
        attemptNumber: caseAttempts(tc.id).length + 1,
        status: evalRes.status,
        command: tc.command,
        exitCode: res.exitCode,
        timedOut: res.timedOut,
        output: truncate(redact(res.output), MAX_ATTEMPT_OUTPUT_CHARS),
        durationMs: res.durationMs > 0 ? res.durationMs : completedAt - startedAt,
        startedAt: new Date(startedAt).toISOString(),
        completedAt: new Date(completedAt).toISOString(),
        journalRef: res.journalRef ?? null,
        evaluatedBy: 'bridge-evaluator',
        note: evalRes.note,
      };
      store.attempts.push(attempt);
      tc.status = attempt.status;
      tc.latestAttemptId = attempt.id;
      const rr = findRun(runId)!;
      rr.elapsedMs += attempt.durationMs;
      rr.stats = computeStats(runId);
      rr.updatedAt = nowIso();
      dirty.attempts = dirty.cases = dirty.runs = dirty.meta = true;
      const w = await persistDirty();
      if (!w.ok) {
        journal('system', 'System', 'verification:engine', false, `attempt persist failed: ${w.error}`, { runId });
      }
      journal(source, actor, 'verification:test', attempt.status === 'PASS',
        `${tc.id} "${tc.name}" → ${attempt.status} (exit ${attempt.exitCode ?? 'n/a'}, ${attempt.durationMs}ms) — ${attempt.note}`,
        { runId, caseId: tc.id, attemptId: attempt.id, status: attempt.status, exitCode: attempt.exitCode });
      broadcastRunFor(runId);
    }

    const run2 = findRun(runId)!;
    if (run2.cancelled) {
      run2.status = 'BLOCKED';
      stepSkip(run2, 6, `cancelled by the owner: ${run2.cancelReason}`);
      if (run2.rounds.length > 0) {
        run2.rounds[run2.rounds.length - 1].outcome = 'cancelled mid-execution';
      }
    } else {
      stepComplete(run2, 6, `${run2.stats.executed} executed · ${run2.stats.passed} passed · ${run2.stats.failed} failed · ${run2.stats.errors} errors`);
      run2.status = 'ANALYZING';
      stepStart(run2, 7, 'awaiting GLM result analysis (bridge-validated)…');
      if (run2.rounds.length > 0) {
        const st = run2.stats;
        run2.rounds[run2.rounds.length - 1].outcome = `${st.passed}/${st.executed} executed tests passed (pass rate ${st.passRate ?? 'N/A'}%)`;
      }
    }
    run2.stats = computeStats(runId);
    run2.updatedAt = nowIso();
    dirty.runs = true;
    await persistDirty();
    broadcastRunFor(runId);
  } finally {
    activeExecutions.delete(runId);
  }
}

async function cancelRun(
  runId: string,
  source: VSource,
  actor: string,
  reason = '',
): Promise<{ ok: boolean; error?: string }> {
  return enqueue(async () => {
    const run = findRun(String(runId ?? ''));
    if (!run) return { ok: false, error: `unknown verification run "${runId}"` };
    if (run.status !== 'TESTING') {
      return { ok: false, error: `run ${run.id} is ${run.status} — only TESTING runs can be cancelled` };
    }
    run.cancelled = true;
    run.cancelReason = truncate(reason || `cancelled by ${actor}`, 500);
    run.updatedAt = nowIso();
    dirty.runs = true;
    const w = await persistDirty();
    journal(source, actor, 'verification:cancel', w.ok,
      `Verification ${run.id} CANCEL requested by ${actor} — takes effect before the next test starts.`,
      { runId: run.id });
    deps?.broadcastState();
    return w.ok ? { ok: true } : { ok: false, error: w.error };
  });
}

/* ------------------------------------------------------------------ */
/* Metric validation — values must appear in cited real outputs        */
/* ------------------------------------------------------------------ */

function validateMetric(
  m: { name: string; value: string | number; unit?: string; testCaseId?: string },
  runId: string,
): { ok: true; verified: boolean; testCaseId: string | null; note: string } | { ok: false; error: string } {
  const name = String(m?.name ?? '').trim();
  const rawVal = m?.value;
  if (!name || rawVal === undefined || rawVal === null || String(rawVal) === '') {
    return { ok: false, error: 'a metric needs a name and a value' };
  }
  const valueStr = String(rawVal);
  let testCaseId: string | null = null;
  let citedOutput: string | null = null;
  if (m.testCaseId) {
    const tc = store.cases.find((c) => c.id === m.testCaseId && c.runId === runId);
    if (!tc) return { ok: false, error: `metric "${name}" cites unknown test case "${m.testCaseId}"` };
    const att = caseAttempts(tc.id)[caseAttempts(tc.id).length - 1];
    if (!att) return { ok: false, error: `metric "${name}" cites test ${tc.id} which has no executed attempt` };
    testCaseId = tc.id;
    citedOutput = att.output;
  }
  if (citedOutput === null) {
    return { ok: true, verified: false, testCaseId: null, note: 'not tied to a test attempt — recorded as reported, not measured' };
  }
  if (citedOutput.includes(valueStr)) {
    return { ok: true, verified: true, testCaseId, note: `value "${valueStr}" found verbatim in the cited attempt output` };
  }
  // numeric tolerance match (formatting drift: 0.313261687 vs 0.313262)
  const v = Number(valueStr);
  if (Number.isFinite(v)) {
    const nums = citedOutput.match(/-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g) ?? [];
    for (const ns of nums) {
      const nv = Number(ns);
      if (Number.isFinite(nv)) {
        const rel = Math.abs(nv - v) / (Math.max(Math.abs(v), Math.abs(nv), 1e-12));
        if (rel < 1e-6) {
          return { ok: true, verified: true, testCaseId, note: `value ${valueStr} matches ${ns} in the cited attempt output (numeric match)` };
        }
      }
    }
  }
  return { ok: false, error: `metric "${name}" value "${valueStr}" was NOT found in the cited test output — the bridge refuses to record measurements that the evidence does not contain` };
}

/* ------------------------------------------------------------------ */
/* Workflow — PHASE 6/7: analysis (bridge-validated) + conclusion      */
/* ------------------------------------------------------------------ */

async function submitAnalysis(
  input: AnalysisInput,
  source: VSource,
  actor: string,
): Promise<{ ok: boolean; run?: VRun; analysis?: VAnalysis; error?: string; rejectedMetrics?: string[] }> {
  return enqueue(async () => {
    const run = findRun(String(input?.runId ?? ''));
    if (!run) return { ok: false, error: `unknown verification run "${input.runId}"` };
    if (run.status !== 'ANALYZING') {
      return { ok: false, error: `run ${run.id} is ${run.status} — analysis is submitted after execution completes (TESTING → ANALYZING)` };
    }
    const round = run.rounds.length;
    const proposedStatus = String(input?.proposedConclusion?.status ?? '').toUpperCase() as VConclusionStatus;
    const validStatuses: VConclusionStatus[] = ['VERIFIED', 'PARTIALLY_VERIFIED', 'FAILED', 'BLOCKED'];
    if (!validStatuses.includes(proposedStatus)) {
      return { ok: false, error: `proposedConclusion.status must be one of ${validStatuses.join(' | ')}` };
    }

    // metrics: each value must exist in the cited attempt's real output
    const rejectedMetrics: string[] = [];
    const acceptedMetrics: VMetric[] = [];
    const metricsIn = (Array.isArray(input?.metrics) ? input.metrics : []).slice(0, MAX_METRICS_PER_ANALYSIS);
    for (const m of metricsIn) {
      const v = validateMetric(m, run.id);
      if (!v.ok) {
        rejectedMetrics.push(v.error);
      } else {
        acceptedMetrics.push({
          id: nextId('vmet'),
          runId: run.id,
          testCaseId: v.testCaseId,
          name: truncate(m.name, 200),
          value: truncate(String(m.value), 200),
          unit: truncate(m.unit ?? '', 100),
          source: v.verified ? 'measured' : 'reported',
          verified: v.verified,
          recordedAt: nowIso(),
        });
      }
    }
    store.metrics.push(...acceptedMetrics);

    // THE ENGINE decides the effective conclusion from computed stats
    const stats = computeStats(run.id);
    const engine = engineConclusion(run.id);
    const accepted = engine.status === proposedStatus;
    const analysis: VAnalysis = {
      id: `VANA-${run.analyses.length + 1}-${Date.now().toString(36)}`,
      round,
      submittedBy: actor,
      createdAt: nowIso(),
      summary: truncate(input?.summary ?? '', 4000),
      comparison: truncate(input?.comparison ?? '', 4000),
      alternativeExplanations: truncate(input?.alternativeExplanations ?? '', 2000),
      recommendedModifications: truncate(input?.recommendedModifications ?? '', 2000),
      proposedConclusion: {
        status: proposedStatus,
        summary: truncate(input?.proposedConclusion?.summary ?? '', 2000),
      },
      engineDecision: {
        accepted,
        effectiveStatus: engine.status,
        reason: accepted
          ? `GLM's proposal matches the evidence: ${engine.reason}`
          : `GLM proposed ${proposedStatus} but the evidence says ${engine.status} — ${engine.reason}. The bridge records the evidence-based status.`,
      },
      metricIds: acceptedMetrics.map((m) => m.id),
    };
    run.analyses.push(analysis);
    run.stats = stats;

    if (round > 1) {
      // a regression round was just analyzed — stage 8/9 complete
      stepComplete(run, 8, `regression round ${round} analyzed: ${stats.passed}/${stats.executed} passed`);
      stepComplete(run, 9, engine.reason);
    } else {
      stepComplete(run, 7, `${analysis.summary.slice(0, 200)} — engine decision: ${engine.status}${accepted ? '' : ' (GLM proposal rejected)'}`);
      stepSkip(run, 8, 'no regression round requested — skipped');
      stepComplete(run, 9, engine.reason);
    }

    run.conclusion = {
      status: engine.status,
      summary: engine.reason,
      glmInterpretation: analysis.summary,
      stats,
      decidedAt: nowIso(),
      decidedBy: 'bridge-evaluator (evidence-based)',
    };
    run.status = engine.status;
    run.updatedAt = nowIso();
    dirty.runs = dirty.metrics = dirty.meta = true;
    const w = await persistDirty();
    journal(source, actor, 'verification:analyze', w.ok && true,
      `Analysis for ${run.id} round ${round} recorded — engine conclusion: ${engine.status}${accepted ? '' : ` (GLM proposed ${proposedStatus} — REJECTED by evidence)`}. ${acceptedMetrics.length} metric(s) accepted${rejectedMetrics.length ? `, ${rejectedMetrics.length} REFUSED (not in evidence)` : ''}.`,
      { runId: run.id, effectiveStatus: engine.status, accepted, metrics: acceptedMetrics.length, refusedMetrics: rejectedMetrics.length });
    deps?.broadcastState();
    if (!w.ok) return { ok: false, error: w.error, rejectedMetrics };
    return { ok: true, run, analysis, rejectedMetrics: rejectedMetrics.length ? rejectedMetrics : undefined };
  });
}

/* ------------------------------------------------------------------ */
/* Workflow — PHASE 7 (regression round) + failure-revision cycles     */
/* ------------------------------------------------------------------ */

async function addRegression(
  input: RegressInput,
  source: VSource,
  actor: string,
): Promise<{ ok: boolean; run?: VRun; error?: string; refused?: string[] }> {
  return enqueue(async () => {
    const run = findRun(String(input?.runId ?? ''));
    if (!run) return { ok: false, error: `unknown verification run "${input.runId}"` };
    if (!['VERIFIED', 'PARTIALLY_VERIFIED', 'FAILED', 'ANALYZING'].includes(run.status)) {
      return { ok: false, error: `run ${run.id} is ${run.status} — regression rounds are added after an analysis (or while ANALYZING)` };
    }
    if (run.reportEvidenceId) {
      return { ok: false, error: `run ${run.id} already has a final report — start a new verification run instead` };
    }
    const casesIn = Array.isArray(input?.cases) ? input.cases : [];
    const retryIds = Array.isArray(input?.retry) ? input.retry.map(String) : [];
    const updatesIn = Array.isArray(input?.updates) ? input.updates : [];
    if (casesIn.length === 0 && retryIds.length === 0 && updatesIn.length === 0) {
      return { ok: false, error: 'a regression round needs new test cases, retried case ids, and/or case updates' };
    }
    const round = run.rounds.length + 1;
    const refused: string[] = [];
    const added: VTestCase[] = [];
    for (const c of casesIn) {
      const n = normalizeCase(c, run, round);
      if (!n.ok) refused.push(n.error);
      else {
        store.cases.push(n.tc);
        added.push(n.tc);
      }
    }
    if (added.length === 0 && retryIds.length === 0 && updatesIn.length === 0) return { ok: false, error: `no test case accepted: ${refused.join('; ')}`, refused };
    // case UPDATES: revise a case definition (criteria / command / expected)
    // as the outcome of a failure investigation — the revision is journaled,
    // prior attempts stay untouched, and the case re-runs this round.
    let updated = 0;
    for (const u of updatesIn) {
      const tc = store.cases.find((c) => c.id === String(u?.id ?? '') && c.runId === run.id);
      if (!tc) { refused.push(`update: unknown case "${u?.id}" on this run`); continue; }
      if (u.command !== undefined) {
        const cmd = String(u.command).trim();
        if (!cmd || COMMAND_BLOCK_PATTERNS.some((re) => re.test(cmd))) {
          refused.push(`update ${tc.id}: refused command revision`);
          continue;
        }
        if (cmd.length > MAX_CASE_COMMAND_CHARS) {
          refused.push(`update ${tc.id}: command revision is ${cmd.length} chars (limit ${MAX_CASE_COMMAND_CHARS}) — refused rather than silently truncated`);
          continue;
        }
        tc.command = cmd;
      }
      if (u.criteria) {
        const c = u.criteria;
        tc.criteria = {
          exitCode: Number.isFinite(c.exitCode) ? Number(c.exitCode) : tc.criteria.exitCode,
          outputContains: Array.isArray(c.outputContains) ? c.outputContains.map((x) => truncate(x, 300)).filter(Boolean) : tc.criteria.outputContains,
          outputNotContains: Array.isArray(c.outputNotContains) ? c.outputNotContains.map((x) => truncate(x, 300)).filter(Boolean) : tc.criteria.outputNotContains,
        };
      }
      if (u.expected) {
        tc.expected = {
          expectedResult: u.expected.expectedResult !== undefined ? truncate(u.expected.expectedResult, 1000) : tc.expected.expectedResult,
          successCriteria: u.expected.successCriteria !== undefined ? truncate(u.expected.successCriteria, 1000) : tc.expected.successCriteria,
          failureCriteria: u.expected.failureCriteria !== undefined ? truncate(u.expected.failureCriteria, 1000) : tc.expected.failureCriteria,
        };
      }
      if (u.name) tc.name = truncate(u.name, 200);
      if (u.objective !== undefined) tc.objective = truncate(u.objective, 1000);
      if (Number(u.timeoutMs) > 0) tc.timeoutMs = Math.min(Number(u.timeoutMs), MAX_TEST_TIMEOUT_MS);
      if (tc.status !== 'NOT_EXECUTED') {
        tc.status = 'NOT_EXECUTED';
      }
      updated++;
    }
    // retried cases: reset to NOT_EXECUTED so the engine re-runs them this
    // round — every prior attempt stays in attempts.jsonl as history (§11)
    let retried = 0;
    for (const rid of retryIds) {
      const tc = store.cases.find((c) => c.id === rid && c.runId === run.id);
      if (!tc) { refused.push(`retry: unknown case "${rid}" on this run`); continue; }
      if (tc.status === 'NOT_EXECUTED') continue; // already queued
      tc.status = 'NOT_EXECUTED';
      retried++;
    }
    run.rounds.push({
      n: round,
      kind: 'regression',
      hypothesis: truncate(input?.hypothesis ?? '(revised hypothesis not stated)', 4000),
      expectedObservation: truncate(input?.expectedObservation ?? '', 2000),
      changeNote: truncate(input?.changeNote ?? '', 2000),
      createdAt: nowIso(),
      outcome: '',
    });
    stepStart(run, 8, `regression round ${round}: ${added.length} new test(s)${retried ? `, ${retried} retried` : ''}${updated ? `, ${updated} case definition(s) revised` : ''}${input?.hypothesis ? ' — revised hypothesis: ' + truncate(input.hypothesis, 150) : ''}`);
    const dangerous = added.some((c) => c.flags.requiresNetwork || c.flags.destructive);
    run.needsDangerousConfirm = run.needsDangerousConfirm || dangerous;
    run.status = dangerous ? 'READY' : 'TESTING'; // dangerous new tests need a fresh owner confirm
    run.stats = computeStats(run.id);
    run.updatedAt = nowIso();
    dirty.cases = dirty.runs = dirty.meta = true;
    const w = await persistDirty();
    journal(source, actor, 'verification:regress', w.ok,
      `Regression round ${round} added to ${run.id}: ${added.length} new test(s)${retried ? `, ${retried} retried` : ''}${updated ? `, ${updated} revised (criteria corrections — history preserved)` : ''}, previous rounds preserved.${dangerous ? ' ⚠ contains dangerous tests — waiting for owner confirmation.' : ' Execution starting.'}`,
      { runId: run.id, round, cases: added.length, retried, updated });
    deps?.broadcastState();
    if (!w.ok) return { ok: false, error: w.error, refused };

    if (!dangerous) {
      // auto-execute the regression round (owner already consented to this run;
      // no NEW dangerous commands were introduced)
      void executeLoop(run.id, source, actor).catch(async (e) => {
        const r = findRun(run.id);
        if (r) {
          r.status = 'BLOCKED';
          r.cancelReason = `execution engine error: ${e instanceof Error ? e.message : String(e)}`;
          dirty.runs = true;
          await persistDirty();
          journal('system', 'System', 'verification:engine', false, r.cancelReason, { runId: r.id });
          deps?.broadcastState();
        }
      });
    }
    return { ok: true, run, refused: refused.length ? refused : undefined };
  });
}

/* ------------------------------------------------------------------ */
/* Workflow — PHASE 8: final report (assembled from persisted records) */
/* ------------------------------------------------------------------ */

function buildReport(runId: string, knowledgeContext: { title: string; solutionSteps: string } | null): { json: Record<string, unknown>; md: string } {
  const d = detailFor(runId);
  const run = d.run;
  const byCase = new Map<string, VAttempt[]>();
  for (const a of d.attempts) {
    const list = byCase.get(a.testCaseId) ?? [];
    list.push(a);
    byCase.set(a.testCaseId, list);
  }
  const glmLabel = 'AI INTERPRETATION (submitted by GLM — not measurement)';
  const report = {
    id: `RPT-${run.id}`,
    runId: run.id,
    knowledge: {
      id: run.knowledgeId,
      version: run.knowledgeVersion,
      title: knowledgeContext?.title ?? null,
      solutionUnderTest: knowledgeContext?.solutionSteps ?? null,
    },
    generatedAt: nowIso(),
    generatedBy: 'bridge report generator (assembled from persisted execution records)',
    verificationStatus: run.status,
    conclusion: run.conclusion,
    originalProblem: run.problem,
    hypothesis: run.hypothesis,
    hypothesisHistory: run.rounds,
    strategy: run.strategy,
    environment: run.environmentSnapshot,
    reproducibility: {
      os: run.environmentSnapshot?.os ?? null,
      runtimes: run.environmentSnapshot?.runtimes ?? null,
      sourceRevision: run.environmentSnapshot?.sourceRevision ?? null,
      testCommands: d.cases.map((c) => ({ id: c.id, command: c.command, timeoutMs: c.timeoutMs })),
      note: 'Re-run the listed commands in the recorded environment to reproduce. All outputs below were captured by the bridge from real executions.',
    },
    timeline: run.steps,
    statistics: run.stats,
    testCases: d.cases.map((c) => ({
      id: c.id,
      name: c.name,
      objective: c.objective,
      category: c.category,
      round: c.round,
      critical: c.flags.critical,
      expected: c.expected,
      criteria: c.criteria,
      command: c.command,
      finalStatus: c.status,
      attempts: (byCase.get(c.id) ?? []).map((a) => ({
        attempt: a.attemptNumber,
        status: a.status,
        exitCode: a.exitCode,
        timedOut: a.timedOut,
        durationMs: a.durationMs,
        startedAt: a.startedAt,
        journalRef: a.journalRef,
        note: a.note,
        output: a.output,
      })),
    })),
    metrics: d.metrics,
    analyses: run.analyses,
    feedback: run.feedback,
    limitations: [
      'Commands executed on the user\'s machine through the VS Code extension as the local user — no CPU/memory sandbox isolation is enforceable through this transport.',
      'Network access for non-flagged tests could not be technically blocked; tests that declared network needs required explicit owner confirmation instead.',
      'Attempt outputs are redacted for secrets and capped at 20,000 characters per attempt.',
    ],
  };

  const md: string[] = [];
  md.push(`# Verification Report — ${run.id}`);
  md.push('');
  md.push(`- **Knowledge record:** ${run.knowledgeId} (version ${run.knowledgeVersion})${knowledgeContext ? ` — ${knowledgeContext.title}` : ''}`);
  md.push(`- **Verification status:** ${run.status}`);
  md.push(`- **Conclusion:** ${run.conclusion ? `${run.conclusion.status} — ${run.conclusion.summary}` : '(not concluded)'}`);
  md.push(`- **Generated:** ${report.generatedAt} by the bridge (from persisted records only)`);
  md.push('');
  md.push(`## 1. Original problem`);
  md.push(run.problem.description || '(none)');
  if (run.problem.symptoms) md.push(`\n**Symptoms:** ${run.problem.symptoms}`);
  if (run.problem.expectedBehavior) md.push(`**Expected:** ${run.problem.expectedBehavior}`);
  if (run.problem.actualBehavior) md.push(`**Actual:** ${run.problem.actualBehavior}`);
  if (run.problem.facts) md.push(`\n**Facts:** ${run.problem.facts}`);
  if (run.problem.assumptions) md.push(`**Assumptions:** ${run.problem.assumptions}`);
  md.push('');
  md.push(`## 2. Hypothesis (initial)`);
  md.push(run.hypothesis.text);
  if (run.hypothesis.expectedObservation) md.push(`\n**Expected observation:** ${run.hypothesis.expectedObservation}`);
  md.push('');
  md.push(`## 3. Hypothesis history (all rounds preserved)`);
  for (const r of run.rounds) {
    md.push(`- **Round ${r.n}** (${r.kind}): ${r.hypothesis}${r.changeNote ? ` — _${r.changeNote}_` : ''}${r.outcome ? ` → ${r.outcome}` : ''}`);
  }
  md.push('');
  md.push(`## 4. Testing environment`);
  md.push(`- OS: ${run.environmentSnapshot?.os ?? 'unknown'}`);
  md.push(`- Runtimes: ${run.environmentSnapshot?.runtimes ?? 'unknown'}`);
  md.push(`- Source revision: ${run.environmentSnapshot?.sourceRevision ?? 'n/a'}`);
  md.push('');
  md.push(`## 5. Statistics (computed by the bridge)`);
  md.push(`| planned | executed | passed | failed | errors | skipped | blocked | attempts | pass rate |`);
  md.push(`|---|---|---|---|---|---|---|---|---|`);
  const s = run.stats;
  md.push(`| ${s.planned} | ${s.executed} | ${s.passed} | ${s.failed} | ${s.errors} | ${s.skipped} | ${s.blocked} | ${s.attempts} | ${s.passRate === null ? 'N/A' : s.passRate + '%'} |`);
  md.push('');
  md.push(`## 6. Test results (every attempt preserved)`);
  for (const c of d.cases) {
    const atts = byCase.get(c.id) ?? [];
    md.push(`### ${c.id} — ${c.name} [${c.status}] (${c.category}${c.flags.critical ? ', critical' : ''})`);
    md.push(`- Objective: ${c.objective || '(none)'}`);
    md.push(`- Command: \`${c.command}\``);
    md.push(`- Success criteria: exit ${c.criteria.exitCode}${c.criteria.outputContains.length ? ` + output contains ${JSON.stringify(c.criteria.outputContains)}` : ''}`);
    for (const a of atts) {
      md.push(`- **Attempt ${a.attemptNumber}: ${a.status}** (exit ${a.exitCode ?? 'n/a'}, ${a.durationMs}ms, journal ${a.journalRef ?? 'n/a'}) — ${a.note}`);
      if (a.output) md.push(`\n\`\`\`\n${a.output.slice(0, 2000)}\n\`\`\``);
    }
    if (atts.length === 0) md.push('- (never executed)');
    md.push('');
  }
  if (d.metrics.length > 0) {
    md.push(`## 7. Metrics`);
    for (const m of d.metrics) {
      md.push(`- **${m.name}:** ${m.value}${m.unit ? ' ' + m.unit : ''} — ${m.source}${m.verified ? ' (verified against cited output)' : ' (reported, untied)'}`);
    }
    md.push('');
  }
  if (run.analyses.length > 0) {
    md.push(`## 8. ${glmLabel}`);
    for (const a of run.analyses) {
      md.push(`### Round ${a.round} analysis (by ${a.submittedBy})`);
      md.push(a.summary || '(no summary)');
      if (a.comparison) md.push(`\n**Expected vs observed:** ${a.comparison}`);
      if (a.alternativeExplanations) md.push(`**Alternative explanations:** ${a.alternativeExplanations}`);
      if (a.recommendedModifications) md.push(`**Recommended modifications:** ${a.recommendedModifications}`);
      md.push(`\n**Proposed conclusion:** ${a.proposedConclusion.status} — ${a.proposedConclusion.summary}`);
      md.push(`**Engine decision:** ${a.engineDecision.accepted ? 'ACCEPTED' : 'REJECTED'} → ${a.engineDecision.effectiveStatus}. ${a.engineDecision.reason}`);
      md.push('');
    }
  }
  md.push(`## 9. Limitations`);
  for (const l of report.limitations as string[]) md.push(`- ${l}`);
  if (run.feedback.length > 0) {
    md.push('');
    md.push(`## 10. Owner feedback`);
    for (const f of run.feedback) md.push(`- **${f.decision}** by ${f.actor}: ${f.comment || '(no comment)'}`);
  }
  return { json: report, md: md.join('\n') };
}

async function generateReport(
  runId: string,
  source: VSource,
  actor: string,
  knowledgeContext: { title: string; solutionSteps: string } | null,
): Promise<{ ok: boolean; evidence?: VEvidence; report?: Record<string, unknown>; error?: string }> {
  return enqueue(async () => {
    const run = findRun(String(runId ?? ''));
    if (!run) return { ok: false, error: `unknown verification run "${runId}"` };
    if (run.analyses.length === 0) {
      return { ok: false, error: `run ${run.id} has no analysis yet — submit the result analysis before generating the report` };
    }
    if (!['VERIFIED', 'PARTIALLY_VERIFIED', 'FAILED', 'BLOCKED'].includes(run.status)) {
      return { ok: false, error: `run ${run.id} is ${run.status} — reports are generated after a conclusion` };
    }
    const { json, md } = buildReport(run.id, knowledgeContext);
    const jsonText = JSON.stringify(json, null, 2);
    const dir = verificationEvidenceDir(run.id);
    const jsonPath = `${dir}/report.json`;
    const mdPath = `${dir}/report.md`;
    const wOk1 = await wsWriteFile(jsonPath, jsonText);
    const wOk2 = await wsWriteFile(mdPath, md);
    if (!wOk1 || !wOk2) {
      return { ok: false, error: 'writing the report artifacts to the workspace failed' };
    }
    const evJson: VEvidence = {
      id: nextId('vev'),
      runId: run.id,
      testCaseId: null,
      type: 'report',
      filename: 'report.json',
      storageRef: jsonPath,
      sha256: sha256(jsonText),
      bytes: jsonText.length,
      createdAt: nowIso(),
      createdBy: actor,
    };
    const evMd: VEvidence = {
      id: nextId('vev'),
      runId: run.id,
      testCaseId: null,
      type: 'report',
      filename: 'report.md',
      storageRef: mdPath,
      sha256: sha256(md),
      bytes: md.length,
      createdAt: nowIso(),
      createdBy: actor,
    };
    store.evidence.push(evJson, evMd);
    run.reportEvidenceId = evJson.id;
    if (!run.completedAt) {
      run.completedAt = nowIso();
      run.durationMs = run.startedAt ? Date.now() - Date.parse(run.startedAt) : null;
    }
    stepComplete(run, 10, `final report generated — ${evMd.storageRef} (sha256 ${evMd.sha256.slice(0, 16)}…)`);
    run.currentStage = 10;
    run.updatedAt = nowIso();
    dirty.runs = dirty.evidence = dirty.meta = true;
    const w = await persistDirty();
    journal(source, actor, 'verification:report', w.ok,
      w.ok
        ? `Verification report for ${run.id} generated and stored as evidence (${run.status}). report.md + report.json written to ${dir}.`
        : `Report generated but NOT saved: ${w.error}`,
      { runId: run.id, status: run.status, sha256Json: evJson.sha256 });
    deps?.broadcastState();
    if (!w.ok) return { ok: false, error: w.error };
    return { ok: true, evidence: evMd, report: json };
  });
}

/* ------------------------------------------------------------------ */
/* Owner feedback                                                      */
/* ------------------------------------------------------------------ */

async function recordFeedback(
  runId: string,
  decision: 'accept' | 'reject' | 'comment',
  comment: string,
  actor: string,
): Promise<{ ok: boolean; error?: string }> {
  return enqueue(async () => {
    const run = findRun(String(runId ?? ''));
    if (!run) return { ok: false, error: `unknown verification run "${runId}"` };
    const fb: VFeedback = {
      id: nextId('vfb'),
      decision: decision === 'reject' ? 'reject' : decision === 'comment' ? 'comment' : 'accept',
      comment: truncate(comment ?? '', 2000),
      actor,
      createdAt: nowIso(),
    };
    run.feedback.push(fb);
    run.updatedAt = nowIso();
    dirty.runs = dirty.meta = true;
    const w = await persistDirty();
    journal('web', actor, 'verification:feedback', w.ok,
      `Owner feedback on ${run.id}: ${fb.decision}${fb.comment ? ` — "${truncate(fb.comment, 200)}"` : ''}.`,
      { runId: run.id, decision: fb.decision });
    deps?.broadcastState();
    return w.ok ? { ok: true } : { ok: false, error: w.error };
  });
}

/* ------------------------------------------------------------------ */
/* Web state                                                           */
/* ------------------------------------------------------------------ */

function runForWeb(run: VRun): VRunForWeb {
  return {
    id: run.id,
    knowledgeId: run.knowledgeId,
    knowledgeVersion: run.knowledgeVersion,
    title: run.title,
    status: run.status,
    currentStage: run.currentStage,
    stageName: STAGES[run.currentStage - 1] ?? '',
    hypothesis: run.hypothesis.text,
    stats: run.stats,
    needsDangerousConfirm: run.needsDangerousConfirm,
    cancelled: run.cancelled,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    updatedAt: run.updatedAt,
    createdBy: run.createdBy,
    conclusion: run.conclusion,
  };
}

function stateForWeb(): VStateForWeb {
  const byStatus = {} as Record<VRunStatus, number>;
  const statuses: VRunStatus[] = ['PENDING', 'PLANNING', 'READY', 'TESTING', 'ANALYZING', 'PARTIALLY_VERIFIED', 'VERIFIED', 'FAILED', 'BLOCKED'];
  for (const s of statuses) byStatus[s] = 0;
  for (const r of store.runs) if (byStatus[r.status] !== undefined) byStatus[r.status]++;
  return {
    ok: true,
    online: store.online,
    syncedAt: store.syncedAt,
    note: store.note,
    counts: {
      total: store.runs.length,
      byStatus,
      cases: store.cases.length,
      attempts: store.attempts.length,
      evidence: store.evidence.length,
    },
    runs: [...store.runs].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)).map(runForWeb),
  };
}

/* ------------------------------------------------------------------ */
/* Init + public API                                                   */
/* ------------------------------------------------------------------ */

export interface VerificationApi {
  sync: (source?: VSource, actor?: string) => Promise<StoreState>;
  createRun: (input: CreateRunInput, source: VSource, actor: string) => Promise<{ ok: boolean; run?: VRun; error?: string }>;
  submitPlan: (input: PlanInput, source: VSource, actor: string) => Promise<{ ok: boolean; run?: VRun; error?: string; refused?: string[] }>;
  startRun: (runId: string, source: VSource, actor: string, opts?: { confirmDangerous?: boolean }) => Promise<{ ok: boolean; error?: string }>;
  cancelRun: (runId: string, source: VSource, actor: string, reason?: string) => Promise<{ ok: boolean; error?: string }>;
  submitAnalysis: (input: AnalysisInput, source: VSource, actor: string) => Promise<{ ok: boolean; run?: VRun; analysis?: VAnalysis; error?: string; rejectedMetrics?: string[] }>;
  addRegression: (input: RegressInput, source: VSource, actor: string) => Promise<{ ok: boolean; run?: VRun; error?: string; refused?: string[] }>;
  generateReport: (runId: string, source: VSource, actor: string, knowledgeContext: { title: string; solutionSteps: string } | null) => Promise<{ ok: boolean; evidence?: VEvidence; report?: Record<string, unknown>; error?: string }>;
  recordFeedback: (runId: string, decision: 'accept' | 'reject' | 'comment', comment: string, actor: string) => Promise<{ ok: boolean; error?: string }>;
  getRun: (runId: string) => { ok: boolean; detail?: VRunDetail; error?: string };
  stateForWeb: () => VStateForWeb;
  detailFor: (runId: string) => VRunDetail;
}

export function initVerification(
  injected: VerificationDeps,
): VerificationApi {
  deps = injected;
  rawExec = injected.rawExec;
  cacheFile = join(injected.dataDir, 'verification-cache.json');
  loadLocalCache();
  return {
    sync: (source = 'system', actor = 'System') => syncFromWorkspace(source, actor),
    createRun,
    submitPlan,
    startRun,
    cancelRun,
    submitAnalysis,
    addRegression,
    generateReport,
    recordFeedback,
    getRun: (runId: string) => {
      const run = findRun(String(runId ?? ''));
      if (!run) return { ok: false, error: `unknown verification run "${runId}"` };
      return { ok: true, detail: detailFor(run.id) };
    },
    stateForWeb,
    detailFor,
  };
}
