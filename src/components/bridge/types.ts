/* ------------------------------------------------------------------ */
/* Shared types + helpers for the Z.ai Workspace Bridge dashboard.     */
/* Extracted from the original page so views stay focused and typed.   */
/* ------------------------------------------------------------------ */

export type Actor = 'GLM (z.ai web)' | 'Web viewer' | 'GLM (VS Code chat)' | 'GLM (web chat)' | 'You (VS Code)' | 'System';

export interface ActivityEntry {
  id: string;
  ts: number;
  source: 'operator' | 'web' | 'vscode' | 'local' | 'system';
  actor: Actor | string;
  kind: 'tool' | 'note' | 'fs' | 'conn' | 'skill' | 'knowledge' | 'verification';
  tool?: string;
  fsType?: 'created' | 'changed' | 'deleted';
  path?: string;
  args?: Record<string, unknown>;
  ok?: boolean;
  result?: string;
  meta?: {
    kind?: string;
    path?: string;
    fromPath?: string;
    linesAdded?: number;
    linesRemoved?: number;
    lines?: number;
    bytes?: number;
    wasDir?: boolean;
    diff?: { t: string; s: string }[];
    [k: string]: unknown;
  };
  durMs?: number;
  text?: string;
}

export interface TreeNode {
  name: string;
  path: string;
  type: 'dir' | 'file';
  size?: number | null;
  children?: TreeNode[];
}

export interface TreePayload {
  name?: string;
  tree?: TreeNode;
  stats?: { files: number; dirs: number; totalBytes: number; nodes: number; truncated: boolean; scannedAt: string };
  error?: string;
}

export interface SvcStatus {
  connected?: boolean;
  workspaceName?: string | null;
  workspaceOnline?: boolean;
  running?: boolean;
  queued?: number;
  webClients?: number;
  tree?: { files: number; dirs: number; totalBytes: number; truncated: boolean; scannedAt: string } | null;
  activityCount?: number;
  skills?: { count: number; source?: string } | null;
  knowledge?: { counts?: KnowledgeCounts; online?: boolean; syncedAt?: number | null; note?: string } | null;
}

export interface SkillFileMeta {
  path: string;
  size: number;
  main?: boolean;
}

/** A skill discovered in the workspace .skills/ folder. */
export interface Skill {
  name: string;
  path: string;
  size: number;
  format?: 'text' | 'package'; // loose file vs sub-folder package (SKILL.md + files)
  files?: SkillFileMeta[]; // package only
  source?: string;
}

export interface SkillsMeta {
  scannedAt?: number;
  online?: boolean;
  note?: string;
}

export interface SkillFileView {
  path: string;
  size: number;
  content: string;
}

export interface FileViewState {
  path: string;
  loading: boolean;
  content?: string;
  meta?: any;
  error?: string;
  ts?: number;
}

export interface SkillViewState {
  name: string;
  loading: boolean;
  content?: string;
  skill?: Skill;
  error?: string;
  files?: SkillFileView[];
  activeFile?: string;
}

export type FeedFilter = 'all' | 'ai' | 'you' | 'sys';

/* Knowledge — the shared, verification-gated experience library (knowledge/ in the workspace) */

export type KnowledgeStatus = 'candidate' | 'verification_pending' | 'verified' | 'rejected' | 'deprecated' | 'archived';
export type KnowledgeStatusFilter = KnowledgeStatus | 'all';
export type KnowledgeVerifStatus = 'pending' | 'passed' | 'failed' | 'unable_to_verify' | 'human_approved';

export interface KnowledgeEvidence { ts: number; source: string; command?: string; exitCode?: number | null; timedOut?: boolean; summary: string; journalRef?: string; actor: string; }
export interface KnowledgeVersion {
  version: number; createdBy: string; createdAt: string; symptoms: string; rootCause: string; solutionSteps: string;
  environment: string; applicableVersions: string; limitations: string; compatibilityNotes?: string; changeReason?: string;
  verificationStatus: KnowledgeVerifStatus; verificationSummary: string; evidence: KnowledgeEvidence[]; supersedes?: number;
}
export interface KnowledgeRecord {
  id: string; scope: 'global' | 'project'; projectId: string | null; category: string; title: string; problemSummary: string;
  status: KnowledgeStatus; activeVersion: number; versions: KnowledgeVersion[]; reuseStats: { used: number; worked: number; failed: number };
  createdBy: string; createdAt: string; updatedAt: string; archivedAt: string | null; deletedAt: null;
}
export interface KnowledgeAttempt { id: string; experienceId: string | null; problemSummary: string; approach: string; result: string; failureReason: string; environment: string; createdAt: string; }
export interface KnowledgeFeedback { id: string; experienceId: string; experienceVersion: number; outcome: 'worked' | 'failed' | 'incompatible'; notes: string; createdAt: string; }
export interface KnowledgeAudit { id: string; ts: number; actor: string; operation: string; entityType: string; entityId: string; oldVersion: number | null; newVersion: number | null; reason: string; }
export interface KnowledgeCounts { verified: number; candidate: number; verificationPending: number; rejected: number; deprecated: number; archived: number; deleted: number; attempts: number; feedback: number; audit: number; }
export interface KnowledgeState { ok?: boolean; online?: boolean; syncedAt?: number | null; note?: string; counts?: KnowledgeCounts; projectName?: string | null; storeDir?: string; experiences?: KnowledgeRecord[]; attempts?: KnowledgeAttempt[]; feedback?: KnowledgeFeedback[]; audit?: KnowledgeAudit[]; }

/* Verification — the scientific verification engine (knowledge/verification/) */

export type VRunStatus = 'PENDING' | 'PLANNING' | 'READY' | 'TESTING' | 'ANALYZING' | 'PARTIALLY_VERIFIED' | 'VERIFIED' | 'FAILED' | 'BLOCKED';
export type VCaseStatus = 'NOT_EXECUTED' | 'PASS' | 'FAIL' | 'ERROR' | 'SKIPPED' | 'BLOCKED';

export interface VStep { n: number; name: string; status: 'pending' | 'running' | 'complete' | 'failed' | 'skipped'; startedAt: number | null; completedAt: number | null; durationMs: number | null; details: string; }
export interface VStats { planned: number; generated: number; executed: number; passed: number; failed: number; skipped: number; blocked: number; errors: number; attempts: number; iterations: number; passRate: number | null; }
export interface VRound { n: number; kind: 'initial' | 'regression'; hypothesis: string; expectedObservation: string; changeNote: string; createdAt: string; outcome: string; }
export interface VAnalysis { id: string; round: number; submittedBy: string; createdAt: string; summary: string; comparison: string; alternativeExplanations: string; recommendedModifications: string; proposedConclusion: { status: string; summary: string }; engineDecision: { accepted: boolean; effectiveStatus: string; reason: string }; metricIds: string[]; }
export interface VConclusion { status: string; summary: string; glmInterpretation: string; stats: VStats; decidedAt: string; decidedBy: string; }
export interface VEnvironment { capturedAt: number; os: string; runtimes: string; sourceRevision: string | null; journalRefs: string[]; }
export interface VProblem { description: string; symptoms: string; expectedBehavior: string; actualBehavior: string; facts: string; assumptions: string; environment: string; constraints: string; }
export interface VHypothesis { text: string; expectedObservation: string; supportingEvidence: string; contradictingEvidence: string; }
export interface VFeedback { id: string; decision: 'accept' | 'reject' | 'comment'; comment: string; actor: string; createdAt: string; }
export interface VRun {
  id: string; knowledgeId: string; knowledgeVersion: number; title: string;
  problem: VProblem; hypothesis: VHypothesis; strategy: string;
  status: VRunStatus; currentStage: number; steps: VStep[]; rounds: VRound[]; analyses: VAnalysis[];
  environmentSnapshot: VEnvironment | null; stats: VStats; conclusion: VConclusion | null;
  cancelled: boolean; cancelReason: string; needsDangerousConfirm: boolean;
  startedAt: string | null; completedAt: string | null; durationMs: number | null;
  reportEvidenceId: string | null; createdBy: string; createdAt: string; updatedAt: string; feedback: VFeedback[];
}
export interface VRunForWeb { id: string; knowledgeId: string; knowledgeVersion: number; title: string; status: VRunStatus; currentStage: number; stageName: string; hypothesis: string; stats: VStats; needsDangerousConfirm: boolean; cancelled: boolean; startedAt: string | null; completedAt: string | null; updatedAt: string; createdBy: string; conclusion: VConclusion | null; }
export interface VTestCase {
  id: string; runId: string; round: number; name: string; objective: string; category: string;
  command: string; timeoutMs: number;
  expected: { expectedResult: string; successCriteria: string; failureCriteria: string };
  criteria: { exitCode: number; outputContains: string[]; outputNotContains: string[] };
  flags: { critical: boolean; requiresNetwork: boolean; destructive: boolean };
  status: VCaseStatus; latestAttemptId: string | null; createdAt: string;
}
export interface VAttempt { id: string; testCaseId: string; runId: string; round: number; attemptNumber: number; status: 'PASS' | 'FAIL' | 'ERROR' | 'BLOCKED'; command: string; exitCode: number | null; timedOut: boolean; output: string; durationMs: number; startedAt: string; completedAt: string; journalRef: string | null; evaluatedBy: string; note: string; }
export interface VMetric { id: string; runId: string; testCaseId: string | null; name: string; value: string; unit: string; source: 'measured' | 'reported'; verified: boolean; recordedAt: string; }
export interface VEvidence { id: string; runId: string; testCaseId: string | null; type: string; filename: string; storageRef: string; sha256: string; bytes: number; createdAt: string; createdBy: string; }
export interface VRunDetail { run: VRun; cases: VTestCase[]; attempts: VAttempt[]; metrics: VMetric[]; evidence: VEvidence[]; }
export interface VerificationState { ok?: boolean; online?: boolean; syncedAt?: number | null; note?: string; counts?: { total: number; byStatus?: Record<string, number>; cases: number; attempts: number; evidence: number }; runs?: VRunForWeb[]; }

/* Navigation — client-side views (single / route, hash-synced) */

export type ViewId = 'overview' | 'activity' | 'workspace' | 'knowledge' | 'skills' | 'setup';
export const VIEW_IDS: ViewId[] = ['overview', 'activity', 'workspace', 'knowledge', 'skills', 'setup'];

export const TOKEN_KEY = 'aiCodeAgent.webToken';

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

export function extractCode(raw: string): string {
  const strict = raw.toUpperCase().match(/[A-HJ-NP-Z2-9]{6}/);
  if (strict) return strict[0];
  const loose = raw.toUpperCase().match(/[A-Z0-9]{6}/);
  return loose ? loose[0] : '';
}

export function fmtBytes(n: number | null | undefined): string {
  if (n === null || n === undefined) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function timeStr(ts: number): string {
  try { return new Date(ts).toLocaleTimeString([], { hour12: false }); } catch { return ''; }
}

/** Compact "when": time for today, short date otherwise. */
export function shortWhen(value: string | number): string {
  try {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    const now = new Date();
    return d.toDateString() === now.toDateString()
      ? timeStr(d.getTime())
      : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  } catch { return ''; }
}

export function shortActor(actor: string | undefined): string {
  const a = String(actor ?? '');
  if (a === 'GLM (z.ai web)') return 'glm';
  if (a === 'Web viewer') return 'web';
  if (a === 'You (VS Code)') return 'you';
  if (a.startsWith('GLM')) return 'glm';
  if (a === 'System') return 'sys';
  if (a === '…') return '…';
  return a.slice(0, 8).toLowerCase();
}

/** Color + label for a knowledge record lifecycle state. */
export function knowledgeStatusMeta(s: string): { color: string; label: string } {
  switch (s) {
    case 'verified': return { color: 'text-vs-green', label: 'verified' };
    case 'candidate': return { color: 'text-vs-yellow', label: 'candidate' };
    case 'verification_pending': return { color: 'text-vs-blue', label: 'verifying' };
    case 'rejected': return { color: 'text-vs-red', label: 'rejected' };
    case 'deprecated': return { color: 'text-vs-orange', label: 'deprecated' };
    case 'archived': return { color: 'text-vs-dim', label: 'archived' };
    default: return { color: 'text-vs-dim', label: s };
  }
}

/** Glyph + color for a version's verification-gate status. */
export function knowledgeVerifMeta(s: string): { cls: string; label: string; glyph: string } {
  switch (s) {
    case 'passed': return { cls: 'text-vs-green', label: 'passed', glyph: '✓' };
    case 'failed': return { cls: 'text-vs-red', label: 'failed', glyph: '✗' };
    case 'human_approved': return { cls: 'text-vs-teal', label: 'human approved', glyph: '✓' };
    case 'unable_to_verify': return { cls: 'text-vs-yellow', label: 'unable to verify', glyph: '?' };
    case 'pending': return { cls: 'text-vs-yellow', label: 'pending', glyph: '…' };
    default: return { cls: 'text-vs-yellow', label: s, glyph: '?' };
  }
}

export function vStatusMeta(s: string): { cls: string; label: string; glyph: string } {
  switch (s) {
    case 'VERIFIED': return { cls: 'text-vs-green', label: 'verified', glyph: '✔' };
    case 'PARTIALLY_VERIFIED': return { cls: 'text-vs-yellow', label: 'partially verified', glyph: '◐' };
    case 'FAILED': return { cls: 'text-vs-red', label: 'failed', glyph: '✗' };
    case 'BLOCKED': return { cls: 'text-vs-orange', label: 'blocked', glyph: '⊘' };
    case 'TESTING': return { cls: 'text-vs-blue-bright', label: 'testing', glyph: '▶' };
    case 'ANALYZING': return { cls: 'text-vs-blue-bright', label: 'analyzing', glyph: '☰' };
    case 'READY': return { cls: 'text-vs-teal', label: 'ready', glyph: '⏸' };
    case 'PLANNING': return { cls: 'text-vs-purple', label: 'planning', glyph: '✎' };
    default: return { cls: 'text-vs-dim', label: 'pending', glyph: '…' };
  }
}

export function vCaseMeta(s: string): { cls: string; glyph: string; label: string } {
  switch (s) {
    case 'PASS': return { cls: 'text-vs-green', glyph: '✓', label: 'pass' };
    case 'FAIL': return { cls: 'text-vs-red', glyph: '✗', label: 'fail' };
    case 'ERROR': return { cls: 'text-vs-yellow', glyph: '⚠', label: 'infra error' };
    case 'SKIPPED': return { cls: 'text-vs-faint', glyph: '⏭', label: 'skipped' };
    case 'BLOCKED': return { cls: 'text-vs-orange', glyph: '⊘', label: 'blocked' };
    default: return { cls: 'text-vs-faint', glyph: '·', label: 'not executed' };
  }
}

export function vStepMeta(s: string): { cls: string; glyph: string } {
  switch (s) {
    case 'complete': return { cls: 'text-vs-green', glyph: '●' };
    case 'running': return { cls: 'text-vs-blue-bright', glyph: '◐' };
    case 'failed': return { cls: 'text-vs-red', glyph: '✗' };
    case 'skipped': return { cls: 'text-vs-faint', glyph: '○' };
    default: return { cls: 'text-vs-faint', glyph: '○' };
  }
}
