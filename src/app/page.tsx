'use client';

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { io, Socket } from 'socket.io-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
  Zap, Wifi, WifiOff, Loader2, Link2, ClipboardPaste, RefreshCw, ChevronRight, ChevronDown,
  Folder, FolderOpen, FileText, FileCode, FileJson, FileImage, FileArchive, File,
  Search, Eye, Pencil, PencilLine, Trash2, ArrowRightLeft, FolderPlus, TerminalSquare,
  Stethoscope, List, MessageSquareQuote, CheckCircle2, XCircle, Copy, X, HardDrive,
  Activity, ShieldCheck, User, Bot, Server, ListFilter, Trash, Gauge,
  BookOpen, GraduationCap, AlertTriangle, Download, KeyRound,
  Brain, FlaskConical, History, Archive, Undo2, Play, Square,
} from 'lucide-react';

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

type Actor = 'GLM (z.ai web)' | 'Web viewer' | 'GLM (VS Code chat)' | 'GLM (web chat)' | 'You (VS Code)' | 'System';

interface ActivityEntry {
  id: string;
  ts: number;
  source: 'operator' | 'web' | 'vscode' | 'local' | 'system';
  actor: Actor | string;
  kind: 'tool' | 'note' | 'fs' | 'conn' | 'skill' | 'knowledge';
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

interface TreeNode {
  name: string;
  path: string;
  type: 'dir' | 'file';
  size?: number | null;
  children?: TreeNode[];
}

interface TreePayload {
  name?: string;
  tree?: TreeNode;
  stats?: { files: number; dirs: number; totalBytes: number; nodes: number; truncated: boolean; scannedAt: string };
  error?: string;
}

interface SvcStatus {
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

interface SkillFileMeta {
  path: string;
  size: number;
  main?: boolean;
}

/** A skill discovered in the workspace .skills/ folder. */
interface Skill {
  name: string;
  path: string;
  size: number;
  format?: 'text' | 'package'; // loose file vs sub-folder package (SKILL.md + files)
  files?: SkillFileMeta[]; // package only
  source?: string;
}

interface SkillsMeta {
  scannedAt?: number;
  online?: boolean;
  note?: string;
}

interface SkillFileView {
  path: string;
  size: number;
  content: string;
}

/* Knowledge — the shared, verification-gated experience library (knowledge/ in the workspace) */

type KnowledgeStatus = 'candidate' | 'verification_pending' | 'verified' | 'rejected' | 'deprecated' | 'archived';
type KnowledgeStatusFilter = KnowledgeStatus | 'all';
type KnowledgeVerifStatus = 'pending' | 'passed' | 'failed' | 'unable_to_verify' | 'human_approved';

interface KnowledgeEvidence { ts: number; source: string; command?: string; exitCode?: number | null; timedOut?: boolean; summary: string; journalRef?: string; actor: string; }
interface KnowledgeVersion {
  version: number; createdBy: string; createdAt: string; symptoms: string; rootCause: string; solutionSteps: string;
  environment: string; applicableVersions: string; limitations: string; compatibilityNotes?: string; changeReason?: string;
  verificationStatus: KnowledgeVerifStatus; verificationSummary: string; evidence: KnowledgeEvidence[]; supersedes?: number;
}
interface KnowledgeRecord {
  id: string; scope: 'global' | 'project'; projectId: string | null; category: string; title: string; problemSummary: string;
  status: KnowledgeStatus; activeVersion: number; versions: KnowledgeVersion[]; reuseStats: { used: number; worked: number; failed: number };
  createdBy: string; createdAt: string; updatedAt: string; archivedAt: string | null; deletedAt: null;
}
interface KnowledgeAttempt { id: string; experienceId: string | null; problemSummary: string; approach: string; result: string; failureReason: string; environment: string; createdAt: string; }
interface KnowledgeFeedback { id: string; experienceId: string; experienceVersion: number; outcome: 'worked' | 'failed' | 'incompatible'; notes: string; createdAt: string; }
interface KnowledgeAudit { id: string; ts: number; actor: string; operation: string; entityType: string; entityId: string; oldVersion: number | null; newVersion: number | null; reason: string; }
interface KnowledgeCounts { verified: number; candidate: number; verificationPending: number; rejected: number; deprecated: number; archived: number; deleted: number; attempts: number; feedback: number; audit: number; }
interface KnowledgeState { ok?: boolean; online?: boolean; syncedAt?: number | null; note?: string; counts?: KnowledgeCounts; projectName?: string | null; storeDir?: string; experiences?: KnowledgeRecord[]; attempts?: KnowledgeAttempt[]; feedback?: KnowledgeFeedback[]; audit?: KnowledgeAudit[]; }

/* Verification — the scientific verification engine (knowledge/verification/) */

type VRunStatus = 'PENDING' | 'PLANNING' | 'READY' | 'TESTING' | 'ANALYZING' | 'PARTIALLY_VERIFIED' | 'VERIFIED' | 'FAILED' | 'BLOCKED';
type VCaseStatus = 'NOT_EXECUTED' | 'PASS' | 'FAIL' | 'ERROR' | 'SKIPPED' | 'BLOCKED';

interface VStep { n: number; name: string; status: 'pending' | 'running' | 'complete' | 'failed' | 'skipped'; startedAt: number | null; completedAt: number | null; durationMs: number | null; details: string; }
interface VStats { planned: number; generated: number; executed: number; passed: number; failed: number; skipped: number; blocked: number; errors: number; attempts: number; iterations: number; passRate: number | null; }
interface VRound { n: number; kind: 'initial' | 'regression'; hypothesis: string; expectedObservation: string; changeNote: string; createdAt: string; outcome: string; }
interface VAnalysis { id: string; round: number; submittedBy: string; createdAt: string; summary: string; comparison: string; alternativeExplanations: string; recommendedModifications: string; proposedConclusion: { status: string; summary: string }; engineDecision: { accepted: boolean; effectiveStatus: string; reason: string }; metricIds: string[]; }
interface VConclusion { status: string; summary: string; glmInterpretation: string; stats: VStats; decidedAt: string; decidedBy: string; }
interface VEnvironment { capturedAt: number; os: string; runtimes: string; sourceRevision: string | null; journalRefs: string[]; }
interface VProblem { description: string; symptoms: string; expectedBehavior: string; actualBehavior: string; facts: string; assumptions: string; environment: string; constraints: string; }
interface VHypothesis { text: string; expectedObservation: string; supportingEvidence: string; contradictingEvidence: string; }
interface VFeedback { id: string; decision: 'accept' | 'reject' | 'comment'; comment: string; actor: string; createdAt: string; }
interface VRun {
  id: string; knowledgeId: string; knowledgeVersion: number; title: string;
  problem: VProblem; hypothesis: VHypothesis; strategy: string;
  status: VRunStatus; currentStage: number; steps: VStep[]; rounds: VRound[]; analyses: VAnalysis[];
  environmentSnapshot: VEnvironment | null; stats: VStats; conclusion: VConclusion | null;
  cancelled: boolean; cancelReason: string; needsDangerousConfirm: boolean;
  startedAt: string | null; completedAt: string | null; durationMs: number | null;
  reportEvidenceId: string | null; createdBy: string; createdAt: string; updatedAt: string; feedback: VFeedback[];
}
interface VRunForWeb { id: string; knowledgeId: string; knowledgeVersion: number; title: string; status: VRunStatus; currentStage: number; stageName: string; hypothesis: string; stats: VStats; needsDangerousConfirm: boolean; cancelled: boolean; startedAt: string | null; completedAt: string | null; updatedAt: string; createdBy: string; conclusion: VConclusion | null; }
interface VTestCase {
  id: string; runId: string; round: number; name: string; objective: string; category: string;
  command: string; timeoutMs: number;
  expected: { expectedResult: string; successCriteria: string; failureCriteria: string };
  criteria: { exitCode: number; outputContains: string[]; outputNotContains: string[] };
  flags: { critical: boolean; requiresNetwork: boolean; destructive: boolean };
  status: VCaseStatus; latestAttemptId: string | null; createdAt: string;
}
interface VAttempt { id: string; testCaseId: string; runId: string; round: number; attemptNumber: number; status: 'PASS' | 'FAIL' | 'ERROR' | 'BLOCKED'; command: string; exitCode: number | null; timedOut: boolean; output: string; durationMs: number; startedAt: string; completedAt: string; journalRef: string | null; evaluatedBy: string; note: string; }
interface VMetric { id: string; runId: string; testCaseId: string | null; name: string; value: string; unit: string; source: 'measured' | 'reported'; verified: boolean; recordedAt: string; }
interface VEvidence { id: string; runId: string; testCaseId: string | null; type: string; filename: string; storageRef: string; sha256: string; bytes: number; createdAt: string; createdBy: string; }
interface VRunDetail { run: VRun; cases: VTestCase[]; attempts: VAttempt[]; metrics: VMetric[]; evidence: VEvidence[]; }
interface VerificationState { ok?: boolean; online?: boolean; syncedAt?: number | null; note?: string; counts?: { total: number; byStatus?: Record<string, number>; cases: number; attempts: number; evidence: number }; runs?: VRunForWeb[]; }

const TOKEN_KEY = 'aiCodeAgent.webToken';

function extractCode(raw: string): string {
  const strict = raw.toUpperCase().match(/[A-HJ-NP-Z2-9]{6}/);
  if (strict) return strict[0];
  const loose = raw.toUpperCase().match(/[A-Z0-9]{6}/);
  return loose ? loose[0] : '';
}

function fmtBytes(n: number | null | undefined): string {
  if (n === null || n === undefined) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function timeStr(ts: number): string {
  try { return new Date(ts).toLocaleTimeString([], { hour12: false }); } catch { return ''; }
}

/** Color + label for a knowledge record lifecycle state. */
function knowledgeStatusMeta(s: string): { color: string; label: string } {
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
function knowledgeVerifMeta(s: string): { cls: string; label: string; glyph: string } {
  switch (s) {
    case 'passed': return { cls: 'text-vs-green', label: 'passed', glyph: '✓' };
    case 'failed': return { cls: 'text-vs-red', label: 'failed', glyph: '✗' };
    case 'human_approved': return { cls: 'text-vs-teal', label: 'human approved', glyph: '✓' };
    case 'unable_to_verify': return { cls: 'text-vs-yellow', label: 'unable to verify', glyph: '?' };
    case 'pending': return { cls: 'text-vs-yellow', label: 'pending', glyph: '…' };
    default: return { cls: 'text-vs-yellow', label: s, glyph: '?' };
  }
}

/** Compact "when": time for today, short date otherwise. */
function shortWhen(value: string | number): string {
  try {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    const now = new Date();
    return d.toDateString() === now.toDateString()
      ? timeStr(d.getTime())
      : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  } catch { return ''; }
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */
export default function AgentPage() {
  const [svcUp, setSvcUp] = useState(false);
  const [status, setStatus] = useState<SvcStatus>({});
  const [paired, setPaired] = useState(false);
  const [pairInput, setPairInput] = useState('');
  const [pairingNote, setPairingNote] = useState<string | null>(null);

  const [tree, setTree] = useState<TreePayload | null>(null);
  const [treeLoading, setTreeLoading] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set(['']));
  const [filter, setFilter] = useState('');
  const [showAllFlat, setShowAllFlat] = useState(false);

  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());
  const [feedFilter, setFeedFilter] = useState<'all' | 'ai' | 'you' | 'sys'>('all');

  const [fileView, setFileView] = useState<{ path: string; loading: boolean; content?: string; meta?: any; error?: string; ts?: number } | null>(null);

  const [skills, setSkills] = useState<Skill[]>([]);
  const [skillView, setSkillView] = useState<{ name: string; loading: boolean; content?: string; skill?: Skill; error?: string; files?: SkillFileView[]; activeFile?: string } | null>(null);
  const [skillsMeta, setSkillsMeta] = useState<SkillsMeta>({});
  const [skillsRefreshing, setSkillsRefreshing] = useState(false);

  /* knowledge — the shared, verification-gated experience library */
  const [knowledge, setKnowledge] = useState<KnowledgeState | null>(null);
  const [knowledgeRefreshing, setKnowledgeRefreshing] = useState(false);
  const [knowledgeSearch, setKnowledgeSearch] = useState('');
  const [knowledgeScope, setKnowledgeScope] = useState<'all' | 'global' | 'project'>('all');
  const [knowledgeStatusFilter, setKnowledgeStatusFilter] = useState<KnowledgeStatusFilter>('all');
  const [knowledgeCategory, setKnowledgeCategory] = useState('');
  const [knowledgeSelected, setKnowledgeSelected] = useState<string | null>(null);
  const [knowledgeConfirm, setKnowledgeConfirm] = useState<string | null>(null);
  const [knowledgeActionError, setKnowledgeActionError] = useState<string | null>(null);
  const [knowledgeVersionsOpen, setKnowledgeVersionsOpen] = useState(false);
  const [knowledgeOpenVersions, setKnowledgeOpenVersions] = useState<Set<number>>(new Set());
  const [knowledgeAttemptsOpen, setKnowledgeAttemptsOpen] = useState(false);
  const [knowledgeAuditOpen, setKnowledgeAuditOpen] = useState(false);
  const knowledgeConfirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* verification — the scientific verification engine */
  const [verification, setVerification] = useState<VerificationState | null>(null);
  const [vRunId, setVRunId] = useState<string | null>(null);
  const [vRun, setVRun] = useState<VRunDetail | null>(null);
  const [vBusy, setVBusy] = useState(false);
  const [vError, setVError] = useState<string | null>(null);
  const [vConfirm, setVConfirm] = useState<string | null>(null);
  const vConfirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const vRunIdRef = useRef<string | null>(null);
  useEffect(() => { vRunIdRef.current = vRunId; }, [vRunId]);

  const [rawEvents, setRawEvents] = useState<{ name: string; data: string; ts: number }[]>([]);
  const [showRaw, setShowRaw] = useState(false);

  const socketRef = useRef<Socket | null>(null);
  const rawRef = useRef<HTMLDivElement>(null);
  /* Reconnect kit — this page's own URL is the aiCodeAgent.serverUrl value. */
  const [pageUrl, setPageUrl] = useState('');
  useEffect(() => {
    try {
      const u = new URL(window.location.href);
      setPageUrl(u.origin + (u.pathname !== '/' ? u.pathname.replace(/\/+$/, '') : ''));
    } catch { /* ignore */ }
  }, []);

  const pairedRef = useRef(false);

  const pushRaw = useCallback((name: string, data: unknown) => {
    setRawEvents((prev) => {
      const next = [...prev.slice(-140), { name, data: (() => { try { return JSON.stringify(data)?.slice(0, 240) ?? ''; } catch { return ''; } })(), ts: Date.now() }];
      return next;
    });
  }, []);

  const upsertEntry = useCallback((e: ActivityEntry) => {
    setEntries((prev) => {
      const i = prev.findIndex((x) => x.id === e.id);
      if (i >= 0) {
        const next = [...prev];
        next[i] = { ...next[i], ...e };
        return next;
      }
      // dedupe notes: the same note may arrive via 'activity' AND 'operator:note'
      if (e.kind === 'note') {
        const dup = prev.find((x) => x.kind === 'note' && x.text === e.text && Math.abs((x.ts ?? 0) - (e.ts ?? 0)) < 5000);
        if (dup) return prev;
      }
      return [e, ...prev].slice(0, 300);
    });
  }, []);

  /* ---------------------------------------------------------------- */
  /* Socket wiring                                                     */
  /* ---------------------------------------------------------------- */
  useEffect(() => {
    // Connect to the agent service through the Caddy gateway.
    // NEVER use a port in the URL — always XTransformPort.
    // (?bridgePort=… is a debug/testing override; production default is 3003.)
    const bridgePort = new URLSearchParams(window.location.search).get('bridgePort') ?? '3003';
    const socket = io(`/?XTransformPort=${bridgePort}`, {
      transports: ['websocket', 'polling'],
      forceNew: true,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      timeout: 15000,
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      setSvcUp(true);
      socket.emit('hello', { role: 'web', token: localStorage.getItem(TOKEN_KEY) });
    });

    // If the bridge service ever dies, ask the Next.js server to revive it
    // (GET /api/bridge respawns the agent-service as a detached process).
    let lastRevive = 0;
    const reviveBridge = () => {
      const now = Date.now();
      if (now - lastRevive < 30_000) return;
      lastRevive = now;
      fetch('/api/bridge').catch(() => undefined);
    };
    socket.on('disconnect', () => { setSvcUp(false); reviveBridge(); });
    socket.on('connect_error', () => { setSvcUp(false); reviveBridge(); });

    socket.on('status', (s: SvcStatus) => { setStatus(s); pushRaw('status', s); });

    socket.on('pair:ok', (d: { token: string }) => {
      localStorage.setItem(TOKEN_KEY, d.token);
      pairedRef.current = true;
      setPaired(true);
      setPairingNote(null);
      setTreeLoading(true);
      socket.emit('activity:list');
    });
    socket.on('pair:rejected', (d: { reason: string }) => {
      setPairingNote(d?.reason ?? 'Invalid pairing code.');
    });

    socket.on('activity:list', (d: { entries: ActivityEntry[] }) => {
      setEntries((d?.entries ?? []).slice().reverse().slice(0, 300));
      setTreeLoading(false);
    });
    socket.on('activity', (e: ActivityEntry) => { upsertEntry(e); pushRaw('activity', { id: e.id, tool: e.tool, path: e.path, source: e.source }); });
    socket.on('activity:cleared', () => { setEntries([]); });

    socket.on('operator:note', (d: { text: string; ts: number }) => {
      // paired clients get notes via the 'activity' event; avoid double render
      if (pairedRef.current) return;
      upsertEntry({ id: `note-${d.ts}`, ts: d.ts, source: 'operator', actor: 'GLM (z.ai web)', kind: 'note', text: d.text });
    });

    /* live pending tools (filled in by the matching activity entry) */
    socket.on('tool:call', (d: { id: string; name: string; args: Record<string, unknown> }) => {
      upsertEntry({
        id: d.id, ts: Date.now(), source: 'operator', actor: '…', kind: 'tool', tool: d.name,
        path: typeof (d.args as any)?.path === 'string' ? String((d.args as any).path) : '',
        args: d.args, pending: true,
      } as ActivityEntry);
      pushRaw('tool:call', d);
    });
    socket.on('tool:result', (d: { id: string; ok: boolean; result: string }) => {
      pushRaw('tool:result', { id: d.id, ok: d.ok });
    });

    socket.on('workspace:tree', (t: TreePayload) => {
      setTree(t);
      setTreeLoading(false);
      pushRaw('workspace:tree', { stats: t?.stats });
    });

    socket.on('file:content', (d: { path: string; ok: boolean; content?: string; meta?: any; error?: string }) => {
      setFileView((prev) => prev && prev.path === d.path
        ? { ...prev, loading: false, content: d.ok ? d.content : undefined, meta: d.meta, error: d.ok ? undefined : d.error, ts: Date.now() }
        : prev);
      pushRaw('file:content', { path: d.path, ok: d.ok });
    });

    socket.on('session:cleared', () => pushRaw('session:cleared', {}));

    /* skills — documents in the workspace .skills/ folder, learned before GLM thinks */
    socket.on('skill:list', (d: { skills?: Skill[]; scannedAt?: number; online?: boolean; note?: string }) => {
      setSkills(Array.isArray(d?.skills) ? d.skills : []);
      setSkillsMeta({ scannedAt: d?.scannedAt, online: d?.online, note: d?.note });
      pushRaw('skill:list', { count: d?.skills?.length, online: d?.online });
    });

    /* knowledge — the shared, verification-gated experience library */
    socket.on('knowledge:state', (d: KnowledgeState) => {
      setKnowledge(d);
      setKnowledgeRefreshing(false);
      pushRaw('knowledge:state', { v: d.counts ? (d.counts.verified + d.counts.candidate) : 0 });
    });

    /* verification — the scientific engine (live run updates) */
    socket.on('verification:state', (d: VerificationState) => {
      setVerification(d);
      pushRaw('verification:state', { runs: d.counts?.total ?? 0 });
    });
    socket.on('verification:run', (d: VRunDetail) => {
      if (d?.run?.id && d.run.id === vRunIdRef.current) setVRun(d);
    });

    return () => {
      socket.disconnect();
    };
  }, [pushRaw, upsertEntry]);

  useEffect(() => {
    if (showRaw) rawRef.current?.scrollTo({ top: rawRef.current.scrollHeight });
  }, [rawEvents, showRaw]);

  /* ---------------------------------------------------------------- */
  /* Actions                                                           */
  /* ---------------------------------------------------------------- */
  const pair = (code: string) => {
    const c = extractCode(code || pairInput);
    if (c) {
      socketRef.current?.emit('pair', { code: c });
      setPairInput('');
    } else {
      setPairingNote('Enter the 6-character code shown in VS Code.');
    }
  };

  const pasteAndPair = async () => {
    try {
      const raw = await navigator.clipboard.readText();
      const c = extractCode(raw);
      if (c) pair(c);
      else setPairingNote('No pairing code found on the clipboard.');
    } catch {
      setPairingNote('Clipboard unavailable — type the code manually.');
    }
  };

  const refreshTree = () => {
    if (!paired) return;
    setTreeLoading(true);
    socketRef.current?.emit('tree:refresh');
    // safety: stop the spinner if no reply in 30s
    setTimeout(() => setTreeLoading(false), 30000);
  };

  const readFile = (path: string) => {
    if (!paired) return;
    setFileView({ path, loading: true, ts: Date.now() });
    socketRef.current?.emit('file:read', { path });
  };

  const clearActivity = () => socketRef.current?.emit('activity:clear');

  /* ---------------------------------------------------------------- */
  /* Skills — read from the workspace .skills/ folder                  */
  /* ---------------------------------------------------------------- */
  const refreshSkills = () => {
    if (!paired) return;
    setSkillsRefreshing(true);
    socketRef.current?.emit('skill:refresh', {}, (r: { ok?: boolean; skills?: Skill[]; scannedAt?: number; online?: boolean; note?: string; error?: string }) => {
      setSkillsRefreshing(false);
      if (Array.isArray(r?.skills)) setSkills(r.skills);
      setSkillsMeta({ scannedAt: r?.scannedAt, online: r?.online, note: r?.note ?? r?.error });
    });
    // safety: stop the spinner if no reply in 30s
    setTimeout(() => setSkillsRefreshing(false), 30000);
  };

  const openSkill = (name: string) => {
    setSkillView({ name, loading: true });
    socketRef.current?.emit('skill:get', { name }, (r: { ok?: boolean; skill?: Skill; content?: string; files?: SkillFileView[]; error?: string }) => {
      if (!r?.ok) {
        setSkillView({ name, loading: false, error: r?.error ?? 'Could not read the skill.' });
        return;
      }
      const files = Array.isArray(r.files) ? r.files : undefined;
      const mainMeta = r.skill?.files?.find((m) => m.main);
      const activeFile = files && files.length > 0
        ? (files.find((f) => f.path === mainMeta?.path)?.path ?? files[0].path)
        : undefined;
      setSkillView({ name, loading: false, skill: r.skill, content: r.content, files, activeFile });
    });
  };

  /* ---------------------------------------------------------------- */
  /* Knowledge — shared, verification-gated experience library         */
  /* ---------------------------------------------------------------- */
  const knowledgeAction = (action: string, opts: { id?: string; version?: number; reason?: string }, onDone?: (r: { ok?: boolean; error?: string }) => void) => {
    if (!paired) return;
    socketRef.current?.emit('knowledge:action', { action, ...opts }, (r: { ok?: boolean; error?: string }) => { onDone?.(r); });
  };

  const refreshKnowledge = () => {
    if (!paired) return;
    setKnowledgeRefreshing(true);
    knowledgeAction('refresh', {}, () => setKnowledgeRefreshing(false));
    // safety: stop the spinner if no reply in 30s
    setTimeout(() => setKnowledgeRefreshing(false), 30000);
  };

  const selectKnowledge = (id: string) => {
    setKnowledgeSelected((prev) => (prev === id ? null : id));
    setKnowledgeConfirm(null);
    setKnowledgeActionError(null);
    setKnowledgeOpenVersions(new Set());
    setVRunId(null);
    setVRun(null);
    setVError(null);
    if (knowledgeConfirmTimer.current) clearTimeout(knowledgeConfirmTimer.current);
  };

  const toggleKnowledgeVersion = (version: number) => {
    setKnowledgeOpenVersions((prev) => {
      const next = new Set(prev);
      if (next.has(version)) next.delete(version); else next.add(version);
      return next;
    });
  };

  /* Destructive actions ask for a second click within 4s ("confirm?") before firing. */
  const runKnowledgeAction = (action: string, opts: { id?: string; version?: number; reason?: string }, needsConfirm = false) => {
    if (needsConfirm) {
      if (knowledgeConfirm !== action) {
        setKnowledgeConfirm(action);
        if (knowledgeConfirmTimer.current) clearTimeout(knowledgeConfirmTimer.current);
        knowledgeConfirmTimer.current = setTimeout(() => setKnowledgeConfirm(null), 4000);
        return;
      }
      if (knowledgeConfirmTimer.current) clearTimeout(knowledgeConfirmTimer.current);
      setKnowledgeConfirm(null);
    }
    setKnowledgeActionError(null);
    knowledgeAction(action, opts, (r) => {
      if (r?.ok === false) setKnowledgeActionError(r?.error || `knowledge: ${action} failed`);
      // always re-sync so the panel matches the server-side store
      setKnowledgeRefreshing(true);
      knowledgeAction('refresh', {}, () => setKnowledgeRefreshing(false));
      setTimeout(() => setKnowledgeRefreshing(false), 30000);
    });
  };

  /* Verification — owner actions (start / cancel / feedback). Execution   */
  /* begins only when the owner reviews the plan and presses Start.        */
  const verificationAction = (action: string, opts: { runId?: string; decision?: string; comment?: string; confirmDangerous?: boolean }, onDone?: (r: { ok?: boolean; error?: string; detail?: VRunDetail }) => void) => {
    if (!paired) return;
    socketRef.current?.emit('verification:action', { action, ...opts }, (r: { ok?: boolean; error?: string; detail?: VRunDetail }) => { onDone?.(r); });
  };

  const selectVRun = (id: string) => {
    const next = vRunId === id ? null : id;
    setVRunId(next);
    setVRun(null);
    setVError(null);
    if (next) {
      setVBusy(true);
      verificationAction('get', { runId: next }, (r) => {
        setVBusy(false);
        if (r?.ok && r.detail) setVRun(r.detail);
        else if (r?.ok === false) setVError(r.error || 'could not load the run');
      });
    }
  };

  const runVAction = (kind: 'start' | 'cancel', runId: string, dangerous = false) => {
    if (kind === 'start' && dangerous && vConfirm !== `vstart:${runId}`) {
      setVConfirm(`vstart:${runId}`);
      if (vConfirmTimer.current) clearTimeout(vConfirmTimer.current);
      vConfirmTimer.current = setTimeout(() => setVConfirm(null), 5000);
      return;
    }
    if (vConfirmTimer.current) clearTimeout(vConfirmTimer.current);
    setVConfirm(null);
    setVError(null);
    setVBusy(true);
    verificationAction(kind, { runId, confirmDangerous: dangerous }, (r) => {
      setVBusy(false);
      if (r?.ok === false) setVError(r.error || `verification: ${kind} failed`);
    });
  };

  const sendVFeedback = (runId: string, decision: 'accept' | 'reject' | 'comment', comment: string) => {
    setVBusy(true);
    verificationAction('feedback', { runId, decision, comment }, (r) => {
      setVBusy(false);
      if (r?.ok === false) setVError(r.error || 'feedback failed');
    });
  };

  const wsOnline = !!status.workspaceOnline;

  /* ---------------------------------------------------------------- */
  /* Derived data                                                      */
  /* ---------------------------------------------------------------- */
  const stats = useMemo(() => {
    let reads = 0, writes = 0, edits = 0, deletes = 0, notes = 0, localEvents = 0;
    for (const e of entries) {
      if (e.kind === 'tool' && e.source !== 'system') {
        if (e.tool === 'read_file') reads++;
        else if (e.tool === 'write_file') writes++;
        else if (e.tool === 'edit_file') edits++;
        else if (e.tool === 'delete_file') deletes++;
      }
      if (e.kind === 'note') notes++;
      if (e.kind === 'fs') localEvents++;
    }
    return { reads, writes, edits, deletes, notes, localEvents };
  }, [entries]);

  const feed = useMemo(() => {
    const list = entries.filter((e) =>
      feedFilter === 'all' ? true
        : feedFilter === 'ai' ? (e.kind === 'tool' && e.source !== 'system') || e.kind === 'note' || e.kind === 'skill' || e.kind === 'knowledge'
          : feedFilter === 'you' ? e.source === 'local'
            : e.source === 'system' || (e.kind === 'conn'));
    return list.slice(0, 150);
  }, [entries, feedFilter]);

  /* flattened visible rows for the explorer */
  const rows = useMemo(() => {
    if (!tree?.tree?.children) return [] as { node: TreeNode; depth: number }[];
    const out: { node: TreeNode; depth: number }[] = [];
    const q = filter.trim().toLowerCase();

    if (q) {
      // flat search across the whole tree
      const hits: TreeNode[] = [];
      const walk = (n: TreeNode) => {
        for (const c of n.children ?? []) {
          if (c.type === 'file' && c.path.toLowerCase().includes(q)) hits.push(c);
          if (c.type === 'dir') walk(c);
        }
      };
      walk(tree.tree);
      return hits.slice(0, showAllFlat ? 1000 : 300).map((node) => ({ node, depth: 0 }));
    }

    const walk = (n: TreeNode, depth: number) => {
      for (const c of n.children ?? []) {
        out.push({ node: c, depth });
        if (c.type === 'dir' && expanded.has(c.path)) walk(c, depth + 1);
      }
    };
    walk(tree.tree, 0);
    return out.slice(0, 2500);
  }, [tree, expanded, filter, showAllFlat]);

  const totalFlatHits = useMemo(() => {
    if (!filter.trim() || !tree?.tree) return 0;
    let count = 0;
    const q = filter.trim().toLowerCase();
    const walk = (n: TreeNode) => {
      for (const c of n.children ?? []) {
        if (c.type === 'file' && c.path.toLowerCase().includes(q)) count++;
        if (c.type === 'dir') walk(c);
      }
    };
    walk(tree.tree);
    return count;
  }, [tree, filter]);

  /* knowledge derivations */
  const knowledgeCounts = knowledge?.counts;
  const knowledgeTotal = knowledgeCounts
    ? (knowledgeCounts.verified ?? 0) + (knowledgeCounts.candidate ?? 0) + (knowledgeCounts.verificationPending ?? 0)
      + (knowledgeCounts.rejected ?? 0) + (knowledgeCounts.deprecated ?? 0) + (knowledgeCounts.archived ?? 0)
    : 0;
  const knowledgeEmpty = !!knowledgeCounts
    && (knowledgeCounts.verified ?? 0) === 0 && (knowledgeCounts.candidate ?? 0) === 0 && (knowledgeCounts.verificationPending ?? 0) === 0
    && (knowledgeCounts.rejected ?? 0) === 0 && (knowledgeCounts.deprecated ?? 0) === 0 && (knowledgeCounts.archived ?? 0) === 0;

  const knowledgeCategories = useMemo(() => {
    const set = new Set<string>();
    for (const r of knowledge?.experiences ?? []) if (r.category) set.add(r.category);
    return Array.from(set).sort();
  }, [knowledge]);

  const knowledgeRecords = useMemo(() => {
    const q = knowledgeSearch.trim().toLowerCase();
    return (knowledge?.experiences ?? []).filter((r) => {
      if (knowledgeScope !== 'all' && r.scope !== knowledgeScope) return false;
      if (knowledgeStatusFilter !== 'all' && r.status !== knowledgeStatusFilter) return false;
      if (knowledgeCategory && r.category !== knowledgeCategory) return false;
      if (q && !`${r.id} ${r.title} ${r.problemSummary} ${r.category}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [knowledge, knowledgeSearch, knowledgeScope, knowledgeStatusFilter, knowledgeCategory]);

  const selectedKnowledge = useMemo(
    () => (knowledgeSelected ? (knowledge?.experiences ?? []).find((r) => r.id === knowledgeSelected) ?? null : null),
    [knowledge, knowledgeSelected]
  );

  const selectedKnowledgeVersions = useMemo(
    () => (selectedKnowledge?.versions ?? []).slice().sort((a, b) => b.version - a.version),
    [selectedKnowledge]
  );

  const activeKnowledgeVersion = useMemo(() => {
    if (!selectedKnowledge) return null;
    return (selectedKnowledge.versions ?? []).find((v) => v.version === selectedKnowledge.activeVersion)
      ?? selectedKnowledgeVersions[0]
      ?? null;
  }, [selectedKnowledge, selectedKnowledgeVersions]);

  const selectedKnowledgeFeedback = useMemo(
    () => (knowledge?.feedback ?? []).filter((f) => f.experienceId === selectedKnowledge?.id),
    [knowledge, selectedKnowledge]
  );

  const recordRuns = useMemo(
    () => (verification?.runs ?? []).filter((r) => r.knowledgeId === (selectedKnowledge?.id ?? '\u0000')),
    [verification, selectedKnowledge]
  );

  const toggleDir = (path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  /* ---------------------------------------------------------------- */
  /* Render                                                            */
  /* ---------------------------------------------------------------- */
  return (
    <div className="min-h-screen flex flex-col bg-vs-bg text-vs-text">
      {/* Header */}
      <header className="border-b border-vs-border bg-vs-panel-2 px-4 py-2.5 flex items-center gap-3 flex-wrap sticky top-0 z-20">
        <div className="flex items-center gap-2">
          <div className="size-8 rounded-md bg-vs-blue/15 border border-vs-blue/40 flex items-center justify-center">
            <Zap className="size-4 text-vs-blue-bright" />
          </div>
          <div>
            <h1 className="text-sm font-semibold leading-tight">Z.ai Workspace Bridge</h1>
            <p className="text-[11px] text-vs-dim leading-tight">
              Chat with GLM on z.ai · watch every action on your workspace here
            </p>
          </div>
        </div>
        <div className="flex-1" />
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="outline" className={svcUp ? 'border-vs-green/40 text-vs-green' : 'border-vs-border-2 text-vs-dim'}>
            {svcUp ? <Wifi className="size-3 mr-1" /> : <WifiOff className="size-3 mr-1" />}
            {svcUp ? 'server online' : 'server offline'}
          </Badge>
          <Badge variant="outline" className={wsOnline ? 'border-vs-blue-bright/40 text-vs-blue-bright' : 'border-vs-yellow/40 text-vs-yellow'}>
            <TerminalSquare className="size-3 mr-1" />
            {wsOnline ? status.workspaceName ?? 'workspace online' : 'workspace offline'}
          </Badge>
          {paired && (
            <Badge variant="outline" className="border-vs-green/40 text-vs-green">
              <Link2 className="size-3 mr-1" /> paired
            </Badge>
          )}
          {status.tree?.files ? (
            <Badge variant="outline" className="border-vs-border-2 text-vs-dim">
              <HardDrive className="size-3 mr-1" /> {status.tree.files.toLocaleString()} files
            </Badge>
          ) : null}
        </div>
      </header>

      {/* Body */}
      <div className="flex-1 p-4 max-w-[1500px] w-full mx-auto">
        {/* Pairing banner */}
        {!paired && (
          <Card className="mb-4 bg-vs-panel border-vs-border">
            <CardContent className="px-4 py-4 flex flex-col sm:flex-row sm:items-center gap-4">
              <div className="flex-1 min-w-0">
                <div className="text-xs font-semibold uppercase tracking-wide text-vs-text flex items-center gap-1.5">
                  <Link2 className="size-3.5" /> Pair this browser with your workspace
                </div>
                <p className="text-[11px] text-vs-dim mt-1.5 leading-relaxed">
                  In VS Code, open the <span className="text-vs-text">AI Code Agent</span> panel (zap icon) — the connector shows a
                  6-character pairing code. Enter it once to unlock the Workspace explorer and the live AI activity feed.
                </p>
                {pairingNote && <p className="text-[11px] text-vs-yellow mt-1.5">{pairingNote}</p>}
              </div>
              <div className="flex gap-2 flex-none">
                <Input
                  value={pairInput}
                  onChange={(e) => setPairInput(e.target.value.toUpperCase())}
                  onKeyDown={(e) => e.key === 'Enter' && pair(pairInput)}
                  placeholder="6-char code"
                  maxLength={12}
                  className="font-mono tracking-widest w-40"
                />
                <Button onClick={() => pair(pairInput)} size="sm" className="font-semibold">Pair</Button>
                <Button onClick={pasteAndPair} size="sm" variant="outline" className="border-vs-border-2" title="Paste code from clipboard">
                  <ClipboardPaste className="size-3.5" />
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Reconnect kit — new machine setup, visible while the workspace is offline */}
        {!wsOnline && (
          <Card className="mb-4 bg-vs-panel border-vs-border">
            <CardContent className="px-4 py-4 space-y-3">
              <div className="flex items-center gap-2 flex-wrap">
                <div className="text-xs font-semibold uppercase tracking-wide text-vs-text flex items-center gap-1.5">
                  <Download className="size-3.5 text-vs-green" /> Reconnect kit — new machine setup
                </div>
                <Badge variant="outline" className="border-vs-yellow/40 text-vs-yellow text-[10px]">workspace offline</Badge>
              </div>
              <p className="text-[11px] text-vs-dim leading-relaxed">
                All copy-paste, no URL editing. This card disappears the moment your VS Code connects.
              </p>
              <div className="space-y-2.5">
                <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
                  <div className="text-[10px] uppercase tracking-wide text-vs-dim lg:w-44 flex-none">1 · download extension</div>
                  <a
                    href="/ai-code-agent-0.5.0.vsix"
                    download="ai-code-agent-0.5.0.vsix"
                    target="_blank"
                    rel="noopener"
                    className="inline-flex items-center gap-1.5 rounded-md border border-vs-green/40 text-vs-green px-2.5 py-1.5 text-[11px] font-mono hover:bg-vs-green/10 transition-colors flex-none"
                    title="Download the VSIX (58 KB)"
                  >
                    <Download className="size-3.5" /> ai-code-agent-0.5.0.vsix · 58 KB
                  </a>
                  <span className="text-[10px] text-vs-dim">if the preview swallows the click — open this page in a new tab first, then click</span>
                </div>
                <div className="flex flex-col gap-1.5 lg:flex-row lg:items-center">
                  <div className="text-[10px] uppercase tracking-wide text-vs-dim lg:w-44 flex-none">2 · install (terminal)</div>
                  <div className="flex-1 min-w-0">
                    <CopyField value="cd ~/Downloads && code --install-extension ai-code-agent-0.5.0.vsix" />
                  </div>
                </div>
                <div className="flex flex-col gap-1.5 lg:flex-row lg:items-center">
                  <div className="text-[10px] uppercase tracking-wide text-vs-dim lg:w-44 flex-none">3 · server url → settings</div>
                  <div className="flex-1 min-w-0">
                    <CopyField value={pageUrl || '…'} />
                  </div>
                </div>
                <div className="flex flex-col gap-1.5 lg:flex-row lg:items-start">
                  <div className="text-[10px] uppercase tracking-wide text-vs-dim lg:w-44 flex-none">4 · identity (optional)</div>
                  <div className="text-[11px] text-vs-dim leading-relaxed flex-1 min-w-0">
                    Only when migrating from a previous bridge install: copy the workspace id + secret from the old setup into{" "}
                    <span className="font-mono text-vs-text">AI Code Agent: Set Workspace Identity…</span>. Skipping this pairs fresh —
                    the dashboard journal starts empty, which is the clean default.
                  </div>
                </div>
                <div className="flex flex-col gap-1.5 lg:flex-row lg:items-start">
                  <div className="text-[10px] uppercase tracking-wide text-vs-dim lg:w-44 flex-none">5 · connect + pair</div>
                  <div className="text-[11px] text-vs-dim leading-relaxed flex-1 min-w-0">
                    Command palette → <span className="font-mono text-vs-text">AI Code Agent: Set Workspace Identity…</span> with the two
                    values from step 4, then <span className="font-mono text-vs-text">AI Code Agent: Connect</span>. Its panel shows a
                    6-char pairing code — type it into the pair box at the top of this page and the feed unlocks.
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Stats row */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3 mb-4">
          <StatChip icon={<HardDrive className="size-3.5" />} label="files" value={tree?.stats ? tree.stats.files.toLocaleString() : '—'} sub={tree?.stats ? fmtBytes(tree.stats.totalBytes) : undefined} />
          <StatChip icon={<Folder className="size-3.5" />} label="folders" value={tree?.stats ? tree.stats.dirs.toLocaleString() : '—'} />
          <StatChip icon={<Eye className="size-3.5" />} label="AI reads" value={String(stats.reads)} accent="text-vs-var" />
          <StatChip icon={<PencilLine className="size-3.5" />} label="AI writes" value={String(stats.writes)} accent="text-vs-green" />
          <StatChip icon={<Pencil className="size-3.5" />} label="AI edits" value={String(stats.edits)} accent="text-vs-tan" />
          <StatChip icon={<Trash2 className="size-3.5" />} label="AI deletes" value={String(stats.deletes)} accent="text-vs-red" />
          <StatChip icon={<GraduationCap className="size-3.5" />} label="skills" value={String(skills.length)} sub={skills.length ? 'in .skills/' : undefined} accent="text-vs-purple" />
        </div>

        {/* Knowledge — the shared, verification-gated experience library */}
        <Card className="mb-4 bg-vs-panel border-vs-border" data-testid="knowledge-card">
          <CardHeader className="pb-2 pt-4 px-4 flex-row items-center gap-2 flex-wrap">
            <CardTitle className="text-xs font-semibold uppercase tracking-wide text-vs-text flex items-center gap-1.5">
              <Brain className="size-3.5 text-vs-teal" /> Knowledge
            </CardTitle>
            {!knowledge ? (
              <span className="text-[9.5px] text-vs-faint font-mono" data-testid="knowledge-syncing">syncing knowledge…</span>
            ) : (
              <>
                <Badge variant="outline" className="border-vs-border-2 text-vs-dim font-mono text-[10px]" data-testid="knowledge-total-badge">
                  {knowledgeTotal} records
                </Badge>
                <Badge variant="outline" className="border-vs-green/40 text-vs-green text-[10px]" data-testid="knowledge-count-verified">
                  {knowledgeCounts?.verified ?? 0} verified
                </Badge>
                <Badge variant="outline" className="border-vs-yellow/40 text-vs-yellow text-[10px]" data-testid="knowledge-count-candidate">
                  {knowledgeCounts?.candidate ?? 0} candidate
                </Badge>
                <Badge variant="outline" className="border-vs-blue/40 text-vs-blue text-[10px]" data-testid="knowledge-count-pending">
                  {knowledgeCounts?.verificationPending ?? 0} verifying
                </Badge>
                <Badge variant="outline" className="border-vs-red/40 text-vs-red text-[10px]" data-testid="knowledge-count-rejected">
                  {knowledgeCounts?.rejected ?? 0} rejected
                </Badge>
                <Badge variant="outline" className="border-vs-red/40 text-vs-red text-[10px]" data-testid="knowledge-count-attempts">
                  {knowledgeCounts?.attempts ?? 0} failed attempts
                </Badge>
                {(verification?.counts?.total ?? 0) > 0 && (
                  <Badge variant="outline" className="border-vs-teal/40 text-vs-teal text-[10px]" data-testid="knowledge-count-verruns">
                    <FlaskConical className="size-3 mr-1" />
                    {verification?.counts?.total ?? 0} verif. runs
                  </Badge>
                )}
              </>
            )}
            <div className="flex-1" />
            {knowledge?.syncedAt ? (
              <span className="text-[9.5px] text-vs-faint font-mono" data-testid="knowledge-synced-at" title={new Date(knowledge.syncedAt).toLocaleString()}>
                synced {timeStr(knowledge.syncedAt)}
              </span>
            ) : null}
            <button
              suppressHydrationWarning
              className="text-[10px] text-vs-dim hover:text-vs-text flex items-center gap-1 disabled:opacity-50"
              onClick={refreshKnowledge}
              disabled={!paired || knowledgeRefreshing}
              title="Re-sync the knowledge store from the workspace"
              data-testid="knowledge-refresh"
            >
              {knowledgeRefreshing ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />}
              re-sync
            </button>
          </CardHeader>
          <CardContent className="px-4 pb-4 pt-1">
            {!paired ? (
              <LockedPanel text="Pair this browser to manage the shared knowledge library." />
            ) : !knowledge ? (
              <div className="py-10 text-center text-vs-dim text-[11px] flex flex-col items-center gap-2" data-testid="knowledge-loading">
                <Loader2 className="size-5 animate-spin" /> syncing knowledge…
              </div>
            ) : (
              <div className="space-y-3">
                {knowledge.note && (
                  <p className="text-[10.5px] text-vs-yellow flex items-center gap-1.5" data-testid="knowledge-note">
                    <AlertTriangle className="size-3 flex-none" /> {knowledge.note}
                  </p>
                )}

                {knowledgeEmpty && (
                  <p className="text-[11px] text-vs-dim leading-relaxed" data-testid="knowledge-explainer">
                    Shared engineering knowledge — every record starts as a candidate and only becomes verified through
                    the bridge&apos;s verification gate (checks with real exit codes) or owner approval. The store lives
                    in <span className="font-mono text-vs-text">knowledge/</span> in your workspace, portable with the repo.
                  </p>
                )}

                {/* filters — search + scope + status (+ category when the library has more than one) */}
                <div className="flex items-center gap-2 flex-wrap" data-testid="knowledge-filters">
                  <div className="relative">
                    <Search className="size-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-vs-dim" />
                    <Input
                      value={knowledgeSearch}
                      onChange={(e) => setKnowledgeSearch(e.target.value)}
                      placeholder="search knowledge…"
                      className="h-8 text-xs pl-7 w-40 sm:w-64"
                      data-testid="knowledge-search"
                    />
                  </div>
                  <div className="flex items-center flex-wrap">
                    {(['all', 'global', 'project'] as const).map((s) => (
                      <FeedChip
                        key={s}
                        active={knowledgeScope === s}
                        onClick={() => setKnowledgeScope(s)}
                        testId={`knowledge-filter-scope-${s}`}
                      >
                        {s === 'all' ? 'All' : s === 'global' ? 'Global' : 'Project'}
                      </FeedChip>
                    ))}
                  </div>
                  <div className="flex items-center flex-wrap">
                    {([
                      ['all', 'All'],
                      ['verified', 'Verified'],
                      ['candidate', 'Candidate'],
                      ['verification_pending', 'Verifying'],
                      ['rejected', 'Rejected'],
                      ['deprecated', 'Deprecated'],
                      ['archived', 'Archived'],
                    ] as [KnowledgeStatusFilter, string][]).map(([val, label]) => (
                      <FeedChip
                        key={val}
                        active={knowledgeStatusFilter === val}
                        onClick={() => setKnowledgeStatusFilter(val)}
                        testId={`knowledge-filter-status-${val}`}
                      >
                        {label}
                      </FeedChip>
                    ))}
                  </div>
                  {knowledgeCategories.length > 1 && (
                    <div className="flex items-center flex-wrap">
                      {knowledgeCategories.map((cat) => (
                        <FeedChip
                          key={cat}
                          active={knowledgeCategory === cat}
                          onClick={() => setKnowledgeCategory(knowledgeCategory === cat ? '' : cat)}
                          testId={`knowledge-filter-category-${cat}`}
                        >
                          {cat}
                        </FeedChip>
                      ))}
                    </div>
                  )}
                </div>

                {/* library — one row per experience record */}
                <div className="max-h-72 overflow-y-auto space-y-1" data-testid="knowledge-list">
                  {knowledgeRecords.length === 0 ? (
                    <p className="text-center text-vs-dim text-[10.5px] py-6" data-testid="knowledge-empty">
                      {knowledgeSearch || knowledgeScope !== 'all' || knowledgeStatusFilter !== 'all' || knowledgeCategory
                        ? 'no records match the current filters.'
                        : 'no knowledge records yet — GLM submits one every time it fixes something non-trivial in your workspace.'}
                    </p>
                  ) : (
                    knowledgeRecords.map((r) => {
                      const st = knowledgeStatusMeta(r.status);
                      const active = knowledgeSelected === r.id;
                      return (
                        <button
                          key={r.id}
                          suppressHydrationWarning
                          onClick={() => selectKnowledge(r.id)}
                          className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md border text-left ${
                            active ? 'bg-vs-active border-vs-blue/40' : 'bg-vs-bg/50 border-vs-border hover:bg-vs-hover'
                          }`}
                          data-testid="knowledge-row"
                          data-knowledge-id={r.id}
                          data-knowledge-status={r.status}
                        >
                          <span className={`size-1.5 rounded-full bg-current flex-none ${st.color}`} title={st.label} />
                          <span className="font-mono text-[10px] text-vs-blue-bright flex-none truncate max-w-[7rem]" title={r.id}>{r.id}</span>
                          <span className="text-[11px] truncate min-w-0 flex-1" title={r.title}>{r.title}</span>
                          <Badge
                            variant="outline"
                            className={`flex-none text-[8.5px] px-1.5 ${r.scope === 'global' ? 'border-vs-blue/40 text-vs-blue' : 'border-vs-purple/40 text-vs-purple'}`}
                            title={r.scope === 'project' && r.projectId ? r.projectId : `scope: ${r.scope}`}
                          >
                            {r.scope}
                          </Badge>
                          <span className="text-[9.5px] text-vs-faint flex-none hidden lg:inline" title={`category: ${r.category}`}>{r.category}</span>
                          <span className="font-mono text-[9.5px] text-vs-faint flex-none hidden md:inline" title={`${r.versions?.length ?? 0} versions`}>v{r.activeVersion} · {r.versions?.length ?? 0}v</span>
                          <span className="font-mono text-[9.5px] flex-none hidden sm:inline" title={`reuse: ${r.reuseStats?.worked ?? 0} worked · ${r.reuseStats?.failed ?? 0} failed`}>
                            <span className="text-vs-green">{r.reuseStats?.worked ?? 0}✓</span>{' '}<span className="text-vs-red">{r.reuseStats?.failed ?? 0}✗</span>
                          </span>
                          <span className="font-mono text-[9.5px] text-vs-faint flex-none hidden xl:inline" title={r.updatedAt}>{shortWhen(r.updatedAt)}</span>
                        </button>
                      );
                    })
                  )}
                </div>

                {/* detail panel — inline, like the skill viewer */}
                {selectedKnowledge && (() => {
                  const r = selectedKnowledge;
                  const st = knowledgeStatusMeta(r.status);
                  const av = activeKnowledgeVersion;
                  return (
                    <div className="rounded-md border border-vs-border overflow-hidden" data-testid="knowledge-detail">
                      <div className="flex items-center gap-2 px-2.5 py-1.5 bg-vs-panel-2">
                        <Brain className="size-3.5 text-vs-teal flex-none" />
                        <span className="font-mono text-[10.5px] text-vs-blue-bright flex-none truncate max-w-[8rem]" title={r.id}>{r.id}</span>
                        <span className="text-[10.5px] text-vs-bright truncate min-w-0 flex-1" title={r.title}>{r.title}</span>
                        <span className={`text-[9px] uppercase tracking-wide flex-none ${st.color}`}>{st.label}</span>
                        <button suppressHydrationWarning className="text-vs-dim hover:text-vs-text flex-none" onClick={() => setKnowledgeSelected(null)} title="Close" data-testid="knowledge-detail-close">
                          <X className="size-3.5" />
                        </button>
                      </div>

                      <div className="p-3 space-y-3">
                        {r.problemSummary && (
                          <p className="text-[10.5px] text-vs-dim leading-relaxed" title={r.problemSummary}>{r.problemSummary}</p>
                        )}

                        {/* meta */}
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-3 gap-y-1" data-testid="knowledge-meta">
                          <KnowledgeMetaItem label="status"><span className={st.color}>{st.label}</span></KnowledgeMetaItem>
                          <KnowledgeMetaItem label="scope" title={r.projectId ?? undefined}>{r.scope}</KnowledgeMetaItem>
                          <KnowledgeMetaItem label="category">{r.category}</KnowledgeMetaItem>
                          <KnowledgeMetaItem label="created" title={r.createdAt}>{shortWhen(r.createdAt)}</KnowledgeMetaItem>
                          <KnowledgeMetaItem label="updated" title={r.updatedAt}>{shortWhen(r.updatedAt)}</KnowledgeMetaItem>
                          <KnowledgeMetaItem label="created by" title={r.createdBy}>{shortActor(r.createdBy)}</KnowledgeMetaItem>
                        </div>

                        {/* active version content */}
                        {av ? (
                          <div className="space-y-2" data-testid="knowledge-active-version">
                            <div className="flex items-center gap-1.5">
                              <span className="text-[9.5px] uppercase tracking-wide text-vs-dim">active version</span>
                              <Badge variant="outline" className="border-vs-blue/40 text-vs-blue text-[9px] font-mono px-1.5">v{av.version}</Badge>
                            </div>
                            <KnowledgeVersionView v={av} />
                          </div>
                        ) : (
                          <p className="text-[10.5px] text-vs-faint">no versions recorded</p>
                        )}

                        {/* all versions — collapsed by default */}
                        {(r.versions?.length ?? 0) > 0 && (
                          <div>
                            <button
                              suppressHydrationWarning
                              className="text-[10px] uppercase tracking-wide text-vs-dim hover:text-vs-text flex items-center gap-1"
                              onClick={() => setKnowledgeVersionsOpen((o) => !o)}
                              aria-expanded={knowledgeVersionsOpen}
                              data-testid="knowledge-versions-toggle"
                            >
                              {knowledgeVersionsOpen ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
                              all versions · {r.versions.length}
                            </button>
                            {knowledgeVersionsOpen && (
                              <div className="mt-1.5 space-y-1.5">
                                {selectedKnowledgeVersions.map((vv) => {
                                  const vf = knowledgeVerifMeta(vv.verificationStatus);
                                  const vOpen = knowledgeOpenVersions.has(vv.version);
                                  return (
                                    <div key={vv.version} className="rounded-md border border-vs-border overflow-hidden">
                                      <button
                                        suppressHydrationWarning
                                        className="w-full flex items-center gap-2 px-2.5 py-1.5 bg-vs-panel-2/50 hover:bg-vs-hover text-left"
                                        onClick={() => toggleKnowledgeVersion(vv.version)}
                                        aria-expanded={vOpen}
                                        data-testid="knowledge-version-header"
                                        data-version={vv.version}
                                      >
                                        {vOpen ? <ChevronDown className="size-3 text-vs-faint flex-none" /> : <ChevronRight className="size-3 text-vs-faint flex-none" />}
                                        <span className="font-mono text-[10px] text-vs-bright flex-none">v{vv.version}</span>
                                        <span className={`text-[9.5px] flex-none ${vf.cls}`}>{vf.label}</span>
                                        <span className="text-[9px] text-vs-faint truncate min-w-0 flex-1" title={vv.createdBy}>{shortActor(vv.createdBy)}</span>
                                        {vv.supersedes !== undefined && <span className="text-[9px] text-vs-faint flex-none hidden sm:inline">supersedes v{vv.supersedes}</span>}
                                        <span className="font-mono text-[9px] text-vs-faint flex-none hidden md:inline">{shortWhen(vv.createdAt)}</span>
                                      </button>
                                      {vOpen && (
                                        <div className="p-2.5 bg-vs-bg/60">
                                          <KnowledgeVersionView v={vv} />
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        )}

                        {/* scientific verification — evidence-driven runs (GLM designs, the bridge executes & decides) */}
                        <VerificationSection
                          runs={recordRuns}
                          selectedId={vRunId}
                          onSelect={selectVRun}
                        />
                        {vRun && vRun.run?.knowledgeId === selectedKnowledge?.id && (
                          <VerificationRunPanel
                            detail={vRun}
                            busy={vBusy}
                            error={vError}
                            confirm={vConfirm}
                            onStart={(runId, dangerous) => runVAction('start', runId, dangerous)}
                            onCancel={(runId) => runVAction('cancel', runId)}
                            onFeedback={sendVFeedback}
                            onOpenFile={readFile}
                          />
                        )}

                        {/* reuse feedback */}
                        <div data-testid="knowledge-feedback">
                          <div className="text-[9.5px] uppercase tracking-wide text-vs-dim mb-1">reuse feedback · {selectedKnowledgeFeedback.length}</div>
                          {selectedKnowledgeFeedback.length === 0 ? (
                            <p className="text-[10px] text-vs-faint">no reuse feedback yet</p>
                          ) : (
                            <div className="space-y-1 max-h-36 overflow-y-auto">
                              {selectedKnowledgeFeedback.map((f) => {
                                const om = f.outcome === 'worked'
                                  ? { c: 'text-vs-green', g: '✓' }
                                  : f.outcome === 'failed'
                                    ? { c: 'text-vs-red', g: '✗' }
                                    : { c: 'text-vs-yellow', g: '⚠' };
                                return (
                                  <div key={f.id} className="flex items-start gap-1.5 min-w-0" data-testid="knowledge-feedback-row">
                                    <span className={`font-mono text-[10px] flex-none ${om.c}`}>{om.g}</span>
                                    <span className="text-[10px] text-vs-dim truncate min-w-0 flex-1" title={f.notes}>{f.notes}</span>
                                    <span className="font-mono text-[9px] text-vs-faint flex-none whitespace-nowrap">v{f.experienceVersion} · {shortWhen(f.createdAt)}</span>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>

                        {/* honest ack error from the last action */}
                        {knowledgeActionError && (
                          <p className="text-vs-red text-[10.5px] text-right break-words" data-testid="knowledge-action-error">{knowledgeActionError}</p>
                        )}

                        {/* actions — destructive ones need a confirming second click */}
                        <div className="flex items-center justify-end gap-2 flex-wrap pt-1 border-t border-vs-border/60" data-testid="knowledge-actions">
                          {(r.status === 'candidate' || r.status === 'verification_pending') && (
                            <Button
                              size="sm"
                              className="h-7 gap-1"
                              onClick={() => runKnowledgeAction('approve', { id: r.id, version: r.activeVersion })}
                              title="Promote to verified (owner approval)"
                              data-testid="knowledge-approve"
                            >
                              <CheckCircle2 className="size-3.5" /> Approve
                            </Button>
                          )}
                          {r.status !== 'rejected' && (
                            <Button
                              size="sm"
                              variant="outline"
                              className={`h-7 gap-1 border-vs-border-2 ${knowledgeConfirm === 'reject' ? 'border-vs-yellow/60 text-vs-yellow' : 'text-vs-dim'}`}
                              onClick={() => runKnowledgeAction('reject', { id: r.id }, true)}
                              data-testid="knowledge-reject"
                              title="Reject this record"
                            >
                              {knowledgeConfirm === 'reject' ? 'confirm?' : <><XCircle className="size-3.5" /> Reject</>}
                            </Button>
                          )}
                          {r.status === 'verified' && (
                            <Button
                              size="sm"
                              variant="outline"
                              className={`h-7 gap-1 border-vs-border-2 ${knowledgeConfirm === 'deprecate' ? 'border-vs-yellow/60 text-vs-yellow' : 'text-vs-dim'}`}
                              onClick={() => runKnowledgeAction('deprecate', { id: r.id }, true)}
                              data-testid="knowledge-deprecate"
                              title="Mark as superseded/outdated"
                            >
                              {knowledgeConfirm === 'deprecate' ? 'confirm?' : <><History className="size-3.5" /> Deprecate</>}
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="outline"
                            className={`h-7 gap-1 border-vs-border-2 ${knowledgeConfirm === 'archive' ? 'border-vs-yellow/60 text-vs-yellow' : 'text-vs-dim'}`}
                            onClick={() => runKnowledgeAction('archive', { id: r.id }, true)}
                            data-testid="knowledge-archive"
                            title="Archive this record"
                          >
                            {knowledgeConfirm === 'archive' ? 'confirm?' : <><Archive className="size-3.5" /> Archive</>}
                          </Button>
                          {(r.status === 'deprecated' || r.status === 'archived' || r.status === 'rejected') && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 gap-1 border-vs-border-2 text-vs-dim"
                              onClick={() => runKnowledgeAction('restore', { id: r.id })}
                              data-testid="knowledge-restore"
                              title="Restore to candidate"
                            >
                              <Undo2 className="size-3.5" /> Restore
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="outline"
                            className={`h-7 gap-1 ${knowledgeConfirm === 'delete' ? 'border-vs-red text-vs-red' : 'border-vs-red/40 text-vs-red'}`}
                            onClick={() => runKnowledgeAction('delete', { id: r.id }, true)}
                            data-testid="knowledge-delete"
                            title="Soft-delete this record"
                          >
                            {knowledgeConfirm === 'delete' ? 'confirm?' : <><Trash2 className="size-3.5" /> Delete</>}
                          </Button>
                        </div>
                      </div>
                    </div>
                  );
                })()}

                {/* failed attempts — collapsed by default */}
                <div data-testid="knowledge-attempts-section">
                  <button
                    suppressHydrationWarning
                    className="text-[10px] uppercase tracking-wide text-vs-dim hover:text-vs-text flex items-center gap-1.5"
                    onClick={() => setKnowledgeAttemptsOpen((o) => !o)}
                    aria-expanded={knowledgeAttemptsOpen}
                    data-testid="knowledge-attempts-toggle"
                  >
                    {knowledgeAttemptsOpen ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
                    failed attempts
                    <Badge variant="outline" className="border-vs-border-2 text-vs-dim text-[9px] font-mono" data-testid="knowledge-attempts-count">
                      {knowledgeCounts?.attempts ?? 0}
                    </Badge>
                  </button>
                  {knowledgeAttemptsOpen && (
                    (knowledge.attempts ?? []).length === 0 ? (
                      <p className="text-[10.5px] text-vs-faint pl-4 pt-1.5" data-testid="knowledge-attempts-empty">no failed attempts recorded</p>
                    ) : (
                      <div className="mt-1.5 max-h-48 overflow-y-auto rounded-md border border-vs-border" data-testid="knowledge-attempts-list">
                        {(knowledge.attempts ?? []).map((a) => (
                          <div key={a.id} className="flex items-center gap-2 px-2.5 py-1.5 border-b border-vs-border/60 last:border-b-0 hover:bg-vs-hover/50" data-testid="knowledge-attempt-row">
                            <span className="flex-none" title={a.result}><XCircle className="size-3 text-vs-red" /></span>
                            <span className="font-mono text-[9.5px] text-vs-blue-bright flex-none truncate max-w-[7rem]" title={a.id}>{a.id}</span>
                            <span className="text-[10px] truncate min-w-0 flex-1" title={a.problemSummary}>{a.problemSummary}</span>
                            <span className="text-[9.5px] text-vs-dim truncate max-w-[14rem] hidden md:inline" title={a.failureReason}>{a.failureReason}</span>
                            <span className="font-mono text-[9px] text-vs-faint flex-none hidden sm:inline">{shortWhen(a.createdAt)}</span>
                          </div>
                        ))}
                      </div>
                    )
                  )}
                </div>

                {/* audit log — collapsed by default */}
                <div data-testid="knowledge-audit-section">
                  <button
                    suppressHydrationWarning
                    className="text-[10px] uppercase tracking-wide text-vs-dim hover:text-vs-text flex items-center gap-1.5"
                    onClick={() => setKnowledgeAuditOpen((o) => !o)}
                    aria-expanded={knowledgeAuditOpen}
                    data-testid="knowledge-audit-toggle"
                  >
                    {knowledgeAuditOpen ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
                    audit log
                    <Badge variant="outline" className="border-vs-border-2 text-vs-dim text-[9px] font-mono" data-testid="knowledge-audit-count">
                      {knowledgeCounts?.audit ?? 0}
                    </Badge>
                  </button>
                  {knowledgeAuditOpen && (
                    (knowledge.audit ?? []).length === 0 ? (
                      <p className="text-[10.5px] text-vs-faint pl-4 pt-1.5" data-testid="knowledge-audit-empty">no audit events yet</p>
                    ) : (
                      <div className="mt-1.5 max-h-48 overflow-y-auto rounded-md border border-vs-border" data-testid="knowledge-audit-list">
                        {(knowledge.audit ?? []).map((a) => (
                          <div key={a.id} className="flex items-center gap-2 px-2.5 py-1 border-b border-vs-border/60 last:border-b-0 hover:bg-vs-hover/50" data-testid="knowledge-audit-row">
                            <span className="font-mono text-[9px] text-vs-faint flex-none" title={new Date(a.ts).toLocaleString()}>{shortWhen(a.ts)}</span>
                            <span className="text-[9px] text-vs-dim flex-none hidden sm:inline">{shortActor(a.actor)}</span>
                            <span className="font-mono text-[9.5px] text-vs-teal flex-none">{a.operation}</span>
                            <span className="font-mono text-[9.5px] text-vs-blue-bright flex-none truncate max-w-[7rem]" title={a.entityId}>{a.entityId}</span>
                            <span className="font-mono text-[9.5px] text-vs-dim flex-none whitespace-nowrap">
                              {a.oldVersion === null && a.newVersion === null
                                ? '—'
                                : `${a.oldVersion !== null ? `v${a.oldVersion}` : ''}→${a.newVersion !== null ? `v${a.newVersion}` : ''}`}
                            </span>
                            <span className="text-[9.5px] text-vs-dim truncate min-w-0 flex-1" title={a.reason}>{a.reason}</span>
                          </div>
                        ))}
                      </div>
                    )
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Main grid */}
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
          {/* LEFT — Workspace */}
          <div className="xl:col-span-7 space-y-4 min-w-0">
            <Card className="bg-vs-panel border-vs-border flex flex-col">
              <CardHeader className="pb-2 pt-4 px-4 flex-row items-center gap-2 flex-wrap">
                <CardTitle className="text-xs font-semibold uppercase tracking-wide text-vs-text flex items-center gap-1.5">
                  <FolderTreeIcon /> Workspace
                </CardTitle>
                <Badge variant="outline" className="border-vs-border-2 text-vs-dim font-mono text-[10px]">
                  {tree?.name ?? status.workspaceName ?? '—'}
                </Badge>
                {tree?.stats?.truncated && (
                  <Badge variant="outline" className="border-vs-yellow/40 text-vs-yellow text-[10px]">truncated view</Badge>
                )}
                <div className="flex-1" />
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <Search className="size-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-vs-dim" />
                    <Input
                      value={filter}
                      onChange={(e) => setFilter(e.target.value)}
                      placeholder="filter files…"
                      className="h-8 text-xs pl-7 w-40 sm:w-52"
                    />
                  </div>
                  <Button onClick={refreshTree} disabled={!paired || treeLoading} variant="outline" size="sm" className="border-vs-border-2 h-8" title="Rescan workspace">
                    {treeLoading ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="px-2 pb-4 pt-1">
                {!paired ? (
                  <LockedPanel text="Pair this browser to explore every file in your VS Code workspace." />
                ) : !wsOnline ? (
                  <LockedPanel text="Workspace offline — open VS Code with the AI Code Agent extension connected." icon={<WifiOff className="size-8" />} />
                ) : !tree?.tree ? (
                  <div className="text-center py-14 text-vs-dim text-xs">
                    {treeLoading ? <Loader2 className="size-6 animate-spin mx-auto mb-3" /> : <FolderTreeIcon />}
                    <p className="max-w-sm mx-auto leading-relaxed">
                      {treeLoading
                        ? 'Scanning the workspace…'
                        : 'No workspace scan yet. Press the refresh button, or make sure the AI Code Agent extension v0.4.0+ is installed in VS Code.'}
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="max-h-[420px] overflow-y-auto text-xs font-mono" data-testid="file-explorer">
                      {rows.length === 0 && (
                        <p className="text-center text-vs-dim py-8">
                          {filter ? `No files match “${filter}”.` : 'Empty workspace.'}
                        </p>
                      )}
                      {rows.map(({ node, depth }) => (
                        <FileRow
                          key={node.path}
                          node={node}
                          depth={depth}
                          expanded={node.type === 'dir' && expanded.has(node.path)}
                          onToggle={() => toggleDir(node.path)}
                          onOpen={() => readFile(node.path)}
                          active={fileView?.path === node.path}
                          highlight={!!filter.trim()}
                        />
                      ))}
                      {filter && totalFlatHits > 300 && !showAllFlat && (
                        <button suppressHydrationWarning className="w-full text-center py-2 text-[11px] text-vs-blue-bright hover:underline" onClick={() => setShowAllFlat(true)}>
                          show {Math.min(totalFlatHits, 1000) - 300} more of {totalFlatHits} matches…
                        </button>
                      )}
                    </div>
                    <Separator className="bg-vs-border my-2" />
                    <div className="flex items-center gap-3 text-[10.5px] text-vs-dim flex-wrap">
                      <span>{tree.stats?.files?.toLocaleString()} files · {tree.stats?.dirs?.toLocaleString()} folders</span>
                      {tree.stats?.totalBytes ? <span>· {fmtBytes(tree.stats.totalBytes)} of source</span> : null}
                      {tree.stats?.scannedAt ? <span>· scanned {new Date(tree.stats.scannedAt).toLocaleTimeString()}</span> : null}
                      <span className="flex-1" />
                      <button suppressHydrationWarning className="flex items-center gap-1 hover:text-vs-text" onClick={() => setExpanded(new Set(['']))}>
                        collapse all
                      </button>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            {/* File viewer */}
            {fileView && (
              <Card className="bg-vs-panel border-vs-border">
                <CardHeader className="pb-2 pt-4 px-4 flex-row items-center gap-2">
                  <FileCode className="size-3.5 text-vs-dim" />
                  <CardTitle className="text-xs font-mono text-vs-bright truncate flex-1 min-w-0" title={fileView.path}>
                    {fileView.path}
                  </CardTitle>
                  {fileView.meta?.bytes !== undefined && (
                    <Badge variant="outline" className="border-vs-border-2 text-vs-dim text-[10px] font-mono">
                      {fmtBytes(fileView.meta.bytes)}{fileView.meta?.lines ? ` · ${fileView.meta.lines} lines` : ''}
                    </Badge>
                  )}
                  <Button
                    variant="ghost" size="sm" className="h-6 px-2 text-vs-dim"
                    onClick={() => navigator.clipboard.writeText(fileView.content ?? '').catch(() => undefined)}
                    title="Copy content"
                  >
                    <Copy className="size-3.5" />
                  </Button>
                  <Button variant="ghost" size="sm" className="h-6 px-2 text-vs-dim" onClick={() => setFileView(null)} title="Close">
                    <X className="size-3.5" />
                  </Button>
                </CardHeader>
                <CardContent className="px-4 pb-4 pt-0">
                  {fileView.loading ? (
                    <div className="py-10 text-center text-vs-dim text-xs flex flex-col items-center gap-2">
                      <Loader2 className="size-5 animate-spin" /> reading {fileView.path}…
                    </div>
                  ) : fileView.error ? (
                    <div className="py-6 text-center text-vs-red text-xs">{fileView.error}</div>
                  ) : (
                    <pre className="text-[10.5px] font-mono text-vs-text whitespace-pre-wrap break-all bg-vs-bg border border-vs-border rounded-md p-3 max-h-[460px] overflow-auto" data-testid="file-content">
                      {(fileView.content ?? '').slice(0, 300000) || '(empty file)'}
                    </pre>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Connect guide */}
            <Card className="bg-vs-panel border-vs-border">
              <CardContent className="px-4 py-4">
                <div className="text-[10px] uppercase tracking-wide text-vs-dim mb-2 flex items-center gap-1.5">
                  <User className="size-3" /> how this works
                </div>
                <ol className="text-[11px] text-vs-dim space-y-1.5 list-decimal list-inside leading-relaxed">
                  <li>Install the <span className="text-vs-bright">AI Code Agent</span> extension (v0.5.0+) in VS Code — the VSIX lives on this dashboard: <a href="/ai-code-agent-0.5.0.vsix" className="font-mono text-vs-blue-bright underline">/ai-code-agent-0.5.0.vsix</a>.</li>
                  <li>Settings → <span className="font-mono text-vs-text">aiCodeAgent.serverUrl</span> → paste this page&apos;s URL, then Command palette → <span className="font-mono text-vs-text">AI Code Agent: Connect</span> (migrating machines? <span className="font-mono text-vs-text">AI Code Agent: Set Workspace Identity…</span> first).</li>
                  <li>Enter the pairing code from the extension panel above — once.</li>
                  <li>Chat with GLM at <span className="text-vs-blue-bright">z.ai</span> and ask it to work on your code.</li>
                  <li>Every read, write, edit, delete and command appears in the feed → with diffs you can read.</li>
                  <li>Drop skill documents into a <span className="font-mono text-vs-purple">.skills/</span> folder in your workspace — GLM finds them, reads them and follows them <span className="text-vs-text">before</span> starting a task. Say <span className="font-mono text-vs-text">{'“use the skill <name>”'}</span> in your z.ai chat to apply one.</li>
                </ol>
              </CardContent>
            </Card>
          </div>

          {/* RIGHT — Skills + AI Activity */}
          <div className="xl:col-span-5 space-y-4 min-w-0">
            {/* Skills — teach the AI before it starts thinking */}
            <Card className="bg-vs-panel border-vs-border" data-testid="skills-card">
              <CardHeader className="pb-2 pt-4 px-4 flex-row items-center gap-2 flex-wrap">
                <CardTitle className="text-xs font-semibold uppercase tracking-wide text-vs-text flex items-center gap-1.5">
                  <GraduationCap className="size-3.5 text-vs-purple" /> Skills
                </CardTitle>
                <Badge variant="outline" className="border-vs-border-2 text-vs-dim font-mono text-[10px]">
                  {skills.length} in .skills/
                </Badge>
                <div className="flex-1" />
                <button
                  suppressHydrationWarning
                  className="text-[10px] text-vs-dim hover:text-vs-text flex items-center gap-1 disabled:opacity-50"
                  onClick={refreshSkills}
                  disabled={!paired || skillsRefreshing}
                  title="Re-check the workspace .skills/ folder now"
                  data-testid="skill-refresh"
                >
                  {skillsRefreshing ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />}
                  re-check
                </button>
              </CardHeader>
              <CardContent className="px-4 pb-4 pt-1 space-y-3">
                <p className="text-[11px] text-vs-dim leading-relaxed" data-testid="skill-explainer">
                  Skills live in <span className="text-vs-text">your workspace</span> — create a{' '}
                  <span className="font-mono text-vs-purple">.skills/</span> folder and drop skill documents in
                  (loose files, or a sub-folder per skill with a <span className="font-mono">SKILL.md</span>).
                  GLM re-reads them <span className="text-vs-text">before every task</span> — say{' '}
                  <span className="font-mono text-vs-text">{'“use the skill <name>”'}</span> in your z.ai chat to apply one.
                </p>

                {!wsOnline && (
                  <p className="text-[10.5px] text-vs-yellow flex items-center gap-1.5" data-testid="skill-offline">
                    <AlertTriangle className="size-3 flex-none" /> workspace offline — .skills/ is checked when VS Code reconnects.
                  </p>
                )}
                {wsOnline && skills.length === 0 && skillsMeta.note && (
                  <p className="text-[10.5px] text-vs-dim flex items-start gap-1.5" data-testid="skill-note">
                    <AlertTriangle className="size-3 flex-none mt-0.5 text-vs-yellow" /> {skillsMeta.note}
                  </p>
                )}

                {/* list */}
                {skills.length === 0 ? (
                  <p className="text-center text-vs-dim text-[10.5px] py-2" data-testid="skill-empty">
                    no skills in .skills/ yet — create the folder in your workspace and drop skill documents in
                  </p>
                ) : (
                  <div className="max-h-56 overflow-y-auto space-y-1" data-testid="skill-list">
                    {skills.map((s) => (
                      <SkillRow
                        key={s.name}
                        s={s}
                        active={skillView?.name === s.name}
                        onOpen={() => openSkill(s.name)}
                      />
                    ))}
                  </div>
                )}

                {/* skill viewer */}
                {skillView && (
                  <div className="rounded-md border border-vs-border overflow-hidden" data-testid="skill-viewer">
                    <div className="flex items-center gap-2 px-2.5 py-1.5 bg-vs-panel-2">
                      <BookOpen className="size-3.5 text-vs-purple flex-none" />
                      <span className="font-mono text-[11px] text-vs-bright truncate flex-1 min-w-0" title={skillView.name}>
                        {skillView.name}
                      </span>
                      {skillView.skill?.format === 'package' && (
                        <Badge variant="outline" className="border-vs-blue/40 text-vs-blue text-[8.5px] px-1.5 flex-none" data-testid="skill-package-badge">
                          folder · {skillView.skill.files?.length ?? 0} files
                        </Badge>
                      )}
                      <span className="text-[9px] text-vs-faint flex-none">
                        from .skills/
                      </span>
                      <button suppressHydrationWarning className="text-vs-dim hover:text-vs-text flex-none" onClick={() => setSkillView(null)} title="Close">
                        <X className="size-3.5" />
                      </button>
                    </div>
                    {skillView.loading ? (
                      <div className="py-6 text-center text-vs-dim text-xs flex flex-col items-center gap-2">
                        <Loader2 className="size-4 animate-spin" /> reading {skillView.name}…
                      </div>
                    ) : skillView.error ? (
                      <p className="py-3 text-center text-vs-red text-xs">{skillView.error}</p>
                    ) : (
                      <>
                        <div className="px-2.5 py-2 bg-vs-purple/[0.08] border-b border-vs-border text-[10.5px] text-vs-purple leading-relaxed" data-testid="skill-learned">
                          <span className="font-semibold">learned by GLM:</span> re-read from the workspace .skills/ folder before every task — it is applied automatically, and on request via “use the skill {skillView.name}”.
                        </div>
                        {(skillView.files ?? []).length > 1 && (
                          <div className="flex items-center gap-1 px-2 py-1.5 border-b border-vs-border bg-vs-panel-2 overflow-x-auto" data-testid="skill-files">
                            {skillView.files!.map((f) => (
                              <button
                                key={f.path}
                                suppressHydrationWarning
                                onClick={() => setSkillView((v) => (v ? { ...v, activeFile: f.path } : v))}
                                title={`${f.path} · ${fmtBytes(f.size)}`}
                                className={`flex-none font-mono text-[9.5px] px-2 py-0.5 border-t-2 transition-colors ${
                                  skillView.activeFile === f.path
                                    ? 'border-t-vs-blue text-vs-blue-bright bg-vs-bg'
                                    : 'border-t-transparent text-vs-dim hover:text-vs-text hover:bg-vs-hover'
                                }`}
                                data-file={f.path}
                                data-file-main={skillView.skill?.files?.find((m) => m.path === f.path)?.main ? 'true' : undefined}
                              >
                                {f.path.split('/').pop()}
                                {skillView.skill?.files?.find((m) => m.path === f.path)?.main ? ' ★' : ''}
                              </button>
                            ))}
                          </div>
                        )}
                        <pre className="text-[10.5px] font-mono text-vs-text whitespace-pre-wrap break-all bg-vs-bg p-3 max-h-64 overflow-auto" data-testid="skill-content">
                          {(skillView.files && skillView.files.length > 0
                            ? skillView.files.find((f) => f.path === skillView.activeFile)?.content ?? skillView.files[0].content
                            : skillView.content ?? '').slice(0, 300000) || '(empty skill)'}
                        </pre>
                      </>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="bg-vs-panel border-vs-border flex flex-col">
              <CardHeader className="pb-2 pt-4 px-4 flex-row items-center gap-2 flex-wrap">
                <CardTitle className="text-xs font-semibold uppercase tracking-wide text-vs-text flex items-center gap-1.5">
                  <Activity className="size-3.5" /> AI Activity
                </CardTitle>
                <div className="flex items-center gap-1">
                  <FeedChip active={feedFilter === 'all'} onClick={() => setFeedFilter('all')}>All</FeedChip>
                  <FeedChip active={feedFilter === 'ai'} onClick={() => setFeedFilter('ai')}>AI</FeedChip>
                  <FeedChip active={feedFilter === 'you'} onClick={() => setFeedFilter('you')}>You</FeedChip>
                  <FeedChip active={feedFilter === 'sys'} onClick={() => setFeedFilter('sys')}>System</FeedChip>
                </div>
                <div className="flex-1" />
                {paired && (
                  <Button onClick={clearActivity} variant="outline" size="sm" className="border-vs-border-2 h-7 text-[10px] text-vs-dim" title="Clear the activity log">
                    <Trash className="size-3" />
                  </Button>
                )}
              </CardHeader>
              <CardContent className="px-3 pb-4 pt-1">
                <ScrollArea className="h-[calc(100vh-330px)] min-h-[420px] pr-2">
                  {feed.length === 0 ? (
                    <div className="py-14 text-center text-vs-dim text-xs">
                      <Activity className="size-6 mx-auto mb-3" />
                      <p className="max-w-xs mx-auto leading-relaxed">
                        Nothing yet. When GLM (or anyone) touches your workspace — reads, edits, deletions, commands — it shows up here, live, with diffs.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      {feed.map((e) => (
                        <ActivityRow
                          key={e.id}
                          e={e}
                          open={openIds.has(e.id)}
                          onToggle={() => setOpenIds((prev) => {
                            const next = new Set(prev);
                            if (next.has(e.id)) next.delete(e.id); else next.add(e.id);
                            return next;
                          })}
                        />
                      ))}
                    </div>
                  )}
                </ScrollArea>
              </CardContent>
            </Card>

            {/* Raw event console */}
            <Card className="bg-vs-panel border-vs-border">
              <CardHeader className="pb-2 pt-3 px-4 flex-row items-center gap-2">
                <button
                  suppressHydrationWarning
                  className="text-[10px] uppercase tracking-wide text-vs-dim hover:text-vs-text flex items-center gap-1.5"
                  onClick={() => setShowRaw((v) => !v)}
                >
                  <ListFilter className="size-3" /> raw events {showRaw ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
                </button>
                <Badge variant="outline" className="border-vs-border-2 text-vs-dim text-[9px] font-mono">{rawEvents.length}</Badge>
                <div className="flex-1" />
                <button suppressHydrationWarning className="text-[10px] text-vs-dim hover:text-vs-text" onClick={() => setRawEvents([])}>clear</button>
              </CardHeader>
              {showRaw && (
                <CardContent className="px-4 pb-4 pt-0">
                  <div ref={rawRef} className="max-h-40 overflow-y-auto bg-vs-bg border border-vs-border rounded-md p-2 font-mono text-[9.5px] text-vs-dim space-y-0.5">
                    {rawEvents.length === 0 && <p className="text-center py-3">no events yet…</p>}
                    {rawEvents.map((r, i) => (
                      <div key={i} className="truncate">
                        <span className="text-vs-faint">{timeStr(r.ts)}</span>{' '}
                        <span className="text-vs-blue-bright/80">{r.name}</span>{' '}
                        <span className="text-vs-dim">{r.data}</span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              )}
            </Card>
          </div>
        </div>
      </div>

      {/* Status bar — VS Code-style observability strip */}
      <footer className="mt-auto bg-vs-blue text-white text-[10.5px] font-mono h-6 px-3 flex items-center gap-4 overflow-hidden whitespace-nowrap select-none">
        <span className="flex items-center gap-1.5 shrink-0">
          <Zap className="size-3" />
          <span className="hidden sm:inline">workspace bridge</span>
        </span>
        <span className="flex items-center gap-1.5 shrink-0">
          <span className={`size-1.5 rounded-full inline-block ${svcUp ? 'bg-white' : 'bg-white/30'}`} />
          {svcUp ? 'service online' : 'service offline'}
        </span>
        <span className="flex items-center gap-1.5 shrink-0">
          <span className={`size-1.5 rounded-full inline-block ${wsOnline ? 'bg-white' : 'bg-white/30'}`} />
          {wsOnline ? status.workspaceName ?? 'workspace' : 'workspace offline'}
        </span>
        {paired && <span className="shrink-0 hidden sm:inline">paired</span>}
        <span className="flex-1" />
        {tree?.stats && <span className="shrink-0 hidden md:inline">{tree.stats.files.toLocaleString()} files</span>}
        {skills.length > 0 && (
          <span className="shrink-0 hidden md:flex items-center gap-1.5">
            <GraduationCap className="size-3" />
            {skills.length} skills in .skills/
          </span>
        )}
        {(knowledge?.counts?.verified ?? 0) > 0 && (
          <span className="shrink-0 hidden md:flex items-center gap-1.5">
            <Brain className="size-3" />
            {knowledge?.counts?.verified} verified
          </span>
        )}
        <span className="shrink-0 hidden md:inline">{entries.length} events</span>
        {tree?.stats?.scannedAt && <span className="shrink-0 hidden lg:inline">scan {timeStr(new Date(tree.stats.scannedAt).getTime())}</span>}
      </footer>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Sub components                                                      */
/* ------------------------------------------------------------------ */

function FolderTreeIcon() {
  return <Folder className="size-3.5 text-vs-folder" />;
}

function StatChip({ icon, label, value, sub, accent }: { icon: React.ReactNode; label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div className="rounded-lg border border-vs-border bg-vs-panel px-3 py-2 flex items-center gap-2.5">
      <span className={`flex-none ${accent ?? 'text-vs-dim'}`}>{icon}</span>
      <div className="min-w-0">
        <div className={`text-sm font-mono font-semibold leading-none ${accent ?? 'text-vs-bright'}`}>{value}</div>
        <div className="text-[9.5px] text-vs-dim leading-none mt-1 truncate">{label}{sub ? ` · ${sub}` : ''}</div>
      </div>
    </div>
  );
}

function CopyField({ label, value }: { label?: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(value)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1400);
      })
      .catch(() => undefined);
  };
  return (
    <div className="min-w-0">
      {label ? <div className="text-[10px] uppercase tracking-wide text-vs-dim mb-1">{label}</div> : null}
      <div className="flex items-center gap-2 bg-vs-bg border border-vs-border rounded-md px-2.5 py-1.5 min-w-0">
        <span className="text-[11px] font-mono truncate flex-1 text-vs-text" title={value}>{value}</span>
        <Button onClick={copy} variant="ghost" size="sm" className="h-6 px-1.5 flex-none text-vs-dim" title="Copy">
          {copied ? <CheckCircle2 className="size-3.5 text-vs-green" /> : <Copy className="size-3.5" />}
        </Button>
      </div>
    </div>
  );
}

function SkillRow({ s, active, onOpen }: { s: Skill; active: boolean; onOpen: () => void }) {
  return (
    <div
      className={`flex items-center gap-2 px-2 py-1.5 rounded-md border ${
        active ? 'bg-vs-active border-vs-blue/40' : 'bg-vs-bg/50 border-vs-border hover:bg-vs-hover'
      }`}
      data-testid="skill-row"
      data-skill={s.name}
    >
      <button suppressHydrationWarning onClick={onOpen} className="flex items-center gap-2 flex-1 min-w-0 text-left">
        <BookOpen className="size-3.5 flex-none text-vs-purple" />
        <span className="font-mono text-[11px] text-vs-text truncate" title={s.path}>{s.name}</span>
        {s.format === 'package' && (
          <Badge variant="outline" className="border-vs-blue/40 text-vs-blue text-[8.5px] px-1.5 flex-none" title={`skill package · ${s.files?.length ?? 0} files`}>
            pkg·{s.files?.length ?? 0}f
          </Badge>
        )}
        <span className="text-[9px] text-vs-faint flex-none">{fmtBytes(s.size)}</span>
      </button>
    </div>
  );
}

function FeedChip({ active, onClick, children, testId }: { active: boolean; onClick: () => void; children: React.ReactNode; testId?: string }) {
  return (
    <button
      suppressHydrationWarning
      onClick={onClick}
      data-testid={testId}
      className={`text-[10px] px-2.5 py-1 border-t-2 font-medium uppercase tracking-wide transition-colors ${
        active ? 'border-t-vs-blue bg-vs-panel-2 text-vs-blue-bright' : 'border-t-transparent text-vs-dim hover:text-vs-text hover:bg-vs-hover'
      }`}
    >
      {children}
    </button>
  );
}

function LockedPanel({ text, icon }: { text: string; icon?: React.ReactNode }) {
  return (
    <div className="py-14 text-center text-vs-dim text-xs">
      <div className="mx-auto mb-3 size-10 rounded-lg bg-vs-panel-2 flex items-center justify-center">
        {icon ?? <ShieldCheck className="size-5" />}
      </div>
      <p className="max-w-sm mx-auto leading-relaxed">{text}</p>
    </div>
  );
}

function FileRow({
  node, depth, expanded, onToggle, onOpen, active, highlight,
}: {
  node: TreeNode; depth: number; expanded: boolean; onToggle: () => void; onOpen: () => void; active: boolean; highlight: boolean;
}) {
  const pad = 8 + depth * 14;
  if (node.type === 'dir') {
    return (
      <button
        suppressHydrationWarning
        onClick={onToggle}
        className="w-full flex items-center gap-1.5 py-[3px] px-2 rounded-sm hover:bg-vs-hover text-left"
        style={{ paddingLeft: pad }}
        data-path={node.path}
      >
        {expanded ? <ChevronDown className="size-3 text-vs-dim flex-none" /> : <ChevronRight className="size-3 text-vs-dim flex-none" />}
        {expanded ? <FolderOpen className="size-3.5 text-vs-folder flex-none" /> : <Folder className="size-3.5 text-vs-folder flex-none" />}
        <span className="truncate text-vs-text">{node.name}</span>
        <span className="text-[9.5px] text-vs-faint flex-none">{(node.children?.length ?? 0)}</span>
      </button>
    );
  }
  return (
    <button
      suppressHydrationWarning
      onClick={onOpen}
      className={`w-full flex items-center gap-1.5 py-[3px] px-2 rounded-sm text-left group ${
        active ? 'bg-vs-active' : 'hover:bg-vs-hover'
      }`}
      style={{ paddingLeft: pad + 15 }}
      data-path={node.path}
      title={node.path}
    >
      <FileIconFor name={node.name} />
      {highlight ? (
        <span className="truncate text-vs-text">{node.path}</span>
      ) : (
        <span className="truncate text-vs-text group-hover:text-vs-bright">{node.name}</span>
      )}
      <span className="flex-1" />
      {node.size !== null && node.size !== undefined && (
        <span className="text-[9.5px] text-vs-faint flex-none">{fmtBytes(node.size)}</span>
      )}
    </button>
  );
}

function FileIconFor({ name }: { name: string }) {
  const ext = name.slice(name.lastIndexOf('.')).toLowerCase();
  if (['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.rs', '.go', '.java', '.kt', '.rb', '.php', '.c', '.h', '.cpp', '.cs', '.swift'].includes(ext))
    return <FileCode className="size-3.5 text-vs-var/80 flex-none" />;
  if (['.json', '.jsonc', '.yaml', '.yml', '.toml', '.xml', '.env', '.ini', '.conf'].includes(ext))
    return <FileJson className="size-3.5 text-vs-folder flex-none" />;
  if (['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.ico', '.bmp'].includes(ext))
    return <FileImage className="size-3.5 text-vs-purple/80 flex-none" />;
  if (['.zip', '.gz', '.tar', '.rar', '.7z', '.vsix'].includes(ext))
    return <FileArchive className="size-3.5 text-vs-red/70 flex-none" />;
  if (['.md', '.txt', '.log', ''].includes(ext) || ext === '.md')
    return <FileText className="size-3.5 text-vs-dim flex-none" />;
  return <File className="size-3.5 text-vs-dim flex-none" />;
}

function ActivityRow({ e, open, onToggle }: { e: ActivityEntry; open: boolean; onToggle: () => void }) {
  const pending = (e as any).pending === true;
  const isAiTool = e.kind === 'tool' && e.source !== 'system';
  const isLocal = e.source === 'local';
  const isNote = e.kind === 'note';
  const isConn = e.kind === 'conn' || e.source === 'system';

  const icon = (() => {
    if (isNote) return <MessageSquareQuote className="size-3.5 text-vs-purple" />;
    if (e.kind === 'fs') {
      if (e.fsType === 'created') return <PencilLine className="size-3.5 text-vs-green" />;
      if (e.fsType === 'deleted') return <Trash2 className="size-3.5 text-vs-red" />;
      return <Pencil className="size-3.5 text-vs-tan" />;
    }
    if (e.kind === 'conn') return <Server className="size-3.5 text-vs-dim" />;
    if (e.kind === 'skill') {
      if (e.tool === 'skill:scan') return <GraduationCap className="size-3.5 text-vs-purple" />;
      if (e.tool === 'skill:review') return <CheckCircle2 className="size-3.5 text-vs-green" />;
      if (e.tool === 'skill:delete' || e.tool === 'skill:clear') return <Trash2 className="size-3.5 text-vs-red" />;
      return <BookOpen className="size-3.5 text-vs-purple" />;
    }
    if (e.kind === 'knowledge') {
      if (e.tool === 'knowledge:verify') return <FlaskConical className="size-3.5 text-vs-teal" />;
      if (e.tool === 'knowledge:preflight' || e.tool === 'knowledge:search') return <Search className="size-3.5 text-vs-teal" />;
      if (e.tool === 'knowledge:submit' || e.tool === 'knowledge:propose') return <Brain className="size-3.5 text-vs-purple" />;
      if (e.tool === 'knowledge:attempt') return <XCircle className="size-3.5 text-vs-red" />;
      return <Brain className="size-3.5 text-vs-teal" />;
    }
    if (e.kind === 'verification') {
      if (e.tool === 'verification:test') return <FlaskConical className="size-3.5 text-vs-teal" />;
      if (e.tool === 'verification:start') return <Play className="size-3.5 text-vs-green" />;
      if (e.tool === 'verification:cancel') return <Square className="size-3.5 text-vs-red" />;
      if (e.tool === 'verification:report') return <FileText className="size-3.5 text-vs-blue-bright" />;
      return <FlaskConical className="size-3.5 text-vs-purple" />;
    }
    switch (e.tool) {
      case 'write_file': return <PencilLine className="size-3.5 text-vs-green" />;
      case 'edit_file': return <Pencil className="size-3.5 text-vs-tan" />;
      case 'delete_file': return <Trash2 className="size-3.5 text-vs-red" />;
      case 'move_path': return <ArrowRightLeft className="size-3.5 text-vs-purple" />;
      case 'create_directory': return <FolderPlus className="size-3.5 text-vs-yellow" />;
      case 'read_file': return <Eye className="size-3.5 text-vs-var" />;
      case 'list_files': return <List className="size-3.5 text-vs-dim" />;
      case 'search_code': return <Search className="size-3.5 text-vs-dim" />;
      case 'run_command': return <TerminalSquare className="size-3.5 text-vs-orange" />;
      case 'get_diagnostics': return <Stethoscope className="size-3.5 text-vs-teal" />;
      default: return <Bot className="size-3.5 text-vs-dim" />;
    }
  })();

  const actorColor = e.source === 'operator' ? 'text-vs-purple' : e.source === 'web' ? 'text-vs-var' : e.source === 'local' ? 'text-vs-fn' : e.source === 'vscode' ? 'text-vs-teal' : 'text-vs-dim';

  const title = isNote ? 'note' : e.kind === 'fs' ? e.fsType : e.kind === 'conn' ? 'system' : e.tool ?? 'tool';
  const subject = isNote ? e.text?.slice(0, 90) : e.kind === 'conn' ? e.text : e.path || e.tool || '';

  const hasDetail = !!(e.result || e.args || e.meta?.diff?.length || (e.meta && (e.meta.linesAdded !== undefined || e.meta.linesRemoved !== undefined)));

  return (
    <div className={`rounded-md border overflow-hidden ${e.ok === false ? 'border-vs-red/30 bg-vs-red/[0.06]' : 'border-vs-border bg-vs-bg/50'} ${pending ? 'opacity-80' : ''}`}>
      <button suppressHydrationWarning className="w-full px-2.5 py-2 flex items-center gap-2 text-left hover:bg-vs-hover/60" onClick={onToggle} data-testid="activity-entry">
        <span className="flex-none">{pending ? <Loader2 className="size-3.5 animate-spin text-vs-yellow" /> : icon}</span>
        {isAiTool && !pending && (
          <span className={`flex-none ${e.ok === false ? 'text-vs-red' : 'text-vs-green'}`}>
            {e.ok === false ? <XCircle className="size-3" /> : <CheckCircle2 className="size-3" />}
          </span>
        )}
        <span className="font-mono text-[11px] text-vs-bright flex-none">{title}</span>
        <span className="font-mono text-[10.5px] text-vs-dim truncate flex-1 min-w-0" title={subject}>{subject}</span>
        <span className={`text-[9px] uppercase tracking-wide flex-none ${actorColor}`}>{shortActor(e.actor)}</span>
        {e.durMs !== undefined && <span className="text-[9.5px] font-mono text-vs-faint flex-none">{(e.durMs / 1000).toFixed(1)}s</span>}
        <span className="text-[9.5px] font-mono text-vs-faint flex-none">{timeStr(e.ts)}</span>
        {hasDetail && (open
          ? <ChevronDown className="size-3 text-vs-faint flex-none" />
          : <ChevronRight className="size-3 text-vs-faint flex-none" />)}
      </button>

      {open && (
        <div className="border-t border-vs-border/70 px-2.5 py-2 space-y-2">
          {/* meta line: +adds / -removes / bytes */}
          {e.meta && (e.meta.linesAdded !== undefined || e.meta.linesRemoved !== undefined || e.meta.bytes !== undefined) && (
            <div className="flex items-center gap-2 text-[10px] font-mono flex-wrap">
              {e.meta.kind && <Badge variant="outline" className="border-vs-border-2 text-vs-dim text-[9px]">{e.meta.kind}</Badge>}
              {e.meta.linesAdded !== undefined && <span className="text-vs-green">+{e.meta.linesAdded}</span>}
              {e.meta.linesRemoved !== undefined && <span className="text-vs-red">−{e.meta.linesRemoved}</span>}
              {e.meta.bytes !== undefined && <span className="text-vs-dim">{fmtBytes(e.meta.bytes)}</span>}
              {e.meta.lines !== undefined && <span className="text-vs-dim">{e.meta.lines} lines</span>}
              {e.meta.wasDir && <span className="text-vs-dim">folder</span>}
            </div>
          )}

          {/* diff */}
          {e.meta?.diff && e.meta.diff.length > 0 && (
            <div className="rounded-md border border-vs-border overflow-auto max-h-64 bg-vs-bg" data-testid="diff-view">
              {e.meta.diff.map((r, i) => (
                <div
                  key={i}
                  className={`px-2 py-[1px] font-mono text-[10px] whitespace-pre ${
                    r.t === '+' ? 'bg-vs-green/10 text-vs-green' : r.t === '-' ? 'bg-vs-red/10 text-vs-red' : 'text-vs-dim'
                  }`}
                >
                  <span className="inline-block w-3 select-none opacity-60">{r.t === ' ' ? ' ' : r.t}</span>{r.s}
                </div>
              ))}
            </div>
          )}

          {/* args */}
          {e.args && Object.keys(e.args).length > 0 && e.kind === 'tool' && (
            <details className="text-[10px]">
              <summary className="text-vs-dim cursor-pointer hover:text-vs-text select-none">arguments</summary>
              <pre className="mt-1 font-mono text-vs-dim whitespace-pre-wrap break-all">{(() => { try { return JSON.stringify(e.args, null, 2)?.slice(0, 800); } catch { return ''; } })()}</pre>
            </details>
          )}

          {/* result */}
          {e.result && (
            <pre className="font-mono text-[10px] text-vs-text whitespace-pre-wrap break-all max-h-48 overflow-auto bg-vs-bg border border-vs-border rounded-md p-2" data-testid="tool-result">
              {e.result.slice(0, 2200) || '(empty)'}
            </pre>
          )}

          {/* full text for notes/conn */}
          {(isNote || e.kind === 'conn') && e.text && (
            <p className="text-[11px] text-vs-dim leading-relaxed">{e.text}</p>
          )}
        </div>
      )}
    </div>
  );
}

function shortActor(actor: string | undefined): string {
  const a = String(actor ?? '');
  if (a === 'GLM (z.ai web)') return 'glm';
  if (a === 'Web viewer') return 'web';
  if (a === 'You (VS Code)') return 'you';
  if (a.startsWith('GLM')) return 'glm';
  if (a === 'System') return 'sys';
  if (a === '…') return '…';
  return a.slice(0, 8).toLowerCase();
}

function KnowledgeMetaItem({ label, title, children }: { label: string; title?: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0" title={title}>
      <span className="text-[9px] uppercase tracking-wide text-vs-dim">{label} </span>
      <span className="text-[10px] text-vs-text">{children}</span>
    </div>
  );
}

/** One knowledge version: problem / root cause / solution / env + the verification gate with its evidence. */
function KnowledgeVersionView({ v }: { v: KnowledgeVersion }) {
  const verif = knowledgeVerifMeta(v.verificationStatus);
  const evidence = v.evidence ?? [];
  return (
    <div className="space-y-2.5" data-testid="knowledge-version-content">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        <div className="min-w-0">
          <div className="text-[9px] uppercase tracking-wide text-vs-dim mb-0.5">problem</div>
          <p className="text-[10.5px] text-vs-text leading-relaxed whitespace-pre-wrap break-words">{v.symptoms}</p>
        </div>
        <div className="min-w-0">
          <div className="text-[9px] uppercase tracking-wide text-vs-dim mb-0.5">root cause</div>
          <p className="text-[10.5px] text-vs-text leading-relaxed whitespace-pre-wrap break-words">{v.rootCause}</p>
        </div>
      </div>

      <div>
        <div className="text-[9px] uppercase tracking-wide text-vs-dim mb-1">solution</div>
        <pre className="bg-vs-bg border border-vs-border rounded-md p-3 text-[10.5px] font-mono max-h-56 overflow-auto whitespace-pre-wrap break-words" data-testid="knowledge-solution">
          {v.solutionSteps || '(no solution steps recorded)'}
        </pre>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-1 text-[10px]">
        <div className="min-w-0"><span className="text-vs-dim">environment </span><span className="font-mono text-vs-text break-words">{v.environment}</span></div>
        <div className="min-w-0"><span className="text-vs-dim">applicable </span><span className="font-mono text-vs-text break-words">{v.applicableVersions}</span></div>
        {v.limitations ? <div className="min-w-0 sm:col-span-2"><span className="text-vs-dim">limitations </span><span className="text-vs-text">{v.limitations}</span></div> : null}
        {v.compatibilityNotes ? <div className="min-w-0 sm:col-span-2"><span className="text-vs-dim">compatibility </span><span className="text-vs-text">{v.compatibilityNotes}</span></div> : null}
        {v.changeReason ? <div className="min-w-0 sm:col-span-2"><span className="text-vs-dim">change reason </span><span className="text-vs-text">{v.changeReason}</span></div> : null}
      </div>

      {/* verification gate — real checks with real exit codes, or owner approval */}
      <div className="rounded-md border border-vs-border bg-vs-panel-2/40 p-2.5 space-y-2" data-testid="knowledge-verification">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className={`font-mono text-[10.5px] ${verif.cls}`}>{verif.glyph}</span>
          <span className={`text-[9.5px] uppercase tracking-wide ${verif.cls}`}>{verif.label}</span>
          <span className="text-[10px] text-vs-dim min-w-0">{v.verificationSummary}</span>
        </div>
        {evidence.length === 0 ? (
          <p className="text-[9.5px] text-vs-faint">no verification evidence attached</p>
        ) : (
          <div className="space-y-1.5">
            {evidence.map((ev, i) => {
              const ec = ev.exitCode ?? null;
              const exitOk = ec === 0;
              const exitUnknown = ec === null;
              const exitCls = exitOk ? 'text-vs-green' : exitUnknown ? 'text-vs-yellow' : 'text-vs-red';
              return (
                <div key={i} className="flex items-start gap-1.5 min-w-0">
                  <span className={`font-mono text-[10px] flex-none ${exitCls}`} title={exitUnknown ? 'no exit code recorded' : `exit code ${ec}`}>{exitOk ? '✓' : exitUnknown ? '?' : '✗'}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {ev.command && <span className="font-mono text-[9.5px] text-vs-text truncate max-w-[22rem]" title={ev.command}>{ev.command}</span>}
                      {!exitOk && !exitUnknown && <span className={`font-mono text-[9px] ${exitCls}`}>exit {ec}</span>}
                      {ev.timedOut && <span className="text-[9px] text-vs-yellow">timed out</span>}
                      {ev.journalRef && <Badge variant="outline" className="border-vs-border-2 text-vs-faint text-[8.5px] px-1.5 font-mono" title={ev.journalRef}>{ev.journalRef}</Badge>}
                      <span className="text-[9px] font-mono text-vs-faint">{timeStr(ev.ts)}</span>
                      <span className="text-[9px] text-vs-faint">{shortActor(ev.actor)}</span>
                    </div>
                    {ev.summary && <p className="text-[9.5px] text-vs-dim truncate" title={ev.summary}>{ev.summary}</p>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Verification — the scientific engine UI                             */
/* ------------------------------------------------------------------ */

function vStatusMeta(s: string): { cls: string; label: string; glyph: string } {
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

function vCaseMeta(s: string): { cls: string; glyph: string; label: string } {
  switch (s) {
    case 'PASS': return { cls: 'text-vs-green', glyph: '✓', label: 'pass' };
    case 'FAIL': return { cls: 'text-vs-red', glyph: '✗', label: 'fail' };
    case 'ERROR': return { cls: 'text-vs-yellow', glyph: '⚠', label: 'infra error' };
    case 'SKIPPED': return { cls: 'text-vs-faint', glyph: '⏭', label: 'skipped' };
    case 'BLOCKED': return { cls: 'text-vs-orange', glyph: '⊘', label: 'blocked' };
    default: return { cls: 'text-vs-faint', glyph: '·', label: 'not executed' };
  }
}

function vStepMeta(s: string): { cls: string; glyph: string } {
  switch (s) {
    case 'complete': return { cls: 'text-vs-green', glyph: '●' };
    case 'running': return { cls: 'text-vs-blue-bright', glyph: '◐' };
    case 'failed': return { cls: 'text-vs-red', glyph: '✗' };
    case 'skipped': return { cls: 'text-vs-faint', glyph: '○' };
    default: return { cls: 'text-vs-faint', glyph: '○' };
  }
}

/* The verification run list shown inside a knowledge record's detail panel. */
function VerificationSection({ runs, selectedId, onSelect }: {
  runs: VRunForWeb[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div data-testid="verification-section">
      <div className="flex items-center gap-1.5 mb-1">
        <FlaskConical className="size-3 text-vs-teal" />
        <span className="text-[9.5px] uppercase tracking-wide text-vs-dim">scientific verification · {runs.length}</span>
      </div>
      {runs.length === 0 ? (
        <p className="text-[10px] text-vs-faint pl-4" data-testid="verification-empty">
          no verification runs yet — GLM creates them via <code className="font-mono text-vs-dim">bridge.mjs verification create</code>, then you review the plan and press Start here
        </p>
      ) : (
        <div className="space-y-1 max-h-44 overflow-y-auto" data-testid="verification-run-list">
          {runs.map((r) => {
            const m = vStatusMeta(r.status);
            const sel = r.id === selectedId;
            return (
              <button
                suppressHydrationWarning
                key={r.id}
                onClick={() => onSelect(r.id)}
                className={`w-full text-left px-2.5 py-1.5 rounded-md border flex items-center gap-2 ${sel ? 'bg-vs-active border-vs-blue/40' : 'bg-vs-bg/50 border-vs-border hover:bg-vs-hover'}`}
                data-testid="verification-run-row"
                data-run-id={r.id}
                data-run-status={r.status}
              >
                <span className={`font-mono text-[10px] flex-none ${m.cls}`} title={r.status}>{m.glyph}</span>
                <span className="font-mono text-[9.5px] text-vs-blue-bright flex-none">{r.id}</span>
                <span className="text-[10px] truncate min-w-0 flex-1" title={r.title}>{r.title}</span>
                <span className="text-[9px] text-vs-dim flex-none whitespace-nowrap hidden sm:inline">
                  {r.stats.passed}✓/{r.stats.failed}✗ · {r.stats.passRate === null ? 'N/A' : `${r.stats.passRate}%`}
                </span>
                {r.needsDangerousConfirm && r.status === 'READY' && (
                  <span className="text-[9px] text-vs-yellow flex-none" title="contains network/destructive tests — needs your confirmation">⚠</span>
                )}
                <span className="font-mono text-[9px] text-vs-faint flex-none hidden md:inline">{shortWhen(r.updatedAt)}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* The full run view: overview, owner actions, timeline, stats, tests, logs, evidence. */
function VerificationRunPanel({ detail, busy, error, confirm, onStart, onCancel, onFeedback, onOpenFile }: {
  detail: VRunDetail;
  busy: boolean;
  error: string | null;
  confirm: string | null;
  onStart: (runId: string, dangerous: boolean) => void;
  onCancel: (runId: string) => void;
  onFeedback: (runId: string, decision: 'accept' | 'reject' | 'comment', comment: string) => void;
  onOpenFile: (path: string) => void;
}) {
  const run = detail.run;
  const m = vStatusMeta(run.status);
  const [openCases, setOpenCases] = useState<Set<string>>(new Set());
  const [fbComment, setFbComment] = useState('');
  const [logsCopied, setLogsCopied] = useState(false);

  const toggleCase = (id: string) => {
    setOpenCases((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const attemptsByCase = new Map<string, VAttempt[]>();
  for (const a of detail.attempts) {
    const list = attemptsByCase.get(a.testCaseId) ?? [];
    list.push(a);
    attemptsByCase.set(a.testCaseId, list);
  }

  const s = run.stats;
  const copyLogs = () => {
    const text = detail.cases.map((c) => {
      const atts = attemptsByCase.get(c.id) ?? [];
      return `### ${c.id} — ${c.name} [${c.status}]\ncommand: ${c.command}\n` +
        atts.map((a) => `attempt ${a.attemptNumber}: ${a.status} (exit ${a.exitCode ?? 'n/a'}, ${a.durationMs}ms)\n${a.output}`).join('\n');
    }).join('\n\n');
    try {
      void navigator.clipboard.writeText(text);
      setLogsCopied(true);
      setTimeout(() => setLogsCopied(false), 2000);
    } catch { /* clipboard unavailable */ }
  };

  return (
    <div className="rounded-md border border-vs-border bg-vs-panel-2/40 p-2.5 space-y-2.5" data-testid="verification-run-panel" data-run-id={run.id}>
      {/* A. overview */}
      <div className="space-y-1.5" data-testid="verification-overview">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className={`font-mono text-[10.5px] ${m.cls}`}>{m.glyph}</span>
          <span className={`text-[9.5px] uppercase tracking-wide ${m.cls}`}>{m.label}</span>
          <span className="font-mono text-[9.5px] text-vs-blue-bright">{run.id}</span>
          <span className="text-[10px] text-vs-dim min-w-0 truncate flex-1" title={run.title}>{run.title}</span>
          {busy && <Loader2 className="size-3 animate-spin text-vs-dim" />}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-1 text-[9.5px]" data-testid="verification-meta">
          <div><span className="text-vs-faint">stage </span><span className="text-vs-text font-mono">{run.currentStage}/10 {run.steps[run.currentStage - 1]?.name ?? ''}</span></div>
          <div><span className="text-vs-faint">started </span><span className="text-vs-text font-mono">{run.startedAt ? shortWhen(run.startedAt) : '—'}</span></div>
          <div><span className="text-vs-faint">duration </span><span className="text-vs-text font-mono">{run.durationMs != null ? `${(run.durationMs / 1000).toFixed(1)}s` : '—'}</span></div>
          <div><span className="text-vs-faint">rounds </span><span className="text-vs-text font-mono">{run.rounds.length}</span></div>
        </div>
        <div className="text-[10px] text-vs-dim leading-relaxed" title={run.hypothesis.text} data-testid="verification-hypothesis">
          <span className="text-vs-faint uppercase text-[9px] tracking-wide">hypothesis </span>{run.hypothesis.text.slice(0, 260)}{run.hypothesis.text.length > 260 ? '…' : ''}
        </div>
        {run.cancelled && <div className="text-[9.5px] text-vs-orange">cancelled — {run.cancelReason}</div>}
        {run.needsDangerousConfirm && run.status === 'READY' && (
          <div className="text-[9.5px] text-vs-yellow">⚠ this plan contains network/destructive tests — starting it requires your explicit confirmation</div>
        )}
        {error && <div className="text-[9.5px] text-vs-red" data-testid="verification-action-error">{error}</div>}
      </div>

      {/* owner actions — the owner initiates execution and stays in control */}
      <div className="flex items-center gap-2 flex-wrap pt-0.5" data-testid="verification-actions">
        {run.status === 'READY' && (
          <Button
            size="sm"
            className="h-7 gap-1"
            disabled={busy}
            onClick={() => onStart(run.id, run.needsDangerousConfirm)}
            title={run.needsDangerousConfirm ? 'Start execution (this plan includes dangerous tests — click twice to confirm)' : 'Review the plan below, then start execution'}
            data-testid="verification-start"
          >
            {confirm === `vstart:${run.id}` ? <><AlertTriangle className="size-3.5" /> confirm dangerous start?</> : <><Play className="size-3.5" /> {run.needsDangerousConfirm ? 'Start (dangerous)' : 'Start verification'}</>}
          </Button>
        )}
        {run.status === 'TESTING' && (
          <Button
            size="sm" variant="outline"
            className="h-7 gap-1 border-vs-red/40 text-vs-red"
            disabled={busy}
            onClick={() => onCancel(run.id)}
            title="Cancel — takes effect before the next test starts"
            data-testid="verification-cancel"
          >
            <Square className="size-3.5" /> Cancel
          </Button>
        )}
        <div className="flex items-center gap-1.5 flex-1 min-w-[12rem]">
          <Input
            value={fbComment}
            onChange={(e) => setFbComment(e.target.value)}
            placeholder="owner feedback (optional)…"
            className="h-7 text-[10.5px] flex-1"
            data-testid="verification-feedback-input"
          />
          <Button size="sm" variant="outline" className="h-7 border-vs-green/40 text-vs-green" disabled={busy} onClick={() => onFeedback(run.id, 'accept', fbComment)} title="Accept the verification outcome" data-testid="verification-feedback-accept">
            <CheckCircle2 className="size-3.5" /> accept
          </Button>
          <Button size="sm" variant="outline" className="h-7 border-vs-red/40 text-vs-red" disabled={busy} onClick={() => onFeedback(run.id, 'reject', fbComment)} title="Reject the verification outcome" data-testid="verification-feedback-reject">
            <XCircle className="size-3.5" /> reject
          </Button>
        </div>
      </div>

      {/* B. live execution timeline */}
      <div data-testid="verification-timeline">
        <div className="flex items-center gap-1.5 mb-1">
          <History className="size-3 text-vs-dim" />
          <span className="text-[9px] uppercase tracking-wide text-vs-dim">execution timeline</span>
        </div>
        <div className="space-y-0.5">
          {run.steps.map((st) => {
            const sm = vStepMeta(st.status);
            return (
              <div key={st.n} className="flex items-start gap-1.5 min-w-0" data-testid="verification-step" data-step={st.n} data-step-status={st.status}>
                <span className={`font-mono text-[9.5px] flex-none w-4 text-center ${sm.cls}`}>{sm.glyph}</span>
                <span className="font-mono text-[9px] text-vs-faint flex-none w-5">{String(st.n).padStart(2, '0')}</span>
                <span className={`text-[10px] flex-none ${st.status === 'pending' ? 'text-vs-faint' : 'text-vs-text'}`}>{st.name}</span>
                <span className="text-[9px] text-vs-dim truncate min-w-0 flex-1" title={st.details}>{st.details}</span>
                {st.durationMs != null && <span className="font-mono text-[9px] text-vs-faint flex-none">{(st.durationMs / 1000).toFixed(1)}s</span>}
                {st.status === 'running' && <Loader2 className="size-3 animate-spin text-vs-blue-bright flex-none" />}
              </div>
            );
          })}
        </div>
      </div>

      {/* C. statistics (computed by the bridge) */}
      <div data-testid="verification-stats">
        <div className="text-[9px] uppercase tracking-wide text-vs-dim mb-1">test statistics — computed by the bridge, not by the AI</div>
        <div className="grid grid-cols-4 sm:grid-cols-6 gap-1.5">
          {[
            { label: 'planned', value: s.planned },
            { label: 'executed', value: s.executed },
            { label: 'passed', value: s.passed, cls: 'text-vs-green' },
            { label: 'failed', value: s.failed, cls: 'text-vs-red' },
            { label: 'errors', value: s.errors, cls: 'text-vs-yellow' },
            { label: 'skipped', value: s.skipped },
            { label: 'blocked', value: s.blocked, cls: 'text-vs-orange' },
            { label: 'attempts', value: s.attempts },
            { label: 'iterations', value: s.iterations },
            { label: 'pass rate', value: s.passRate === null ? 'N/A' : `${s.passRate}%`, cls: s.passRate === null ? 'text-vs-faint' : s.passRate === 100 ? 'text-vs-green' : 'text-vs-yellow' },
          ].map((it) => (
            <div key={it.label} className="rounded border border-vs-border bg-vs-bg/60 px-1.5 py-1 text-center" data-testid="verification-stat">
              <div className={`font-mono text-[11px] ${it.cls ?? 'text-vs-text'}`}>{it.value}</div>
              <div className="text-[8px] uppercase text-vs-faint tracking-wide">{it.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* D. test explorer — every attempt preserved */}
      <div data-testid="verification-tests">
        <div className="flex items-center gap-1.5 mb-1">
          <span className="text-[9px] uppercase tracking-wide text-vs-dim">test explorer · {detail.cases.length} case(s) · {detail.attempts.length} attempt(s)</span>
          <button suppressHydrationWarning className="text-[9px] text-vs-dim hover:text-vs-text flex items-center gap-1" onClick={copyLogs} title="Copy all commands + outputs to the clipboard" data-testid="verification-copy-logs">
            <Copy className="size-3" /> {logsCopied ? 'copied' : 'copy logs'}
          </button>
        </div>
        <div className="space-y-1">
          {detail.cases.map((c) => {
            const cm = vCaseMeta(c.status);
            const atts = attemptsByCase.get(c.id) ?? [];
            const open = openCases.has(c.id);
            return (
              <div key={c.id} className="rounded border border-vs-border overflow-hidden" data-testid="verification-case" data-case-status={c.status}>
                <button
                  suppressHydrationWarning
                  className="w-full px-2 py-1.5 flex items-center gap-2 text-left hover:bg-vs-hover/60"
                  onClick={() => toggleCase(c.id)}
                  aria-expanded={open}
                  data-testid="verification-case-toggle"
                >
                  <span className={`font-mono text-[10px] flex-none ${cm.cls}`}>{cm.glyph}</span>
                  <span className="font-mono text-[9px] text-vs-blue-bright flex-none">{c.id}</span>
                  <span className="text-[10px] truncate min-w-0 flex-1" title={c.objective || c.name}>{c.name}</span>
                  <span className="text-[8.5px] uppercase text-vs-faint flex-none border border-vs-border-2 rounded px-1">{c.category}</span>
                  {c.flags.critical && <span className="text-[8.5px] text-vs-tan flex-none" title="critical test — must pass for VERIFIED">critical</span>}
                  {atts.length > 0 && (
                    <span className="font-mono text-[9px] text-vs-faint flex-none">
                      {atts[atts.length - 1].durationMs}ms · {atts.length} att.
                    </span>
                  )}
                  {open ? <ChevronDown className="size-3 text-vs-faint flex-none" /> : <ChevronRight className="size-3 text-vs-faint flex-none" />}
                </button>
                {open && (
                  <div className="p-2 bg-vs-bg/60 space-y-1.5 border-t border-vs-border/60">
                    <div className="text-[9.5px] text-vs-dim">{c.objective}</div>
                    <div className="font-mono text-[9.5px] text-vs-var bg-vs-bg border border-vs-border rounded-md p-2 whitespace-pre-wrap break-words" data-testid="verification-case-command">{c.command}</div>
                    <div className="text-[9px] text-vs-faint">
                      criteria: exit {c.criteria.exitCode}
                      {c.criteria.outputContains.length > 0 && <> · output contains <span className="text-vs-text font-mono">{c.criteria.outputContains.join(', ')}</span></>}
                      {c.criteria.outputNotContains.length > 0 && <> · output NOT contains <span className="text-vs-text font-mono">{c.criteria.outputNotContains.join(', ')}</span></>}
                    </div>
                    {atts.length === 0 ? (
                      <div className="text-[9.5px] text-vs-faint">not executed yet</div>
                    ) : atts.map((a) => {
                      const am = vCaseMeta(a.status);
                      return (
                        <div key={a.id} className="rounded border border-vs-border/70 p-1.5 space-y-1" data-testid="verification-attempt">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className={`font-mono text-[9.5px] ${am.cls}`}>{am.glyph} attempt {a.attemptNumber} — {am.label}</span>
                            <span className={`font-mono text-[9px] ${a.exitCode === 0 ? 'text-vs-green' : 'text-vs-red'}`}>exit {a.exitCode ?? 'n/a'}</span>
                            {a.timedOut && <span className="text-[9px] text-vs-yellow">timed out</span>}
                            <span className="font-mono text-[9px] text-vs-faint">{a.durationMs}ms</span>
                            {a.journalRef && <Badge variant="outline" className="border-vs-border-2 text-vs-faint text-[8.5px] px-1.5 font-mono" title={`activity journal ${a.journalRef}`}>{a.journalRef}</Badge>}
                            <span className="text-[9px] text-vs-faint ml-auto">round {a.round} · evaluated by {a.evaluatedBy}</span>
                          </div>
                          <div className="text-[9px] text-vs-dim">{a.note}</div>
                          {a.output && (
                            <pre className="font-mono text-[9.5px] text-vs-text bg-vs-bg border border-vs-border rounded-md p-2 max-h-40 overflow-auto whitespace-pre-wrap break-words" data-testid="verification-attempt-output">{a.output}</pre>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* E. metrics */}
      {detail.metrics.length > 0 && (
        <div data-testid="verification-metrics">
          <div className="text-[9px] uppercase tracking-wide text-vs-dim mb-1">measured metrics — every value verified against the cited test output</div>
          <div className="space-y-0.5 max-h-32 overflow-y-auto">
            {detail.metrics.map((mt) => (
              <div key={mt.id} className="flex items-center gap-1.5 min-w-0" data-testid="verification-metric">
                <span className={`font-mono text-[10px] flex-none ${mt.verified ? 'text-vs-green' : 'text-vs-yellow'}`} title={mt.verified ? 'value found in the cited attempt output' : 'reported without a tied attempt'}>{mt.verified ? '✓' : '⚠'}</span>
                <span className="text-[10px] text-vs-text truncate min-w-0 flex-1" title={mt.name}>{mt.name}</span>
                <span className="font-mono text-[10px] text-vs-var flex-none">{mt.value}{mt.unit ? ` ${mt.unit}` : ''}</span>
                {mt.testCaseId && <span className="font-mono text-[9px] text-vs-faint flex-none">{mt.testCaseId}</span>}
                <span className="text-[8.5px] uppercase text-vs-faint flex-none border border-vs-border-2 rounded px-1">{mt.source}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* F. evidence artifacts */}
      {detail.evidence.length > 0 && (
        <div data-testid="verification-evidence">
          <div className="text-[9px] uppercase tracking-wide text-vs-dim mb-1">evidence artifacts</div>
          <div className="space-y-0.5">
            {detail.evidence.map((ev) => (
              <button
                suppressHydrationWarning
                key={ev.id}
                className="w-full text-left flex items-center gap-1.5 min-w-0 px-1.5 py-1 rounded hover:bg-vs-hover/60"
                onClick={() => onOpenFile(ev.storageRef)}
                title={`open ${ev.storageRef} in the file viewer`}
                data-testid="verification-evidence-row"
              >
                <FileText className="size-3 text-vs-blue-bright flex-none" />
                <span className="text-[10px] text-vs-text truncate flex-none max-w-[10rem]" title={ev.filename}>{ev.filename}</span>
                <span className="font-mono text-[9px] text-vs-faint truncate min-w-0 flex-1" title={`sha256 ${ev.sha256}`}>sha256 {ev.sha256.slice(0, 16)}…</span>
                <span className="font-mono text-[9px] text-vs-faint flex-none">{(ev.bytes / 1024).toFixed(1)} KB</span>
                <span className="font-mono text-[9px] text-vs-faint flex-none hidden sm:inline">{shortWhen(ev.createdAt)}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* G. analyses — GLM interpretation + engine decision (labeled separately) */}
      {run.analyses.length > 0 && (
        <div data-testid="verification-analyses">
          <div className="text-[9px] uppercase tracking-wide text-vs-dim mb-1">result analyses — AI interpretation, checked by the bridge</div>
          <div className="space-y-1.5 max-h-64 overflow-y-auto">
            {run.analyses.map((an) => (
              <div key={an.id} className="rounded border border-vs-border/70 p-2 space-y-1" data-testid="verification-analysis">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="font-mono text-[9px] text-vs-purple">GLM · round {an.round}</span>
                  <span className="font-mono text-[9px] text-vs-faint">{shortWhen(an.createdAt)}</span>
                  <span className="ml-auto flex items-center gap-1">
                    <span className="text-[9px] text-vs-faint">proposed</span>
                    <span className={`text-[9px] font-mono ${vStatusMeta(an.proposedConclusion.status).cls}`}>{an.proposedConclusion.status}</span>
                    <span className={`text-[9px] font-mono ${an.engineDecision.accepted ? 'text-vs-green' : 'text-vs-red'}`}>{an.engineDecision.accepted ? '→ accepted' : '→ REJECTED by evidence'}</span>
                  </span>
                </div>
                <p className="text-[10px] text-vs-text leading-relaxed whitespace-pre-wrap">{an.summary}</p>
                {an.comparison && <p className="text-[9.5px] text-vs-dim"><span className="text-vs-faint">expected vs observed: </span>{an.comparison}</p>}
                {an.alternativeExplanations && <p className="text-[9.5px] text-vs-dim"><span className="text-vs-faint">alternatives: </span>{an.alternativeExplanations}</p>}
                {an.recommendedModifications && <p className="text-[9.5px] text-vs-dim"><span className="text-vs-faint">modifications: </span>{an.recommendedModifications}</p>}
                <p className={`text-[9.5px] ${an.engineDecision.accepted ? 'text-vs-green' : 'text-vs-yellow'}`} data-testid="verification-engine-decision">
                  engine decision: {an.engineDecision.effectiveStatus} — {an.engineDecision.reason}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* conclusion */}
      {run.conclusion && (
        <div className={`rounded-md border p-2 ${run.conclusion.status === 'VERIFIED' ? 'border-vs-green/40 bg-vs-green/[0.05]' : run.conclusion.status === 'FAILED' ? 'border-vs-red/40 bg-vs-red/[0.05]' : 'border-vs-yellow/40 bg-vs-yellow/[0.05]'}`} data-testid="verification-conclusion">
          <div className="flex items-center gap-1.5">
            <span className={`font-mono text-[10.5px] ${m.cls}`}>{m.glyph}</span>
            <span className={`text-[9.5px] uppercase tracking-wide ${m.cls}`}>conclusion — {run.conclusion.status}</span>
            <span className="text-[9px] text-vs-faint ml-auto font-mono">{run.conclusion.decidedBy}</span>
          </div>
          <p className="text-[10px] text-vs-text mt-1">{run.conclusion.summary}</p>
          {run.conclusion.glmInterpretation && (
            <p className="text-[9.5px] text-vs-dim mt-1"><span className="text-vs-purple">AI interpretation: </span>{run.conclusion.glmInterpretation.slice(0, 400)}</p>
          )}
          {run.feedback.length > 0 && (
            <div className="mt-1.5 space-y-0.5 border-t border-vs-border/50 pt-1.5">
              {run.feedback.map((f) => (
                <div key={f.id} className="flex items-center gap-1.5 text-[9.5px]">
                  <span className={f.decision === 'accept' ? 'text-vs-green' : f.decision === 'reject' ? 'text-vs-red' : 'text-vs-dim'}>{f.decision === 'accept' ? '✓' : f.decision === 'reject' ? '✗' : '»'}</span>
                  <span className="text-vs-dim truncate min-w-0 flex-1">{f.comment || `owner ${f.decision}ed`}</span>
                  <span className="text-vs-faint flex-none">{f.actor.includes('Owner') ? 'owner' : f.actor} · {shortWhen(f.createdAt)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* environment snapshot (reproducibility) */}
      {run.environmentSnapshot && (
        <details className="text-[9.5px] text-vs-dim" data-testid="verification-environment">
          <summary className="text-[9px] uppercase tracking-wide text-vs-faint cursor-pointer hover:text-vs-text">environment snapshot (reproducibility)</summary>
          <div className="pl-3 pt-1 space-y-0.5 font-mono text-[9.5px] text-vs-dim">
            <div>os: {run.environmentSnapshot.os}</div>
            <div>runtimes: {run.environmentSnapshot.runtimes}</div>
            <div>source revision: {run.environmentSnapshot.sourceRevision ?? 'n/a'}</div>
          </div>
        </details>
      )}
    </div>
  );
}
