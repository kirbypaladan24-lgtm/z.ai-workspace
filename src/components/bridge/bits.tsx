'use client';

/* ------------------------------------------------------------------ */
/* Small shared UI primitives for the bridge dashboard.                */
/* "Obsidian & Emerald" identity — layered graphite, one jewel accent. */
/* ------------------------------------------------------------------ */

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  CheckCircle2, Copy, ChevronRight, ChevronDown, ShieldCheck,
  FileText, FileCode, FileJson, FileImage, FileArchive, File,
} from 'lucide-react';
import { cn } from '@/lib/utils';

/* Status dot — the quiet heartbeat of the dashboard. */
export function Dot({ tone, className }: { tone: 'green' | 'red' | 'yellow' | 'dim' | 'blue'; className?: string }) {
  const bg = tone === 'green' ? 'bg-vs-green' : tone === 'red' ? 'bg-vs-red' : tone === 'yellow' ? 'bg-vs-yellow' : tone === 'blue' ? 'bg-vs-blue-bright' : 'bg-vs-faint';
  const glow = tone === 'green' ? 'shadow-[0_0_5px_rgba(52,211,153,0.65)]' : tone === 'red' ? 'shadow-[0_0_5px_rgba(248,113,113,0.65)]' : '';
  return <span className={cn('size-2 rounded-full inline-block flex-none', bg, glow, className)} aria-hidden />;
}

/* Panel — the one card style used everywhere. */
export function Panel({ children, className, testId }: { children: React.ReactNode; className?: string; testId?: string }) {
  return (
    <section
      className={cn('rounded-xl border border-vs-border bg-vs-panel overflow-hidden shadow-[inset_0_1px_0_rgba(255,255,255,0.025)]', className)}
      data-testid={testId}
    >
      {children}
    </section>
  );
}

export function PanelHeader({ icon, title, children, className }: {
  icon?: React.ReactNode;
  title: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex items-center gap-2.5 px-4 py-3 border-b border-vs-border/70 flex-wrap', className)}>
      {icon ? <span className="flex-none">{icon}</span> : null}
      <h2 className="text-[13px] font-medium text-vs-bright flex items-center gap-2 min-w-0">{title}</h2>
      <div className="flex-1" />
      {children}
    </div>
  );
}

export function PanelBody({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('p-4', className)}>{children}</div>;
}

/* ViewHeader — title + subtitle + actions strip above each view. */
export function ViewHeader({ title, sub, children }: { title: string; sub: string; children?: React.ReactNode }) {
  return (
    <div className="flex items-start gap-4 flex-wrap mb-6">
      <div className="min-w-0">
        <h1 className="text-lg font-semibold text-vs-bright leading-tight tracking-tight">{title}</h1>
        <p className="text-xs text-vs-dim mt-1.5 leading-relaxed">{sub}</p>
      </div>
      <div className="flex-1" />
      {children ? <div className="flex items-center gap-2 flex-wrap">{children}</div> : null}
    </div>
  );
}

/* StatCard — icon + big value + label, for dashboards. */
export function StatCard({ icon, label, value, sub, accent, testId }: {
  icon: React.ReactNode; label: string; value: string; sub?: string; accent?: string; testId?: string;
}) {
  return (
    <div
      className="rounded-xl border border-vs-border bg-vs-panel px-4 py-3.5 min-w-0 shadow-[inset_0_1px_0_rgba(255,255,255,0.025)] transition-colors hover:border-vs-border-2"
      data-testid={testId}
    >
      <div className="flex items-center gap-2 text-vs-dim">
        <span className={cn('flex-none', accent)}>{icon}</span>
        <span className="text-[11px] uppercase tracking-wide truncate">{label}</span>
      </div>
      <div className={cn('mt-2 text-lg font-mono font-semibold leading-none tabular-nums', accent ?? 'text-vs-bright')}>{value}</div>
      {sub ? <div className="text-[11px] text-vs-faint mt-1.5 truncate">{sub}</div> : null}
    </div>
  );
}

/* StatTile — compact value + label chip, for stat strips. */
export function StatTile({ value, label, accent, testId, title }: {
  value: string | number; label: string; accent?: string; testId?: string; title?: string;
}) {
  return (
    <div className="rounded-lg border border-vs-border bg-vs-panel px-3 py-2 min-w-0 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]" data-testid={testId} title={title}>
      <div className={cn('text-sm font-mono font-semibold leading-none tabular-nums', accent ?? 'text-vs-bright')}>{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-vs-dim mt-1.5 truncate">{label}</div>
    </div>
  );
}

/* CopyField — value in a mono box with a copy button + feedback. */
export function CopyField({ label, value }: { label?: string; value: string }) {
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
      <div className="flex items-center gap-2 bg-vs-bg/80 border border-vs-border rounded-lg px-3 py-2 min-w-0 focus-within:border-vs-blue/40 transition-colors">
        <span className="text-xs font-mono truncate flex-1 text-vs-text" title={value}>{value}</span>
        <Button onClick={copy} variant="ghost" size="sm" className="h-6 px-1.5 flex-none text-vs-dim" title="Copy">
          {copied ? <CheckCircle2 className="size-3.5 text-vs-green" /> : <Copy className="size-3.5" />}
        </Button>
      </div>
    </div>
  );
}

/* EmptyState — icon + message, shown instead of lonely blank space. */
export function EmptyState({ icon, title, hint, className, testId }: {
  icon?: React.ReactNode; title: string; hint?: string; className?: string; testId?: string;
}) {
  return (
    <div className={cn('py-12 text-center text-vs-dim', className)} data-testid={testId}>
      <div className="mx-auto mb-3 size-11 rounded-xl bg-vs-panel-2 border border-vs-border grid place-items-center text-vs-faint shadow-[inset_0_1px_0_rgba(255,255,255,0.025)]">
        {icon ?? <File className="size-5" />}
      </div>
      <p className="text-xs text-vs-text">{title}</p>
      {hint ? <p className="text-[11px] text-vs-dim mt-1.5 max-w-sm mx-auto leading-relaxed">{hint}</p> : null}
    </div>
  );
}

/* LockedPanel — shown when pairing is required. */
export function LockedPanel({ text, icon }: { text: string; icon?: React.ReactNode }) {
  return <EmptyState icon={icon ?? <ShieldCheck className="size-5" />} title={text} className="py-16" />;
}

/* FeedChip — filter pill used on feeds and libraries. */
export function FeedChip({ active, onClick, children, testId }: {
  active: boolean; onClick: () => void; children: React.ReactNode; testId?: string;
}) {
  return (
    <button
      suppressHydrationWarning
      onClick={onClick}
      data-testid={testId}
      className={cn(
        'text-[11px] px-2.5 py-1 rounded-md border font-medium transition-colors',
        active
          ? 'bg-vs-active border-vs-blue/50 text-white'
          : 'border-vs-border-2 text-vs-dim hover:text-vs-text hover:bg-vs-hover'
      )}
    >
      {children}
    </button>
  );
}

/* SubToggle — collapsible section header with chevron + label + counter. */
export function SubToggle({ open, onClick, children, testId, ariaControls }: {
  open: boolean; onClick: () => void; children: React.ReactNode; testId?: string; ariaControls?: string;
}) {
  return (
    <button
      suppressHydrationWarning
      onClick={onClick}
      aria-expanded={open}
      aria-controls={ariaControls}
      data-testid={testId}
      className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-vs-dim hover:text-vs-text transition-colors"
    >
      {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
      {children}
    </button>
  );
}

/* FileIconFor — icon tinted by file extension, VS Code style. */
export function FileIconFor({ name }: { name: string }) {
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

/* Reusable tiny badge used for counts and scopes. */
export function CountBadge({ children, className, title, testId }: { children: React.ReactNode; className?: string; title?: string; testId?: string }) {
  return (
    <Badge variant="outline" className={cn('border-vs-border-2 text-vs-dim text-[10px] font-mono', className)} title={title} data-testid={testId}>
      {children}
    </Badge>
  );
}
