'use client';

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { io, Socket } from 'socket.io-client';
import { Badge } from '@/components/ui/badge';
import {
  Zap, Gauge, Activity as ActivityIcon, FolderOpen, Brain, GraduationCap, Settings,
} from 'lucide-react';
import { cn } from '@/lib/utils';

import type {
  ActivityEntry, FeedFilter, FileViewState, KnowledgeState, KnowledgeStatusFilter,
  Skill, SkillViewState, SkillsMeta, SkillFileView, SvcStatus, TreeNode, TreePayload,
  VerificationState, VRunDetail, ViewId,
} from '@/components/bridge/types';
import { VIEW_IDS, TOKEN_KEY, extractCode, timeStr } from '@/components/bridge/types';

import { Dot } from '@/components/bridge/bits';
import { ActivityView } from '@/components/bridge/activity';
import { WorkspaceView } from '@/components/bridge/workspace';
import { KnowledgeView } from '@/components/bridge/knowledge';
import { SkillsView } from '@/components/bridge/skills';
import { SetupView } from '@/components/bridge/setup';
import { OverviewView } from '@/components/bridge/overview';

/* ------------------------------------------------------------------ */
/* Navigation model — one place, rendered by sidebar + mobile tabs     */
/* ------------------------------------------------------------------ */

const NAV_SECTIONS: { label: string; items: { id: ViewId; label: string; icon: React.ReactNode }[] }[] = [
  {
    label: 'Monitor',
    items: [
      { id: 'overview', label: 'Overview', icon: <Gauge className="size-4" /> },
      { id: 'activity', label: 'Activity', icon: <ActivityIcon className="size-4" /> },
      { id: 'workspace', label: 'Workspace', icon: <FolderOpen className="size-4" /> },
    ],
  },
  {
    label: 'Intelligence',
    items: [
      { id: 'knowledge', label: 'Knowledge', icon: <Brain className="size-4" /> },
      { id: 'skills', label: 'Skills', icon: <GraduationCap className="size-4" /> },
    ],
  },
  {
    label: 'Connect',
    items: [{ id: 'setup', label: 'Setup', icon: <Settings className="size-4" /> }],
  },
];

const NAV_TITLES: Record<ViewId, string> = {
  overview: 'Overview',
  activity: 'Activity',
  workspace: 'Workspace',
  knowledge: 'Knowledge',
  skills: 'Skills',
  setup: 'Setup',
};

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */
export default function AgentPage() {
  /* ------------------------- connection state --------------------- */
  const [svcUp, setSvcUp] = useState(false);
  const [status, setStatus] = useState<SvcStatus>({});
  const [paired, setPaired] = useState(false);
  const [pairInput, setPairInput] = useState('');
  const [pairingNote, setPairingNote] = useState<string | null>(null);

  /* ------------------------- workspace state ----------------------- */
  const [tree, setTree] = useState<TreePayload | null>(null);
  const [treeLoading, setTreeLoading] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set(['']));
  const [filter, setFilter] = useState('');
  const [showAllFlat, setShowAllFlat] = useState(false);

  /* ------------------------- activity state ------------------------ */
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());
  const [feedFilter, setFeedFilter] = useState<FeedFilter>('all');

  /* ------------------------- file viewer --------------------------- */
  const [fileView, setFileView] = useState<FileViewState | null>(null);

  /* ------------------------- skills -------------------------------- */
  const [skills, setSkills] = useState<Skill[]>([]);
  const [skillView, setSkillView] = useState<SkillViewState | null>(null);
  const [skillsMeta, setSkillsMeta] = useState<SkillsMeta>({});
  const [skillsRefreshing, setSkillsRefreshing] = useState(false);

  /* ------------------------- knowledge ----------------------------- */
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

  /* ------------------------- verification -------------------------- */
  const [verification, setVerification] = useState<VerificationState | null>(null);
  const [vRunId, setVRunId] = useState<string | null>(null);
  const [vRun, setVRun] = useState<VRunDetail | null>(null);
  const [vBusy, setVBusy] = useState(false);
  const [vError, setVError] = useState<string | null>(null);
  const [vConfirm, setVConfirm] = useState<string | null>(null);
  const vConfirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const vRunIdRef = useRef<string | null>(null);
  useEffect(() => { vRunIdRef.current = vRunId; }, [vRunId]);

  /* ------------------------- raw events ---------------------------- */
  const [rawEvents, setRawEvents] = useState<{ name: string; data: string; ts: number }[]>([]);

  const socketRef = useRef<Socket | null>(null);

  /* Reconnect kit — this page's own URL is the aiCodeAgent.serverUrl value. */
  const [pageUrl, setPageUrl] = useState('');
  useEffect(() => {
    try {
      const u = new URL(window.location.href);
      setPageUrl(u.origin + (u.pathname !== '/' ? u.pathname.replace(/\/+$/, '') : ''));
    } catch { /* ignore */ }
  }, []);

  const pairedRef = useRef(false);

  /* ------------------------- view routing -------------------------- */
  const [view, setView] = useState<ViewId>('overview');
  useEffect(() => {
    const applyHash = () => {
      const h = window.location.hash.replace('#', '') as ViewId;
      if (VIEW_IDS.includes(h)) setView(h);
    };
    applyHash();
    window.addEventListener('hashchange', applyHash);
    return () => window.removeEventListener('hashchange', applyHash);
  }, []);
  useEffect(() => {
    document.title = `Bridge · ${NAV_TITLES[view]}`;
  }, [view]);
  const goTo = useCallback((v: ViewId) => {
    setView(v);
    try { history.replaceState(null, '', `#${v}`); } catch { /* ignore */ }
    window.scrollTo({ top: 0 });
  }, []);

  /* ---------------------------------------------------------------- */
  /* Socket wiring                                                     */
  /* ---------------------------------------------------------------- */
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

  /* Open a file and jump to the Workspace view (used by verification evidence). */
  const openFileInWorkspace = (path: string) => {
    readFile(path);
    goTo('workspace');
  };

  const clearActivity = () => socketRef.current?.emit('activity:clear');

  const toggleEntry = (id: string) => {
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  /* ---------------------------------------------------------------- */
  /* Skills                                                            */
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

  const selectSkillFile = (path: string) => {
    setSkillView((v) => (v ? { ...v, activeFile: path } : v));
  };

  /* ---------------------------------------------------------------- */
  /* Knowledge                                                         */
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

  /* ---------------------------------------------------------------- */
  /* Verification — owner actions (start / cancel / feedback)           */
  /* Execution begins only when the owner reviews the plan and presses  */
  /* Start.                                                             */
  /* ---------------------------------------------------------------- */
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

  /* nav badge counts */
  const navCounts: Partial<Record<ViewId, number>> = {
    activity: entries.length,
    knowledge: knowledgeTotal,
    skills: skills.length,
  };

  /* ---------------------------------------------------------------- */
  /* Render                                                            */
  /* ---------------------------------------------------------------- */
  return (
    <div className="min-h-screen text-vs-text">
      <div className="flex">
        {/* Sidebar (desktop) */}
        <aside className="hidden lg:flex w-60 flex-none flex-col sticky top-0 h-screen bg-sidebar border-r border-vs-border">
          {/* brand */}
          <div className="flex items-center gap-3 px-4 h-16 border-b border-vs-border/70 flex-none">
            <div className="size-9 rounded-xl bg-gradient-to-br from-emerald-400 to-teal-600 ring-1 ring-emerald-300/30 shadow-[0_0_18px_-4px_rgba(16,185,129,0.55)] grid place-items-center flex-none">
              <Zap className="size-4 text-[#03231a]" strokeWidth={2.5} />
            </div>
            <div className="min-w-0">
              <div className="text-[13px] font-semibold text-vs-bright leading-tight truncate tracking-tight">Workspace Bridge</div>
              <div className="text-[10px] text-vs-faint leading-tight tracking-wide">z.ai observatory</div>
            </div>
          </div>

          {/* nav */}
          <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-5">
            {NAV_SECTIONS.map((section) => (
              <div key={section.label}>
                <div className="px-3 pb-2 text-[10px] uppercase tracking-[0.14em] text-vs-faint">{section.label}</div>
                <div className="space-y-1">
                  {section.items.map((item) => (
                    <button
                      key={item.id}
                      suppressHydrationWarning
                      onClick={() => goTo(item.id)}
                      className={cn(
                        'group w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] transition-all duration-150',
                        view === item.id
                          ? 'bg-vs-active text-white font-medium shadow-[inset_0_0_0_1px_rgba(16,185,129,0.28),0_0_16px_-6px_rgba(16,185,129,0.4)]'
                          : 'text-vs-dim hover:bg-vs-hover hover:text-vs-text'
                      )}
                      aria-current={view === item.id ? 'page' : undefined}
                    >
                      <span className={cn('flex-none transition-colors', view === item.id ? 'text-vs-blue-bright' : 'group-hover:text-vs-text')}>{item.icon}</span>
                      <span className="flex-1 text-left truncate">{item.label}</span>
                      {(navCounts[item.id] ?? 0) > 0 && (
                        <span className={cn('text-[10px] font-mono flex-none tabular-nums', view === item.id ? 'text-emerald-100/80' : 'text-vs-faint')}>{navCounts[item.id]}</span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </nav>

          {/* connection status */}
          <div className="flex-none px-3 pb-3">
            <div className="rounded-xl border border-vs-border bg-vs-bg/60 px-3.5 py-3 space-y-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]">
              <div className="flex items-center gap-2.5 min-w-0" title={`bridge service ${svcUp ? 'online' : 'offline'}`}>
                <Dot tone={svcUp ? 'green' : 'red'} />
                <span className="text-[11px] text-vs-dim flex-1 truncate">service</span>
                <span className={`text-[11px] flex-none ${svcUp ? 'text-vs-green' : 'text-vs-red'}`}>{svcUp ? 'online' : 'offline'}</span>
              </div>
              <div className="flex items-center gap-2.5 min-w-0" title={wsOnline ? status.workspaceName ?? 'workspace online' : 'workspace offline'}>
                <Dot tone={wsOnline ? 'green' : 'yellow'} />
                <span className="text-[11px] text-vs-dim flex-1 truncate">workspace</span>
                <span className={`text-[11px] flex-none truncate max-w-[7rem] ${wsOnline ? 'text-vs-text' : 'text-vs-yellow'}`}>
                  {wsOnline ? status.workspaceName ?? 'online' : 'offline'}
                </span>
              </div>
              <div className="flex items-center gap-2.5 min-w-0">
                <Dot tone={paired ? 'green' : 'dim'} />
                <span className="text-[11px] text-vs-dim flex-1 truncate">browser</span>
                <span className={`text-[11px] flex-none ${paired ? 'text-vs-green' : 'text-vs-faint'}`}>{paired ? 'paired' : 'unpaired'}</span>
              </div>
            </div>
          </div>
        </aside>

        {/* Main column */}
        <div className="flex-1 min-w-0 flex flex-col min-h-screen">
          {/* Mobile header */}
          <header className="lg:hidden sticky top-0 z-30 bg-sidebar/95 backdrop-blur border-b border-vs-border flex-none">
            <div className="flex items-center gap-2.5 px-4 h-12">
              <div className="size-7 rounded-lg bg-gradient-to-br from-emerald-400 to-teal-600 ring-1 ring-emerald-300/30 grid place-items-center flex-none">
                <Zap className="size-3.5 text-[#03231a]" strokeWidth={2.5} />
              </div>
              <span className="text-[13px] font-semibold text-vs-bright truncate tracking-tight">Workspace Bridge</span>
              <div className="flex-1" />
              <Dot tone={svcUp ? 'green' : 'red'} className="size-1.5" />
              <Dot tone={wsOnline ? 'green' : 'yellow'} className="size-1.5" />
              {paired && (
                <Badge variant="outline" className="border-vs-green/40 text-vs-green text-[10px] px-1.5">paired</Badge>
              )}
            </div>
            <nav className="relative flex gap-1 px-3 pb-2 overflow-x-auto" aria-label="Views">
              {NAV_SECTIONS.flatMap((s) => s.items).map((item) => (
                <button
                  key={item.id}
                  suppressHydrationWarning
                  onClick={() => goTo(item.id)}
                  className={cn(
                    'flex-none flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs whitespace-nowrap transition-colors',
                    view === item.id ? 'bg-vs-active text-white font-medium shadow-[inset_0_0_0_1px_rgba(16,185,129,0.28)]' : 'text-vs-dim hover:bg-vs-hover hover:text-vs-text'
                  )}
                  aria-current={view === item.id ? 'page' : undefined}
                >
                  <span className={cn('flex-none -ml-0.5', view === item.id ? 'text-vs-blue-bright' : '')}>{item.icon}</span>
                  {item.label}
                  {(navCounts[item.id] ?? 0) > 0 && (
                    <span className="text-[10px] font-mono opacity-70">{navCounts[item.id]}</span>
                  )}
                </button>
              ))}
              {/* scroll affordance — fades the strip's right edge */}
              <span aria-hidden className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-sidebar to-transparent" />
            </nav>
          </header>

          {/* Content */}
          <main className="flex-1 w-full max-w-[1400px] mx-auto px-4 sm:px-6 py-5 min-w-0">
            {view === 'overview' && (
              <OverviewView
                paired={paired}
                svcUp={svcUp}
                wsOnline={wsOnline}
                status={status}
                tree={tree}
                skills={skills}
                knowledge={knowledge}
                verification={verification}
                stats={stats}
                feed={feed}
                onGoTo={goTo}
                pairInput={pairInput}
                onPairInputChange={setPairInput}
                onPair={pair}
                onPasteAndPair={pasteAndPair}
                pairingNote={pairingNote}
              />
            )}

            {view === 'activity' && (
              <ActivityView
                paired={paired}
                feed={feed}
                feedFilter={feedFilter}
                onFilterChange={setFeedFilter}
                openIds={openIds}
                onToggleEntry={toggleEntry}
                onClear={clearActivity}
                rawEvents={rawEvents}
                onClearRaw={() => setRawEvents([])}
              />
            )}

            {view === 'workspace' && (
              <WorkspaceView
                paired={paired}
                wsOnline={wsOnline}
                tree={tree}
                treeLoading={treeLoading}
                filter={filter}
                onFilterChange={setFilter}
                onRefresh={refreshTree}
                rows={rows}
                expandedPaths={expanded}
                onToggleDir={toggleDir}
                onOpenFile={readFile}
                fileView={fileView}
                onCloseFile={() => setFileView(null)}
                totalFlatHits={totalFlatHits}
                showAllFlat={showAllFlat}
                onShowAllFlat={setShowAllFlat}
                onCollapseAll={() => setExpanded(new Set(['']))}
                workspaceName={status.workspaceName}
              />
            )}

            {view === 'knowledge' && (
              <KnowledgeView
                paired={paired}
                knowledge={knowledge}
                refreshing={knowledgeRefreshing}
                onRefresh={refreshKnowledge}
                search={knowledgeSearch}
                onSearchChange={setKnowledgeSearch}
                scope={knowledgeScope}
                onScopeChange={setKnowledgeScope}
                statusFilter={knowledgeStatusFilter}
                onStatusFilterChange={setKnowledgeStatusFilter}
                category={knowledgeCategory}
                onCategoryChange={setKnowledgeCategory}
                records={knowledgeRecords}
                categories={knowledgeCategories}
                counts={knowledgeCounts}
                total={knowledgeTotal}
                empty={knowledgeEmpty}
                selected={selectedKnowledge}
                activeVersion={activeKnowledgeVersion}
                selectedVersions={selectedKnowledgeVersions}
                feedback={selectedKnowledgeFeedback}
                onSelect={selectKnowledge}
                versionsOpen={knowledgeVersionsOpen}
                onVersionsOpenChange={setKnowledgeVersionsOpen}
                openVersions={knowledgeOpenVersions}
                onToggleVersion={toggleKnowledgeVersion}
                attemptsOpen={knowledgeAttemptsOpen}
                onAttemptsOpenChange={setKnowledgeAttemptsOpen}
                auditOpen={knowledgeAuditOpen}
                onAuditOpenChange={setKnowledgeAuditOpen}
                confirm={knowledgeConfirm}
                actionError={knowledgeActionError}
                onAction={runKnowledgeAction}
                recordRuns={recordRuns}
                vRunId={vRunId}
                onSelectVRun={selectVRun}
                vRun={vRun}
                vBusy={vBusy}
                vError={vError}
                vConfirm={vConfirm}
                onVStart={(runId, dangerous) => runVAction('start', runId, dangerous)}
                onVCancel={(runId) => runVAction('cancel', runId)}
                onVFeedback={sendVFeedback}
                onOpenFile={openFileInWorkspace}
                verificationTotal={verification?.counts?.total ?? 0}
              />
            )}

            {view === 'skills' && (
              <SkillsView
                paired={paired}
                wsOnline={wsOnline}
                skills={skills}
                skillsMeta={skillsMeta}
                refreshing={skillsRefreshing}
                onRefresh={refreshSkills}
                skillView={skillView}
                onClose={() => setSkillView(null)}
                onOpen={openSkill}
                onSelectFile={selectSkillFile}
              />
            )}

            {view === 'setup' && (
              <SetupView
                paired={paired}
                svcUp={svcUp}
                wsOnline={wsOnline}
                status={status}
                pageUrl={pageUrl}
                pairInput={pairInput}
                onPairInputChange={setPairInput}
                onPair={pair}
                onPasteAndPair={pasteAndPair}
                pairingNote={pairingNote}
              />
            )}
          </main>

          {/* Status bar — quiet glass observability strip */}
          <footer className="mt-auto border-t border-vs-border bg-[#0b0e11]/90 backdrop-blur text-[10.5px] font-mono text-vs-dim min-h-8 px-3 py-1.5 pb-[max(0.375rem,env(safe-area-inset-bottom))] flex items-center gap-4 overflow-hidden whitespace-nowrap select-none">
            <span className="flex items-center gap-1.5 shrink-0">
              <Zap className="size-3 text-vs-blue-bright" />
              <span className="hidden sm:inline text-vs-text">workspace bridge</span>
            </span>
            <span className="flex items-center gap-1.5 shrink-0">
              <Dot tone={svcUp ? 'green' : 'dim'} className="size-1.5" />
              {svcUp ? <span className="text-vs-green">service online</span> : 'service offline'}
            </span>
            <span className="flex items-center gap-1.5 shrink-0">
              <Dot tone={wsOnline ? 'green' : 'yellow'} className="size-1.5" />
              {wsOnline ? <span className="text-vs-text">{status.workspaceName ?? 'workspace'}</span> : 'workspace offline'}
            </span>
            {paired && <span className="shrink-0 hidden sm:inline text-vs-green">paired</span>}
            <span className="flex-1" />
            {tree?.stats && <span className="shrink-0 hidden md:inline tabular-nums">{tree.stats.files.toLocaleString()} files</span>}
            {skills.length > 0 && (
              <span className="shrink-0 hidden md:inline tabular-nums">{skills.length} skills</span>
            )}
            {(knowledge?.counts?.verified ?? 0) > 0 && (
              <span className="shrink-0 hidden md:inline tabular-nums">{knowledge?.counts?.verified} verified</span>
            )}
            <span className="shrink-0 hidden md:inline tabular-nums">{entries.length} events</span>
            {tree?.stats?.scannedAt && <span className="shrink-0 hidden lg:inline">scan {timeStr(new Date(tree.stats.scannedAt).getTime())}</span>}
          </footer>
        </div>
      </div>
    </div>
  );
}
