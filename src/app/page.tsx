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
  BookOpen, GraduationCap, AlertTriangle,
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
  kind: 'tool' | 'note' | 'fs' | 'conn' | 'skill';
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

  const [rawEvents, setRawEvents] = useState<{ name: string; data: string; ts: number }[]>([]);
  const [showRaw, setShowRaw] = useState(false);

  const socketRef = useRef<Socket | null>(null);
  const rawRef = useRef<HTMLDivElement>(null);
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
        : feedFilter === 'ai' ? (e.kind === 'tool' && e.source !== 'system') || e.kind === 'note' || e.kind === 'skill'
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
                  <li>Install the <span className="text-vs-bright">AI Code Agent</span> extension (v0.4.0+) in VS Code.</li>
                  <li>Command palette → <span className="font-mono text-vs-text">AI Agent: Connect to Z.ai Server</span> → paste this page&apos;s URL.</li>
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
      <footer className="mt-auto sticky bottom-0 z-20 bg-vs-blue text-white text-[10.5px] font-mono h-6 px-3 flex items-center gap-4 overflow-hidden whitespace-nowrap select-none">
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
          <span className="shrink-0 hidden md:inline flex items-center gap-1.5">
            <GraduationCap className="size-3" />
            {skills.length} skills in .skills/
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

function FeedChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      suppressHydrationWarning
      onClick={onClick}
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
