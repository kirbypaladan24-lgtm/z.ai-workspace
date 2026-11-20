'use client';

/* ------------------------------------------------------------------ */
/* Overview — the landing view: health, numbers, recent activity       */
/* and quick links into the rest of the dashboard.                     */
/* ------------------------------------------------------------------ */

import {
  Gauge, TerminalSquare, FolderOpen, Brain, GraduationCap, Settings,
  Eye, PencilLine, Pencil, Trash2, HardDrive, Zap, WifiOff, CheckCircle2,
  Link2, ArrowRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ActivityEntry, KnowledgeState, Skill, SvcStatus, TreePayload, VerificationState, ViewId } from './types';
import { fmtBytes } from './types';
import { StatCard } from './bits';
import { RecentActivity } from './activity';
import { PairCard, StatusCard } from './setup';

export function OverviewView({
  paired, svcUp, wsOnline, status, tree, skills, knowledge, verification,
  stats, feed, onGoTo,
  pairInput, onPairInputChange, onPair, onPasteAndPair, pairingNote,
}: {
  paired: boolean;
  svcUp: boolean;
  wsOnline: boolean;
  status: SvcStatus;
  tree: TreePayload | null;
  skills: Skill[];
  knowledge: KnowledgeState | null;
  verification: VerificationState | null;
  stats: { reads: number; writes: number; edits: number; deletes: number; notes: number; localEvents: number };
  feed: ActivityEntry[];
  onGoTo: (v: ViewId) => void;
  pairInput: string;
  onPairInputChange: (v: string) => void;
  onPair: (code: string) => void;
  onPasteAndPair: () => void;
  pairingNote: string | null;
}) {
  const kCounts = knowledge?.counts;
  const kTotal = kCounts
    ? (kCounts.verified ?? 0) + (kCounts.candidate ?? 0) + (kCounts.verificationPending ?? 0)
      + (kCounts.rejected ?? 0) + (kCounts.deprecated ?? 0) + (kCounts.archived ?? 0)
    : 0;

  const quickLinks: { id: ViewId; label: string; desc: string; icon: React.ReactNode; count: string; accent: string }[] = [
    { id: 'workspace', label: 'Workspace', desc: 'Browse every file, preview contents', icon: <FolderOpen className="size-4" />, count: tree?.stats ? `${tree.stats.files.toLocaleString()} files` : 'not scanned yet', accent: 'text-vs-folder' },
    { id: 'knowledge', label: 'Knowledge', desc: 'Verification-gated experience library', icon: <Brain className="size-4" />, count: kTotal ? `${kTotal} records` : 'no records yet', accent: 'text-vs-teal' },
    { id: 'skills', label: 'Skills', desc: 'Documents GLM reads before every task', icon: <GraduationCap className="size-4" />, count: skills.length ? `${skills.length} skill${skills.length === 1 ? '' : 's'}` : 'none yet', accent: 'text-vs-purple' },
    { id: 'setup', label: 'Setup', desc: 'Pairing, reconnect kit, how it works', icon: <Settings className="size-4" />, count: paired ? 'browser paired' : 'needs pairing', accent: 'text-vs-dim' },
  ];

  return (
    <div className="space-y-4">
      {/* pairing hero — the first-run experience */}
      {!paired && (
        <PairCard
          pairInput={pairInput}
          onPairInputChange={onPairInputChange}
          onPair={onPair}
          onPasteAndPair={onPasteAndPair}
          pairingNote={pairingNote}
          onGoToGuide={() => onGoTo('setup')}
        />
      )}

      {/* workspace offline notice */}
      {paired && !wsOnline && (
        <button
          suppressHydrationWarning
          onClick={() => onGoTo('setup')}
          className="w-full rounded-xl border border-vs-yellow/30 bg-vs-yellow/[0.06] px-4 py-3 flex items-center gap-3 text-left hover:bg-vs-yellow/10 transition-colors"
        >
          <WifiOff className="size-4 text-vs-yellow flex-none" />
          <span className="text-xs text-vs-text flex-1 min-w-0">
            Workspace offline — open VS Code with the AI Code Agent extension connected, or connect your Roblox Studio game via the bridge plugin (Setup → Roblox Studio bridge). The reconnect kit has everything for a new machine.
          </span>
          <ArrowRight className="size-3.5 text-vs-yellow flex-none" />
        </button>
      )}

      {/* health */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <StatusCard
          label="bridge service" value={svcUp ? 'online' : 'offline'} sub={svcUp ? 'agent-service reachable' : 'auto-reviving…'}
          tone={svcUp ? 'green' : 'red'} icon={<Zap className="size-4" />}
        />
        <StatusCard
          label="vs code workspace" value={wsOnline ? status.workspaceName ?? 'connected' : 'offline'}
          sub={wsOnline ? 'AI Code Agent connected' : 'waiting for the extension'}
          tone={wsOnline ? 'green' : 'yellow'} icon={<TerminalSquare className="size-4" />}
        />
        <StatusCard
          label="this browser" value={paired ? 'paired' : 'not paired'} sub={paired ? 'full access unlocked' : 'enter the pairing code above'}
          tone={paired ? 'green' : 'dim'} icon={paired ? <CheckCircle2 className="size-4" /> : <Link2 className="size-4" />}
          onClick={!paired ? () => onGoTo('setup') : undefined}
        />
        <StatusCard
          label="workspace scan" value={tree?.stats ? `${tree.stats.files.toLocaleString()} files` : '—'}
          sub={tree?.stats ? `${tree.stats.dirs.toLocaleString()} folders · ${fmtBytes(tree.stats.totalBytes)}` : 'no scan yet'}
          tone={tree?.stats ? 'green' : 'dim'} icon={<HardDrive className="size-4" />}
          onClick={() => onGoTo('workspace')}
        />
      </div>

      {/* numbers */}
      <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 gap-3">
        <StatCard icon={<Eye className="size-4" />} label="AI reads" value={String(stats.reads)} sub="by GLM" accent="text-vs-var" />
        <StatCard icon={<PencilLine className="size-4" />} label="AI writes" value={String(stats.writes)} sub="by GLM" accent="text-vs-green" />
        <StatCard icon={<Pencil className="size-4" />} label="AI edits" value={String(stats.edits)} sub="by GLM" accent="text-vs-tan" />
        <StatCard icon={<Trash2 className="size-4" />} label="AI deletes" value={String(stats.deletes)} sub="by GLM" accent="text-vs-red" />
        <StatCard icon={<GraduationCap className="size-4" />} label="skills" value={String(skills.length)} sub="in .skills/" accent="text-vs-purple" />
        <StatCard icon={<Brain className="size-4" />} label="knowledge" value={String(kTotal)} sub={kCounts?.verified ? `${kCounts.verified} verified` : 'records'} accent="text-vs-teal" />
        <StatCard icon={<Gauge className="size-4" />} label="verif. runs" value={String(verification?.counts?.total ?? 0)} sub="scientific" accent="text-vs-blue-bright" />
        <StatCard icon={<Zap className="size-4" />} label="events" value={String(feed.length)} sub="this session" />
      </div>

      {/* recent activity + quick links */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-stretch">
        <div className="lg:col-span-7 min-w-0 flex">
          <RecentActivity feed={feed} onGoToActivity={() => onGoTo('activity')} />
        </div>
        <div className="lg:col-span-5 grid grid-cols-1 sm:grid-cols-2 gap-3 auto-rows-fr">
          {quickLinks.map((q) => (
            <button
              key={q.id}
              suppressHydrationWarning
              onClick={() => onGoTo(q.id)}
              className="rounded-xl border border-vs-border bg-vs-panel px-4 py-3.5 text-left hover:bg-vs-hover hover:border-vs-border-2 transition-colors min-w-0 h-full flex flex-col"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <span className={cn('flex-none', q.accent)}>{q.icon}</span>
                <span className="text-xs font-medium text-vs-bright truncate flex-1">{q.label}</span>
                <ArrowRight className="size-3.5 text-vs-faint flex-none" />
              </div>
              <div className="text-[11px] text-vs-dim mt-2 leading-relaxed flex-1">{q.desc}</div>
              <div className="text-[10.5px] font-mono text-vs-faint mt-1.5">{q.count}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
