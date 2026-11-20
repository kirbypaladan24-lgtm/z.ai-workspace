'use client';

/* ------------------------------------------------------------------ */
/* Activity — the live feed of every AI action on the workspace,       */
/* plus the raw socket-event console underneath.                       */
/* ------------------------------------------------------------------ */

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Activity, ChevronRight, ChevronDown, Eye, Pencil, PencilLine, Trash2, ArrowRightLeft,
  FolderPlus, List, Search, TerminalSquare, Stethoscope, Bot, MessageSquareQuote,
  Server, GraduationCap, CheckCircle2, XCircle, BookOpen, Brain, FlaskConical,
  Play, Square, FileText, Loader2, ListFilter, Trash, WifiOff,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ActivityEntry, FeedFilter } from './types';
import { fmtBytes, timeStr, shortActor } from './types';
import { EmptyState, FeedChip, LockedPanel, Panel, ViewHeader, SubToggle } from './bits';

/* One feed entry: header row + expandable diff/args/result. */
export function ActivityRow({ e, open, onToggle }: { e: ActivityEntry; open: boolean; onToggle: () => void }) {
  const pending = (e as any).pending === true;
  const isAiTool = e.kind === 'tool' && e.source !== 'system';
  const isNote = e.kind === 'note';
  const isLocal = e.source === 'local';

  const icon = (() => {
    if (isNote) return <MessageSquareQuote className="size-4 text-vs-purple" />;
    if (e.kind === 'fs') {
      if (e.fsType === 'created') return <PencilLine className="size-4 text-vs-green" />;
      if (e.fsType === 'deleted') return <Trash2 className="size-4 text-vs-red" />;
      return <Pencil className="size-4 text-vs-tan" />;
    }
    if (e.kind === 'conn') return <Server className="size-4 text-vs-dim" />;
    if (e.kind === 'skill') {
      if (e.tool === 'skill:scan') return <GraduationCap className="size-4 text-vs-purple" />;
      if (e.tool === 'skill:review') return <CheckCircle2 className="size-4 text-vs-green" />;
      if (e.tool === 'skill:delete' || e.tool === 'skill:clear') return <Trash2 className="size-4 text-vs-red" />;
      return <BookOpen className="size-4 text-vs-purple" />;
    }
    if (e.kind === 'knowledge') {
      if (e.tool === 'knowledge:verify') return <FlaskConical className="size-4 text-vs-teal" />;
      if (e.tool === 'knowledge:preflight' || e.tool === 'knowledge:search') return <Search className="size-4 text-vs-teal" />;
      if (e.tool === 'knowledge:submit' || e.tool === 'knowledge:propose') return <Brain className="size-4 text-vs-purple" />;
      if (e.tool === 'knowledge:attempt') return <XCircle className="size-4 text-vs-red" />;
      return <Brain className="size-4 text-vs-teal" />;
    }
    if (e.kind === 'verification') {
      if (e.tool === 'verification:test') return <FlaskConical className="size-4 text-vs-teal" />;
      if (e.tool === 'verification:start') return <Play className="size-4 text-vs-green" />;
      if (e.tool === 'verification:cancel') return <Square className="size-4 text-vs-red" />;
      if (e.tool === 'verification:report') return <FileText className="size-4 text-vs-blue-bright" />;
      return <FlaskConical className="size-4 text-vs-purple" />;
    }
    switch (e.tool) {
      case 'write_file': return <PencilLine className="size-4 text-vs-green" />;
      case 'edit_file': return <Pencil className="size-4 text-vs-tan" />;
      case 'delete_file': return <Trash2 className="size-4 text-vs-red" />;
      case 'move_path': return <ArrowRightLeft className="size-4 text-vs-purple" />;
      case 'create_directory': return <FolderPlus className="size-4 text-vs-yellow" />;
      case 'read_file': return <Eye className="size-4 text-vs-var" />;
      case 'list_files': return <List className="size-4 text-vs-dim" />;
      case 'search_code': return <Search className="size-4 text-vs-dim" />;
      case 'run_command': return <TerminalSquare className="size-4 text-vs-orange" />;
      case 'get_diagnostics': return <Stethoscope className="size-4 text-vs-teal" />;
      default: return <Bot className="size-4 text-vs-dim" />;
    }
  })();

  const actorColor = e.source === 'operator' ? 'text-vs-purple' : e.source === 'web' ? 'text-vs-var' : e.source === 'local' ? 'text-vs-fn' : e.source === 'vscode' ? 'text-vs-teal' : 'text-vs-dim';

  const title = isNote ? 'note' : e.kind === 'fs' ? e.fsType : e.kind === 'conn' ? 'system' : e.tool ?? 'tool';
  const rawSubject = isNote ? e.text?.slice(0, 120) : e.kind === 'conn' ? e.text : e.path || '';
  // avoid echoing the tool name when an entry carries no path/text
  const subject = rawSubject && rawSubject !== title ? rawSubject : '';

  const hasDetail = !!(e.result || e.args || e.meta?.diff?.length || (e.meta && (e.meta.linesAdded !== undefined || e.meta.linesRemoved !== undefined)));

  return (
    <div
      className={cn(
        'rounded-lg border overflow-hidden transition-colors',
        e.ok === false ? 'border-vs-red/30 bg-vs-red/[0.05]' : 'border-vs-border bg-vs-bg/40',
        pending && 'opacity-75'
      )}
    >
      <button
        suppressHydrationWarning
        className="w-full px-3 py-2.5 flex items-center gap-2.5 text-left hover:bg-vs-hover/50 transition-colors"
        onClick={onToggle}
        data-testid="activity-entry"
      >
        <span className="flex-none">{pending ? <Loader2 className="size-4 animate-spin text-vs-yellow" /> : icon}</span>
        {isAiTool && !pending && (
          <span className={cn('flex-none', e.ok === false ? 'text-vs-red' : 'text-vs-green')}>
            {e.ok === false ? <XCircle className="size-3.5" /> : <CheckCircle2 className="size-3.5" />}
          </span>
        )}
        <span className="font-mono text-xs text-vs-bright flex-none">{title}</span>
        <span className="text-[11px] text-vs-dim truncate flex-1 min-w-0" title={subject}>{subject}</span>
        {isLocal && <span className="text-[9.5px] uppercase tracking-wide text-vs-fn flex-none hidden sm:inline">you</span>}
        {!isLocal && <span className={cn('text-[9.5px] uppercase tracking-wide flex-none hidden sm:inline', actorColor)}>{shortActor(e.actor)}</span>}
        {e.durMs !== undefined && <span className="text-[10px] font-mono text-vs-faint flex-none hidden md:inline">{(e.durMs / 1000).toFixed(1)}s</span>}
        <span className="text-[10px] font-mono text-vs-faint flex-none">{timeStr(e.ts)}</span>
        {hasDetail && (open
          ? <ChevronDown className="size-3.5 text-vs-faint flex-none" />
          : <ChevronRight className="size-3.5 text-vs-faint flex-none" />)}
      </button>

      {open && (
        <div className="border-t border-vs-border/70 px-3 py-2.5 space-y-2.5">
          {/* meta line: +adds / -removes / bytes */}
          {e.meta && (e.meta.linesAdded !== undefined || e.meta.linesRemoved !== undefined || e.meta.bytes !== undefined) && (
            <div className="flex items-center gap-2.5 text-[11px] font-mono flex-wrap">
              {e.meta.kind && <span className="border border-vs-border-2 rounded px-1.5 py-0.5 text-[9.5px] uppercase text-vs-dim">{e.meta.kind}</span>}
              {e.meta.linesAdded !== undefined && <span className="text-vs-green">+{e.meta.linesAdded}</span>}
              {e.meta.linesRemoved !== undefined && <span className="text-vs-red">−{e.meta.linesRemoved}</span>}
              {e.meta.bytes !== undefined && <span className="text-vs-dim">{fmtBytes(e.meta.bytes)}</span>}
              {e.meta.lines !== undefined && <span className="text-vs-dim">{e.meta.lines} lines</span>}
              {e.meta.wasDir && <span className="text-vs-dim">folder</span>}
            </div>
          )}

          {/* diff */}
          {e.meta?.diff && e.meta.diff.length > 0 && (
            <div className="rounded-lg border border-vs-border overflow-auto max-h-72 bg-vs-bg" data-testid="diff-view">
              {e.meta.diff.map((r, i) => (
                <div
                  key={i}
                  className={cn(
                    'px-2.5 py-[1.5px] font-mono text-[10.5px] whitespace-pre',
                    r.t === '+' ? 'bg-vs-green/10 text-vs-green' : r.t === '-' ? 'bg-vs-red/10 text-vs-red' : 'text-vs-dim'
                  )}
                >
                  <span className="inline-block w-3.5 select-none opacity-60">{r.t === ' ' ? ' ' : r.t}</span>{r.s}
                </div>
              ))}
            </div>
          )}

          {/* args */}
          {e.args && Object.keys(e.args).length > 0 && e.kind === 'tool' && (
            <details className="text-[11px]">
              <summary className="text-vs-dim cursor-pointer hover:text-vs-text select-none">arguments</summary>
              <pre className="mt-1.5 font-mono text-vs-dim whitespace-pre-wrap break-all">{(() => { try { return JSON.stringify(e.args, null, 2)?.slice(0, 800); } catch { return ''; } })()}</pre>
            </details>
          )}

          {/* result */}
          {e.result && (
            <pre className="font-mono text-[10.5px] text-vs-text whitespace-pre-wrap break-all max-h-56 overflow-auto bg-vs-bg border border-vs-border rounded-lg p-2.5" data-testid="tool-result">
              {e.result.slice(0, 2200) || '(empty)'}
            </pre>
          )}

          {/* full text for notes/conn */}
          {(isNote || e.kind === 'conn') && e.text && (
            <p className="text-xs text-vs-dim leading-relaxed">{e.text}</p>
          )}
        </div>
      )}
    </div>
  );
}

/* Raw socket events — a debugging console under the feed. */
export function RawEventsCard({ events, onClear }: {
  events: { name: string; data: string; ts: number }[];
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) ref.current?.scrollTo({ top: ref.current.scrollHeight });
  }, [events, open]);

  return (
    <Panel>
      <div className="flex items-center gap-2.5 px-4 py-3">
        <SubToggle open={open} onClick={() => setOpen((v) => !v)}>
          <ListFilter className="size-3.5" /> raw events
        </SubToggle>
        <span className="text-[10px] font-mono text-vs-faint border border-vs-border-2 rounded px-1.5 py-0.5">{events.length}</span>
        <div className="flex-1" />
        <button suppressHydrationWarning className="text-[11px] text-vs-dim hover:text-vs-text transition-colors" onClick={onClear}>clear</button>
      </div>
      {open && (
        <div className="px-4 pb-4">
          <div ref={ref} className="max-h-48 overflow-y-auto bg-vs-bg border border-vs-border rounded-lg p-2.5 font-mono text-[10.5px] text-vs-dim space-y-1">
            {events.length === 0 && <p className="text-center py-3">no events yet…</p>}
            {events.map((r, i) => (
              <div key={i} className="truncate">
                <span className="text-vs-faint">{timeStr(r.ts)}</span>{' '}
                <span className="text-vs-blue-bright/80">{r.name}</span>{' '}
                <span className="text-vs-dim">{r.data}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Panel>
  );
}

/* The full Activity view. */
export function ActivityView({ paired, feed, feedFilter, onFilterChange, openIds, onToggleEntry, onClear, rawEvents, onClearRaw }: {
  paired: boolean;
  feed: ActivityEntry[];
  feedFilter: FeedFilter;
  onFilterChange: (f: FeedFilter) => void;
  openIds: Set<string>;
  onToggleEntry: (id: string) => void;
  onClear: () => void;
  rawEvents: { name: string; data: string; ts: number }[];
  onClearRaw: () => void;
}) {
  return (
    <div className="space-y-4">
      <ViewHeader title="Activity" sub="Every read, write, edit, delete and command on your workspace — live, with diffs you can read.">
        {paired && (
          <Button onClick={onClear} variant="outline" size="sm" className="border-vs-border-2 text-vs-dim hover:text-vs-text h-8" title="Clear the activity log">
            <Trash className="size-3.5" /> clear
          </Button>
        )}
      </ViewHeader>

      {!paired ? (
        <Panel>
          <LockedPanel text="Pair this browser to watch every AI action on your workspace, live." />
        </Panel>
      ) : (
        <>
          <div className="flex items-center gap-1.5 flex-wrap">
            {([['all', 'All'], ['ai', 'AI'], ['you', 'You'], ['sys', 'System']] as [FeedFilter, string][]).map(([val, label]) => (
              <FeedChip key={val} active={feedFilter === val} onClick={() => onFilterChange(val)}>{label}</FeedChip>
            ))}
            <div className="flex-1" />
            <span className="text-[11px] font-mono text-vs-faint">{feed.length} events</span>
          </div>

          {feed.length === 0 ? (
            <Panel>
              <EmptyState
                icon={<Activity className="size-5" />}
                title="Nothing yet."
                hint="When GLM (or anyone) touches your workspace — reads, edits, deletions, commands — it shows up here, live, with diffs."
              />
            </Panel>
          ) : (
            <div className="space-y-2">
              {feed.map((e) => (
                <ActivityRow
                  key={e.id}
                  e={e}
                  open={openIds.has(e.id)}
                  onToggle={() => onToggleEntry(e.id)}
                />
              ))}
            </div>
          )}

          <RawEventsCard events={rawEvents} onClear={onClearRaw} />
        </>
      )}
    </div>
  );
}

/* Compact feed preview used on the Overview view. */
export function RecentActivity({ feed, onGoToActivity }: { feed: ActivityEntry[]; onGoToActivity: () => void }) {
  const recent = feed.slice(0, 6);
  return (
    <Panel className="flex flex-col min-h-0 flex-1">
      <div className="flex items-center gap-2.5 px-4 py-3 border-b border-vs-border/70">
        <Activity className="size-4 text-vs-dim flex-none" />
        <h2 className="text-[13px] font-medium text-vs-bright">Recent activity</h2>
        <div className="flex-1" />
        <button suppressHydrationWarning className="text-[11px] text-vs-blue-bright hover:underline" onClick={onGoToActivity}>
          view all →
        </button>
      </div>
      {recent.length === 0 ? (
        <EmptyState icon={<WifiOff className="size-5" />} title="No activity yet" hint="Actions from GLM and your edits appear here the moment they happen." />
      ) : (
        <div className="p-3 space-y-2 flex-1 overflow-y-auto">
          {recent.map((e) => (
            <ActivityRow key={e.id} e={e} open={false} onToggle={onGoToActivity} />
          ))}
        </div>
      )}
    </Panel>
  );
}
