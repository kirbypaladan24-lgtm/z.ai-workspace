'use client';

/* ------------------------------------------------------------------ */
/* Knowledge — the shared, verification-gated experience library,      */
/* including the scientific verification run explorer.                 */
/* ------------------------------------------------------------------ */

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Brain, RefreshCw, Loader2, Search, X, CheckCircle2, XCircle, History, Archive,
  Undo2, Trash2, FlaskConical, Play, Square, Copy, AlertTriangle, BookOpen,
  ChevronDown, ChevronRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type {
  KnowledgeState, KnowledgeCounts, KnowledgeRecord, KnowledgeVersion, KnowledgeStatusFilter,
  KnowledgeFeedback, VRunForWeb, VRunDetail, VAttempt, VTestCase,
} from './types';
import { knowledgeStatusMeta, knowledgeVerifMeta, vStatusMeta, vCaseMeta, vStepMeta, timeStr, shortWhen, shortActor } from './types';
import { CountBadge, EmptyState, FeedChip, LockedPanel, Panel, StatTile, SubToggle, ViewHeader } from './bits';

/* ------------------------------------------------------------------ */
/* Small pieces                                                        */
/* ------------------------------------------------------------------ */

function KnowledgeMetaItem({ label, title, children }: { label: string; title?: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0" title={title}>
      <span className="text-[10px] uppercase tracking-wide text-vs-faint">{label} </span>
      <span className="text-[11px] text-vs-text">{children}</span>
    </div>
  );
}

/** One knowledge version: problem / root cause / solution / env + the verification gate with its evidence. */
export function KnowledgeVersionView({ v }: { v: KnowledgeVersion }) {
  const verif = knowledgeVerifMeta(v.verificationStatus);
  const evidence = v.evidence ?? [];
  return (
    <div className="space-y-3" data-testid="knowledge-version-content">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-wide text-vs-faint mb-1">problem</div>
          <p className="text-[11px] text-vs-text leading-relaxed whitespace-pre-wrap break-words">{v.symptoms}</p>
        </div>
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-wide text-vs-faint mb-1">root cause</div>
          <p className="text-[11px] text-vs-text leading-relaxed whitespace-pre-wrap break-words">{v.rootCause}</p>
        </div>
      </div>

      <div>
        <div className="text-[10px] uppercase tracking-wide text-vs-faint mb-1">solution</div>
        <pre className="bg-vs-bg border border-vs-border rounded-lg p-3 text-[11px] font-mono max-h-60 overflow-auto whitespace-pre-wrap break-words" data-testid="knowledge-solution">
          {v.solutionSteps || '(no solution steps recorded)'}
        </pre>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5 text-[11px]">
        <div className="min-w-0"><span className="text-vs-dim">environment </span><span className="font-mono text-vs-text break-words">{v.environment}</span></div>
        <div className="min-w-0"><span className="text-vs-dim">applicable </span><span className="font-mono text-vs-text break-words">{v.applicableVersions}</span></div>
        {v.limitations ? <div className="min-w-0 sm:col-span-2"><span className="text-vs-dim">limitations </span><span className="text-vs-text">{v.limitations}</span></div> : null}
        {v.compatibilityNotes ? <div className="min-w-0 sm:col-span-2"><span className="text-vs-dim">compatibility </span><span className="text-vs-text">{v.compatibilityNotes}</span></div> : null}
        {v.changeReason ? <div className="min-w-0 sm:col-span-2"><span className="text-vs-dim">change reason </span><span className="text-vs-text">{v.changeReason}</span></div> : null}
      </div>

      {/* verification gate — real checks with real exit codes, or owner approval */}
      <div className="rounded-lg border border-vs-border bg-vs-panel-2/40 p-3 space-y-2.5" data-testid="knowledge-verification">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`font-mono text-[11px] ${verif.cls}`}>{verif.glyph}</span>
          <span className={`text-[10px] uppercase tracking-wide ${verif.cls}`}>{verif.label}</span>
          <span className="text-[11px] text-vs-dim min-w-0">{v.verificationSummary}</span>
        </div>
        {evidence.length === 0 ? (
          <p className="text-[10.5px] text-vs-faint">no verification evidence attached</p>
        ) : (
          <div className="space-y-2">
            {evidence.map((ev, i) => {
              const ec = ev.exitCode ?? null;
              const exitOk = ec === 0;
              const exitUnknown = ec === null;
              const exitCls = exitOk ? 'text-vs-green' : exitUnknown ? 'text-vs-yellow' : 'text-vs-red';
              return (
                <div key={i} className="flex items-start gap-2 min-w-0">
                  <span className={`font-mono text-[11px] flex-none ${exitCls}`} title={exitUnknown ? 'no exit code recorded' : `exit code ${ec}`}>{exitOk ? '✓' : exitUnknown ? '?' : '✗'}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      {ev.command && <span className="font-mono text-[10.5px] text-vs-text truncate max-w-[24rem]" title={ev.command}>{ev.command}</span>}
                      {!exitOk && !exitUnknown && <span className={`font-mono text-[10px] ${exitCls}`}>exit {ec}</span>}
                      {ev.timedOut && <span className="text-[10px] text-vs-yellow">timed out</span>}
                      {ev.journalRef && <CountBadge className="text-vs-faint" title={ev.journalRef}>{ev.journalRef}</CountBadge>}
                      <span className="text-[10px] font-mono text-vs-faint">{timeStr(ev.ts)}</span>
                      <span className="text-[10px] text-vs-faint">{shortActor(ev.actor)}</span>
                    </div>
                    {ev.summary && <p className="text-[10.5px] text-vs-dim truncate" title={ev.summary}>{ev.summary}</p>}
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
/* Verification engine UI                                              */
/* ------------------------------------------------------------------ */

/* The verification run list shown inside a knowledge record's detail panel. */
function VerificationSection({ runs, selectedId, onSelect }: {
  runs: VRunForWeb[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div data-testid="verification-section">
      <div className="flex items-center gap-2 mb-2">
        <FlaskConical className="size-3.5 text-vs-teal" />
        <span className="text-[10.5px] uppercase tracking-wide text-vs-dim">scientific verification · {runs.length}</span>
      </div>
      {runs.length === 0 ? (
        <p className="text-[11px] text-vs-faint pl-4 leading-relaxed" data-testid="verification-empty">
          no verification runs yet — GLM creates them via <code className="font-mono text-vs-dim">bridge.mjs verification create</code>, then you review the plan and press Start here
        </p>
      ) : (
        <div className="space-y-1.5 max-h-48 overflow-y-auto" data-testid="verification-run-list">
          {runs.map((r) => {
            const m = vStatusMeta(r.status);
            const sel = r.id === selectedId;
            return (
              <button
                suppressHydrationWarning
                key={r.id}
                onClick={() => onSelect(r.id)}
                className={cn(
                  'w-full text-left px-3 py-2 rounded-lg border flex items-center gap-2 transition-colors',
                  sel ? 'bg-vs-active border-vs-blue/40' : 'bg-vs-bg/40 border-vs-border hover:bg-vs-hover'
                )}
                data-testid="verification-run-row"
                data-run-id={r.id}
                data-run-status={r.status}
              >
                <span className={`font-mono text-[11px] flex-none ${m.cls}`} title={r.status}>{m.glyph}</span>
                <span className="font-mono text-[10px] text-vs-blue-bright flex-none">{r.id}</span>
                <span className="text-[11px] truncate min-w-0 flex-1" title={r.title}>{r.title}</span>
                <span className="text-[10px] text-vs-dim flex-none whitespace-nowrap hidden sm:inline">
                  {r.stats.passed}✓/{r.stats.failed}✗ · {r.stats.passRate === null ? 'N/A' : `${r.stats.passRate}%`}
                </span>
                {r.needsDangerousConfirm && r.status === 'READY' && (
                  <span className="text-[10px] text-vs-yellow flex-none" title="contains network/destructive tests — needs your confirmation">⚠</span>
                )}
                <span className="font-mono text-[10px] text-vs-faint flex-none hidden md:inline">{shortWhen(r.updatedAt)}</span>
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
    <div className="rounded-xl border border-vs-border bg-vs-panel-2/30 p-3.5 space-y-3.5" data-testid="verification-run-panel" data-run-id={run.id}>
      {/* A. overview */}
      <div className="space-y-2" data-testid="verification-overview">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`font-mono text-[11px] ${m.cls}`}>{m.glyph}</span>
          <span className={`text-[10.5px] uppercase tracking-wide ${m.cls}`}>{m.label}</span>
          <span className="font-mono text-[10.5px] text-vs-blue-bright">{run.id}</span>
          <span className="text-[11px] text-vs-dim min-w-0 truncate flex-1" title={run.title}>{run.title}</span>
          {busy && <Loader2 className="size-3.5 animate-spin text-vs-dim" />}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1.5 text-[10.5px]" data-testid="verification-meta">
          <div><span className="text-vs-faint">stage </span><span className="text-vs-text font-mono">{run.currentStage}/10 {run.steps[run.currentStage - 1]?.name ?? ''}</span></div>
          <div><span className="text-vs-faint">started </span><span className="text-vs-text font-mono">{run.startedAt ? shortWhen(run.startedAt) : '—'}</span></div>
          <div><span className="text-vs-faint">duration </span><span className="text-vs-text font-mono">{run.durationMs != null ? `${(run.durationMs / 1000).toFixed(1)}s` : '—'}</span></div>
          <div><span className="text-vs-faint">rounds </span><span className="text-vs-text font-mono">{run.rounds.length}</span></div>
        </div>
        <div className="text-[11px] text-vs-dim leading-relaxed" title={run.hypothesis.text} data-testid="verification-hypothesis">
          <span className="text-vs-faint uppercase text-[10px] tracking-wide">hypothesis </span>{run.hypothesis.text.slice(0, 260)}{run.hypothesis.text.length > 260 ? '…' : ''}
        </div>
        {run.cancelled && <div className="text-[10.5px] text-vs-orange">cancelled — {run.cancelReason}</div>}
        {run.needsDangerousConfirm && run.status === 'READY' && (
          <div className="text-[10.5px] text-vs-yellow flex items-center gap-1.5"><AlertTriangle className="size-3.5 flex-none" /> this plan contains network/destructive tests — starting it requires your explicit confirmation</div>
        )}
        {error && <div className="text-[10.5px] text-vs-red" data-testid="verification-action-error">{error}</div>}
      </div>

      {/* owner actions — the owner initiates execution and stays in control */}
      <div className="flex items-center gap-2 flex-wrap" data-testid="verification-actions">
        {run.status === 'READY' && (
          <Button
            size="sm"
            className="h-8 gap-1.5"
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
            className="h-8 gap-1.5 border-vs-red/40 text-vs-red hover:bg-vs-red/10"
            disabled={busy}
            onClick={() => onCancel(run.id)}
            title="Cancel — takes effect before the next test starts"
            data-testid="verification-cancel"
          >
            <Square className="size-3.5" /> Cancel
          </Button>
        )}
        <div className="flex items-center gap-1.5 flex-1 min-w-[14rem]">
          <Input
            value={fbComment}
            onChange={(e) => setFbComment(e.target.value)}
            placeholder="owner feedback (optional)…"
            className="h-8 text-[11px] flex-1"
            data-testid="verification-feedback-input"
          />
          <Button size="sm" variant="outline" className="h-8 border-vs-green/40 text-vs-green hover:bg-vs-green/10" disabled={busy} onClick={() => onFeedback(run.id, 'accept', fbComment)} title="Accept the verification outcome" data-testid="verification-feedback-accept">
            <CheckCircle2 className="size-3.5" /> accept
          </Button>
          <Button size="sm" variant="outline" className="h-8 border-vs-red/40 text-vs-red hover:bg-vs-red/10" disabled={busy} onClick={() => onFeedback(run.id, 'reject', fbComment)} title="Reject the verification outcome" data-testid="verification-feedback-reject">
            <XCircle className="size-3.5" /> reject
          </Button>
        </div>
      </div>

      {/* B. live execution timeline */}
      <div data-testid="verification-timeline">
        <div className="text-[10px] uppercase tracking-wide text-vs-faint mb-1.5">execution timeline</div>
        <div className="space-y-1">
          {run.steps.map((st) => {
            const sm = vStepMeta(st.status);
            return (
              <div key={st.n} className="flex items-start gap-2 min-w-0" data-testid="verification-step" data-step={st.n} data-step-status={st.status}>
                <span className={`font-mono text-[10px] flex-none w-4 text-center ${sm.cls}`}>{sm.glyph}</span>
                <span className="font-mono text-[10px] text-vs-faint flex-none w-5">{String(st.n).padStart(2, '0')}</span>
                <span className={`text-[11px] flex-none ${st.status === 'pending' ? 'text-vs-faint' : 'text-vs-text'}`}>{st.name}</span>
                <span className="text-[10px] text-vs-dim truncate min-w-0 flex-1" title={st.details}>{st.details}</span>
                {st.durationMs != null && <span className="font-mono text-[10px] text-vs-faint flex-none">{(st.durationMs / 1000).toFixed(1)}s</span>}
                {st.status === 'running' && <Loader2 className="size-3 animate-spin text-vs-blue-bright flex-none" />}
              </div>
            );
          })}
        </div>
      </div>

      {/* C. statistics (computed by the bridge) */}
      <div data-testid="verification-stats">
        <div className="text-[10px] uppercase tracking-wide text-vs-faint mb-1.5">test statistics — computed by the bridge, not by the AI</div>
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
            <div key={it.label} className="rounded-lg border border-vs-border bg-vs-bg/60 px-2 py-1.5 text-center" data-testid="verification-stat">
              <div className={`font-mono text-xs ${it.cls ?? 'text-vs-text'}`}>{it.value}</div>
              <div className="text-[9px] uppercase text-vs-faint tracking-wide mt-0.5">{it.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* D. test explorer — every attempt preserved */}
      <div data-testid="verification-tests">
        <div className="flex items-center gap-2 mb-1.5 flex-wrap">
          <span className="text-[10px] uppercase tracking-wide text-vs-faint">test explorer · {detail.cases.length} case(s) · {detail.attempts.length} attempt(s)</span>
          <button suppressHydrationWarning className="text-[10px] text-vs-dim hover:text-vs-text flex items-center gap-1" onClick={copyLogs} title="Copy all commands + outputs to the clipboard" data-testid="verification-copy-logs">
            <Copy className="size-3" /> {logsCopied ? 'copied' : 'copy logs'}
          </button>
        </div>
        <div className="space-y-1.5">
          {detail.cases.map((c: VTestCase) => {
            const cm = vCaseMeta(c.status);
            const atts = attemptsByCase.get(c.id) ?? [];
            const open = openCases.has(c.id);
            return (
              <div key={c.id} className="rounded-lg border border-vs-border overflow-hidden" data-testid="verification-case" data-case-status={c.status}>
                <button
                  suppressHydrationWarning
                  className="w-full px-2.5 py-2 flex items-center gap-2 text-left hover:bg-vs-hover/60 transition-colors"
                  onClick={() => toggleCase(c.id)}
                  aria-expanded={open}
                  data-testid="verification-case-toggle"
                >
                  <span className={`font-mono text-[11px] flex-none ${cm.cls}`}>{cm.glyph}</span>
                  <span className="font-mono text-[10px] text-vs-blue-bright flex-none">{c.id}</span>
                  <span className="text-[11px] truncate min-w-0 flex-1" title={c.objective || c.name}>{c.name}</span>
                  <span className="text-[9.5px] uppercase text-vs-faint flex-none border border-vs-border-2 rounded px-1.5">{c.category}</span>
                  {c.flags.critical && <span className="text-[9.5px] text-vs-tan flex-none" title="critical test — must pass for VERIFIED">critical</span>}
                  {atts.length > 0 && (
                    <span className="font-mono text-[10px] text-vs-faint flex-none">
                      {atts[atts.length - 1].durationMs}ms · {atts.length} att.
                    </span>
                  )}
                  {open ? <ChevronDown className="size-3.5 text-vs-faint flex-none" /> : <ChevronRight className="size-3.5 text-vs-faint flex-none" />}
                </button>
                {open && (
                  <div className="p-2.5 bg-vs-bg/60 space-y-2 border-t border-vs-border/60">
                    <div className="text-[10.5px] text-vs-dim">{c.objective}</div>
                    <div className="font-mono text-[10.5px] text-vs-var bg-vs-bg border border-vs-border rounded-lg p-2 whitespace-pre-wrap break-words" data-testid="verification-case-command">{c.command}</div>
                    <div className="text-[10px] text-vs-faint">
                      criteria: exit {c.criteria.exitCode}
                      {c.criteria.outputContains.length > 0 && <> · output contains <span className="text-vs-text font-mono">{c.criteria.outputContains.join(', ')}</span></>}
                      {c.criteria.outputNotContains.length > 0 && <> · output NOT contains <span className="text-vs-text font-mono">{c.criteria.outputNotContains.join(', ')}</span></>}
                    </div>
                    {atts.length === 0 ? (
                      <div className="text-[10.5px] text-vs-faint">not executed yet</div>
                    ) : atts.map((a) => {
                      const am = vCaseMeta(a.status);
                      return (
                        <div key={a.id} className="rounded-lg border border-vs-border/70 p-2 space-y-1.5" data-testid="verification-attempt">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={`font-mono text-[10.5px] ${am.cls}`}>{am.glyph} attempt {a.attemptNumber} — {am.label}</span>
                            <span className={`font-mono text-[10px] ${a.exitCode === 0 ? 'text-vs-green' : 'text-vs-red'}`}>exit {a.exitCode ?? 'n/a'}</span>
                            {a.timedOut && <span className="text-[10px] text-vs-yellow">timed out</span>}
                            <span className="font-mono text-[10px] text-vs-faint">{a.durationMs}ms</span>
                            {a.journalRef && <CountBadge className="text-vs-faint" title={`activity journal ${a.journalRef}`}>{a.journalRef}</CountBadge>}
                            <span className="text-[10px] text-vs-faint ml-auto">round {a.round} · evaluated by {a.evaluatedBy}</span>
                          </div>
                          <div className="text-[10px] text-vs-dim">{a.note}</div>
                          {a.output && (
                            <pre className="font-mono text-[10.5px] text-vs-text bg-vs-bg border border-vs-border rounded-lg p-2 max-h-44 overflow-auto whitespace-pre-wrap break-words" data-testid="verification-attempt-output">{a.output}</pre>
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
          <div className="text-[10px] uppercase tracking-wide text-vs-faint mb-1.5">measured metrics — every value verified against the cited test output</div>
          <div className="space-y-1 max-h-36 overflow-y-auto">
            {detail.metrics.map((mt) => (
              <div key={mt.id} className="flex items-center gap-2 min-w-0" data-testid="verification-metric">
                <span className={`font-mono text-[11px] flex-none ${mt.verified ? 'text-vs-green' : 'text-vs-yellow'}`} title={mt.verified ? 'value found in the cited attempt output' : 'reported without a tied attempt'}>{mt.verified ? '✓' : '⚠'}</span>
                <span className="text-[11px] text-vs-text truncate min-w-0 flex-1" title={mt.name}>{mt.name}</span>
                <span className="font-mono text-[11px] text-vs-var flex-none">{mt.value}{mt.unit ? ` ${mt.unit}` : ''}</span>
                {mt.testCaseId && <span className="font-mono text-[10px] text-vs-faint flex-none">{mt.testCaseId}</span>}
                <span className="text-[9.5px] uppercase text-vs-faint flex-none border border-vs-border-2 rounded px-1.5">{mt.source}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* F. evidence artifacts */}
      {detail.evidence.length > 0 && (
        <div data-testid="verification-evidence">
          <div className="text-[10px] uppercase tracking-wide text-vs-faint mb-1.5">evidence artifacts</div>
          <div className="space-y-1">
            {detail.evidence.map((ev) => (
              <button
                suppressHydrationWarning
                key={ev.id}
                className="w-full text-left flex items-center gap-2 min-w-0 px-2 py-1.5 rounded-lg hover:bg-vs-hover/60 transition-colors"
                onClick={() => onOpenFile(ev.storageRef)}
                title={`open ${ev.storageRef} in the file viewer`}
                data-testid="verification-evidence-row"
              >
                <BookOpen className="size-3.5 text-vs-blue-bright flex-none" />
                <span className="text-[11px] text-vs-text truncate flex-none max-w-[11rem]" title={ev.filename}>{ev.filename}</span>
                <span className="font-mono text-[10px] text-vs-faint truncate min-w-0 flex-1" title={`sha256 ${ev.sha256}`}>sha256 {ev.sha256.slice(0, 16)}…</span>
                <span className="font-mono text-[10px] text-vs-faint flex-none">{(ev.bytes / 1024).toFixed(1)} KB</span>
                <span className="font-mono text-[10px] text-vs-faint flex-none hidden sm:inline">{shortWhen(ev.createdAt)}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* G. analyses — GLM interpretation + engine decision (labeled separately) */}
      {run.analyses.length > 0 && (
        <div data-testid="verification-analyses">
          <div className="text-[10px] uppercase tracking-wide text-vs-faint mb-1.5">result analyses — AI interpretation, checked by the bridge</div>
          <div className="space-y-2 max-h-72 overflow-y-auto">
            {run.analyses.map((an) => (
              <div key={an.id} className="rounded-lg border border-vs-border/70 p-2.5 space-y-1.5" data-testid="verification-analysis">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-[10px] text-vs-purple">GLM · round {an.round}</span>
                  <span className="font-mono text-[10px] text-vs-faint">{shortWhen(an.createdAt)}</span>
                  <span className="ml-auto flex items-center gap-1.5">
                    <span className="text-[10px] text-vs-faint">proposed</span>
                    <span className={`text-[10px] font-mono ${vStatusMeta(an.proposedConclusion.status).cls}`}>{an.proposedConclusion.status}</span>
                    <span className={`text-[10px] font-mono ${an.engineDecision.accepted ? 'text-vs-green' : 'text-vs-red'}`}>{an.engineDecision.accepted ? '→ accepted' : '→ REJECTED by evidence'}</span>
                  </span>
                </div>
                <p className="text-[11px] text-vs-text leading-relaxed whitespace-pre-wrap">{an.summary}</p>
                {an.comparison && <p className="text-[10.5px] text-vs-dim"><span className="text-vs-faint">expected vs observed: </span>{an.comparison}</p>}
                {an.alternativeExplanations && <p className="text-[10.5px] text-vs-dim"><span className="text-vs-faint">alternatives: </span>{an.alternativeExplanations}</p>}
                {an.recommendedModifications && <p className="text-[10.5px] text-vs-dim"><span className="text-vs-faint">modifications: </span>{an.recommendedModifications}</p>}
                <p className={`text-[10.5px] ${an.engineDecision.accepted ? 'text-vs-green' : 'text-vs-yellow'}`} data-testid="verification-engine-decision">
                  engine decision: {an.engineDecision.effectiveStatus} — {an.engineDecision.reason}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* conclusion */}
      {run.conclusion && (
        <div className={cn(
          'rounded-lg border p-3',
          run.conclusion.status === 'VERIFIED' ? 'border-vs-green/40 bg-vs-green/[0.05]'
            : run.conclusion.status === 'FAILED' ? 'border-vs-red/40 bg-vs-red/[0.05]'
              : 'border-vs-yellow/40 bg-vs-yellow/[0.05]'
        )} data-testid="verification-conclusion">
          <div className="flex items-center gap-2">
            <span className={`font-mono text-[11px] ${m.cls}`}>{m.glyph}</span>
            <span className={`text-[10.5px] uppercase tracking-wide ${m.cls}`}>conclusion — {run.conclusion.status}</span>
            <span className="text-[10px] text-vs-faint ml-auto font-mono">{run.conclusion.decidedBy}</span>
          </div>
          <p className="text-[11px] text-vs-text mt-1.5 leading-relaxed">{run.conclusion.summary}</p>
          {run.conclusion.glmInterpretation && (
            <p className="text-[10.5px] text-vs-dim mt-1.5"><span className="text-vs-purple">AI interpretation: </span>{run.conclusion.glmInterpretation.slice(0, 400)}</p>
          )}
          {run.feedback.length > 0 && (
            <div className="mt-2 space-y-1 border-t border-vs-border/50 pt-2">
              {run.feedback.map((f) => (
                <div key={f.id} className="flex items-center gap-2 text-[10.5px]">
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
        <details className="text-[10.5px] text-vs-dim" data-testid="verification-environment">
          <summary className="text-[10px] uppercase tracking-wide text-vs-faint cursor-pointer hover:text-vs-text">environment snapshot (reproducibility)</summary>
          <div className="pl-3.5 pt-1.5 space-y-1 font-mono text-[10.5px] text-vs-dim">
            <div>os: {run.environmentSnapshot.os}</div>
            <div>runtimes: {run.environmentSnapshot.runtimes}</div>
            <div>source revision: {run.environmentSnapshot.sourceRevision ?? 'n/a'}</div>
          </div>
        </details>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* The full Knowledge view                                             */
/* ------------------------------------------------------------------ */

export function KnowledgeView(p: {
  paired: boolean;
  knowledge: KnowledgeState | null;
  refreshing: boolean;
  onRefresh: () => void;
  search: string;
  onSearchChange: (v: string) => void;
  scope: 'all' | 'global' | 'project';
  onScopeChange: (v: 'all' | 'global' | 'project') => void;
  statusFilter: KnowledgeStatusFilter;
  onStatusFilterChange: (v: KnowledgeStatusFilter) => void;
  category: string;
  onCategoryChange: (v: string) => void;
  records: KnowledgeRecord[];
  categories: string[];
  counts: KnowledgeCounts | undefined;
  total: number;
  empty: boolean;
  selected: KnowledgeRecord | null;
  activeVersion: KnowledgeVersion | null;
  selectedVersions: KnowledgeVersion[];
  feedback: KnowledgeFeedback[];
  onSelect: (id: string) => void;
  versionsOpen: boolean;
  onVersionsOpenChange: (v: boolean) => void;
  openVersions: Set<number>;
  onToggleVersion: (v: number) => void;
  attemptsOpen: boolean;
  onAttemptsOpenChange: (v: boolean) => void;
  auditOpen: boolean;
  onAuditOpenChange: (v: boolean) => void;
  confirm: string | null;
  actionError: string | null;
  onAction: (action: string, opts: { id?: string; version?: number; reason?: string }, needsConfirm?: boolean) => void;
  recordRuns: VRunForWeb[];
  vRunId: string | null;
  onSelectVRun: (id: string) => void;
  vRun: VRunDetail | null;
  vBusy: boolean;
  vError: string | null;
  vConfirm: string | null;
  onVStart: (runId: string, dangerous: boolean) => void;
  onVCancel: (runId: string) => void;
  onVFeedback: (runId: string, decision: 'accept' | 'reject' | 'comment', comment: string) => void;
  onOpenFile: (path: string) => void;
  verificationTotal: number;
}) {
  const k = p.knowledge;
  const st = p.selected ? knowledgeStatusMeta(p.selected.status) : null;
  const av = p.activeVersion;

  return (
    <div className="space-y-4">
      <ViewHeader
        title="Knowledge"
        sub="The shared, verification-gated experience library — every record starts as a candidate and is only promoted by real evidence."
      >
        {k?.syncedAt ? (
          <span className="text-[10.5px] text-vs-faint font-mono" data-testid="knowledge-synced-at" title={new Date(k.syncedAt).toLocaleString()}>
            synced {timeStr(k.syncedAt)}
          </span>
        ) : null}
        <button
          suppressHydrationWarning
          className="text-[11px] text-vs-dim hover:text-vs-text flex items-center gap-1.5 disabled:opacity-50 transition-colors"
          onClick={p.onRefresh}
          disabled={!p.paired || p.refreshing}
          title="Re-sync the knowledge store from the workspace"
          data-testid="knowledge-refresh"
        >
          {p.refreshing ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
          re-sync
        </button>
      </ViewHeader>

      {!p.paired ? (
        <Panel testId="knowledge-card">
          <LockedPanel text="Pair this browser to manage the shared knowledge library." />
        </Panel>
      ) : !k ? (
        <Panel testId="knowledge-card">
          <div className="py-20 text-center text-vs-dim text-xs flex flex-col items-center gap-3" data-testid="knowledge-loading">
            <Loader2 className="size-6 animate-spin" /> syncing knowledge…
          </div>
        </Panel>
      ) : (
        <>
          {k.note && (
            <p className="text-[11.5px] text-vs-yellow flex items-center gap-2 px-1" data-testid="knowledge-note">
              <AlertTriangle className="size-3.5 flex-none" /> {k.note}
            </p>
          )}

          {p.empty && (
            <p className="text-xs text-vs-dim leading-relaxed px-1" data-testid="knowledge-explainer">
              Shared engineering knowledge — GLM submits a record every time it fixes something non-trivial.
              Records become verified only through the bridge&apos;s verification gate (real commands, real exit codes)
              or your approval. The store lives in <span className="font-mono text-vs-text">knowledge/</span> in your
              workspace, portable with the repo.
            </p>
          )}

          {/* stat strip */}
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2" data-testid="knowledge-card">
            <StatTile value={p.total} label="records" testId="knowledge-total-badge" />
            <StatTile value={p.counts?.verified ?? 0} label="verified" accent="text-vs-green" testId="knowledge-count-verified" />
            <StatTile value={p.counts?.candidate ?? 0} label="candidate" accent="text-vs-yellow" testId="knowledge-count-candidate" />
            <StatTile value={p.counts?.verificationPending ?? 0} label="verifying" accent="text-vs-blue-bright" testId="knowledge-count-pending" />
            <StatTile value={p.counts?.rejected ?? 0} label="rejected" accent="text-vs-red" testId="knowledge-count-rejected" />
            <StatTile value={p.counts?.attempts ?? 0} label="failed attempts" accent="text-vs-red" testId="knowledge-count-attempts" />
            <StatTile value={p.verificationTotal} label="verif. runs" accent="text-vs-teal" testId="knowledge-count-verruns" title="scientific verification runs across the library" />
          </div>

          {/* filters */}
          <div className="flex items-center gap-2 flex-wrap" data-testid="knowledge-filters">
            <div className="relative">
              <Search className="size-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-vs-dim" />
              <Input
                value={p.search}
                onChange={(e) => p.onSearchChange(e.target.value)}
                placeholder="search knowledge…"
                className="h-8 text-xs pl-8 w-44 sm:w-64"
                data-testid="knowledge-search"
              />
            </div>
            <div className="flex items-center flex-wrap gap-1">
              {(['all', 'global', 'project'] as const).map((s) => (
                <FeedChip key={s} active={p.scope === s} onClick={() => p.onScopeChange(s)} testId={`knowledge-filter-scope-${s}`}>
                  {s === 'all' ? 'All' : s === 'global' ? 'Global' : 'Project'}
                </FeedChip>
              ))}
            </div>
            <div className="flex items-center flex-wrap gap-1">
              {([
                ['all', 'All'],
                ['verified', 'Verified'],
                ['candidate', 'Candidate'],
                ['verification_pending', 'Verifying'],
                ['rejected', 'Rejected'],
                ['deprecated', 'Deprecated'],
                ['archived', 'Archived'],
              ] as [KnowledgeStatusFilter, string][]).map(([val, label]) => (
                <FeedChip key={val} active={p.statusFilter === val} onClick={() => p.onStatusFilterChange(val)} testId={`knowledge-filter-status-${val}`}>
                  {label}
                </FeedChip>
              ))}
            </div>
            {p.categories.length > 1 && (
              <div className="flex items-center flex-wrap gap-1">
                {p.categories.map((cat) => (
                  <FeedChip key={cat} active={p.category === cat} onClick={() => p.onCategoryChange(p.category === cat ? '' : cat)} testId={`knowledge-filter-category-${cat}`}>
                    {cat}
                  </FeedChip>
                ))}
              </div>
            )}
          </div>

          {/* library + detail */}
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-start">
            {/* list */}
            <Panel className="xl:col-span-5">
              <div className="max-h-[72vh] overflow-y-auto p-2 space-y-1.5" data-testid="knowledge-list">
                {p.records.length === 0 ? (
                  <p className="text-center text-vs-dim text-[11px] py-10" data-testid="knowledge-empty">
                    {p.search || p.scope !== 'all' || p.statusFilter !== 'all' || p.category
                      ? 'no records match the current filters.'
                      : 'no knowledge records yet — GLM submits one every time it fixes something non-trivial in your workspace.'}
                  </p>
                ) : (
                  p.records.map((r) => {
                    const rst = knowledgeStatusMeta(r.status);
                    const active = p.selected?.id === r.id;
                    return (
                      <button
                        key={r.id}
                        suppressHydrationWarning
                        onClick={() => p.onSelect(r.id)}
                        className={cn(
                          'w-full flex items-center gap-2 px-3 py-2 rounded-lg border text-left transition-colors',
                          active ? 'bg-vs-active border-vs-blue/40' : 'bg-vs-bg/40 border-vs-border hover:bg-vs-hover'
                        )}
                        data-testid="knowledge-row"
                        data-knowledge-id={r.id}
                        data-knowledge-status={r.status}
                      >
                        <span className={`size-2 rounded-full bg-current flex-none ${rst.color}`} title={rst.label} />
                        <span className="font-mono text-[10.5px] text-vs-blue-bright flex-none truncate max-w-[7.5rem]" title={r.id}>{r.id}</span>
                        <span className="text-[11.5px] truncate min-w-0 flex-1" title={r.title}>{r.title}</span>
                        <Badge
                          variant="outline"
                          className={`flex-none text-[9.5px] px-1.5 ${r.scope === 'global' ? 'border-vs-blue/40 text-vs-blue' : 'border-vs-purple/40 text-vs-purple'}`}
                          title={r.scope === 'project' && r.projectId ? r.projectId : `scope: ${r.scope}`}
                        >
                          {r.scope}
                        </Badge>
                        <span className="text-[10px] text-vs-faint flex-none hidden lg:inline" title={`category: ${r.category}`}>{r.category}</span>
                        <span className="font-mono text-[10px] text-vs-faint flex-none hidden md:inline" title={`${r.versions?.length ?? 0} versions`}>v{r.activeVersion}·{r.versions?.length ?? 0}v</span>
                        <span className="font-mono text-[10px] flex-none hidden sm:inline" title={`reuse: ${r.reuseStats?.worked ?? 0} worked · ${r.reuseStats?.failed ?? 0} failed`}>
                          <span className="text-vs-green">{r.reuseStats?.worked ?? 0}✓</span>{' '}<span className="text-vs-red">{r.reuseStats?.failed ?? 0}✗</span>
                        </span>
                        <span className="font-mono text-[10px] text-vs-faint flex-none hidden xl:inline" title={r.updatedAt}>{shortWhen(r.updatedAt)}</span>
                      </button>
                    );
                  })
                )}
              </div>
            </Panel>

            {/* detail */}
            <div className="xl:col-span-7 min-w-0">
              {p.selected && st ? (
                <Panel data-testid="knowledge-detail">
                  {/* header */}
                  <div className="flex items-center gap-2.5 px-4 py-3 bg-vs-panel-2/60 border-b border-vs-border/70 min-w-0">
                    <Brain className="size-4 text-vs-teal flex-none" />
                    <span className="font-mono text-[11px] text-vs-blue-bright flex-none truncate max-w-[9rem]" title={p.selected.id}>{p.selected.id}</span>
                    <span className="text-xs text-vs-bright truncate min-w-0 flex-1" title={p.selected.title}>{p.selected.title}</span>
                    <span className={`text-[10px] uppercase tracking-wide flex-none ${st.color}`}>{st.label}</span>
                    <button suppressHydrationWarning className="text-vs-dim hover:text-vs-text flex-none transition-colors" onClick={() => p.onSelect(p.selected!.id)} title="Close" data-testid="knowledge-detail-close">
                      <X className="size-4" />
                    </button>
                  </div>

                  <div className="p-4 space-y-4">
                    {p.selected.problemSummary && (
                      <p className="text-xs text-vs-dim leading-relaxed" title={p.selected.problemSummary}>{p.selected.problemSummary}</p>
                    )}

                    {/* meta */}
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2" data-testid="knowledge-meta">
                      <KnowledgeMetaItem label="status"><span className={st.color}>{st.label}</span></KnowledgeMetaItem>
                      <KnowledgeMetaItem label="scope" title={p.selected.projectId ?? undefined}>{p.selected.scope}</KnowledgeMetaItem>
                      <KnowledgeMetaItem label="category">{p.selected.category}</KnowledgeMetaItem>
                      <KnowledgeMetaItem label="created" title={p.selected.createdAt}>{shortWhen(p.selected.createdAt)}</KnowledgeMetaItem>
                      <KnowledgeMetaItem label="updated" title={p.selected.updatedAt}>{shortWhen(p.selected.updatedAt)}</KnowledgeMetaItem>
                      <KnowledgeMetaItem label="created by" title={p.selected.createdBy}>{shortActor(p.selected.createdBy)}</KnowledgeMetaItem>
                    </div>

                    {/* active version */}
                    {av ? (
                      <div className="space-y-2.5" data-testid="knowledge-active-version">
                        <div className="flex items-center gap-2">
                          <span className="text-[10.5px] uppercase tracking-wide text-vs-dim">active version</span>
                          <CountBadge className="border-vs-blue/40 text-vs-blue">v{av.version}</CountBadge>
                        </div>
                        <KnowledgeVersionView v={av} />
                      </div>
                    ) : (
                      <p className="text-[11px] text-vs-faint">no versions recorded</p>
                    )}

                    {/* all versions — collapsed by default */}
                    {(p.selected.versions?.length ?? 0) > 0 && (
                      <div>
                        <SubToggle open={p.versionsOpen} onClick={() => p.onVersionsOpenChange(!p.versionsOpen)} testId="knowledge-versions-toggle">
                          all versions · {p.selected.versions.length}
                        </SubToggle>
                        {p.versionsOpen && (
                          <div className="mt-2 space-y-2">
                            {p.selectedVersions.map((vv) => {
                              const vf = knowledgeVerifMeta(vv.verificationStatus);
                              const vOpen = p.openVersions.has(vv.version);
                              return (
                                <div key={vv.version} className="rounded-lg border border-vs-border overflow-hidden">
                                  <button
                                    suppressHydrationWarning
                                    className="w-full flex items-center gap-2.5 px-3 py-2 bg-vs-panel-2/50 hover:bg-vs-hover text-left transition-colors"
                                    onClick={() => p.onToggleVersion(vv.version)}
                                    aria-expanded={vOpen}
                                    data-testid="knowledge-version-header"
                                    data-version={vv.version}
                                  >
                                    {vOpen ? <ChevronDown className="size-3.5 text-vs-faint flex-none" /> : <ChevronRight className="size-3.5 text-vs-faint flex-none" />}
                                    <span className="font-mono text-[11px] text-vs-bright flex-none">v{vv.version}</span>
                                    <span className={`text-[10.5px] flex-none ${vf.cls}`}>{vf.label}</span>
                                    <span className="text-[10px] text-vs-faint truncate min-w-0 flex-1" title={vv.createdBy}>{shortActor(vv.createdBy)}</span>
                                    {vv.supersedes !== undefined && <span className="text-[10px] text-vs-faint flex-none hidden sm:inline">supersedes v{vv.supersedes}</span>}
                                    <span className="font-mono text-[10px] text-vs-faint flex-none hidden md:inline">{shortWhen(vv.createdAt)}</span>
                                  </button>
                                  {vOpen && (
                                    <div className="p-3 bg-vs-bg/50">
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

                    {/* scientific verification — evidence-driven runs */}
                    <VerificationSection
                      runs={p.recordRuns}
                      selectedId={p.vRunId}
                      onSelect={p.onSelectVRun}
                    />
                    {p.vRun && p.vRun.run?.knowledgeId === p.selected.id && (
                      <VerificationRunPanel
                        detail={p.vRun}
                        busy={p.vBusy}
                        error={p.vError}
                        confirm={p.vConfirm}
                        onStart={p.onVStart}
                        onCancel={p.onVCancel}
                        onFeedback={p.onVFeedback}
                        onOpenFile={p.onOpenFile}
                      />
                    )}

                    {/* reuse feedback */}
                    <div data-testid="knowledge-feedback">
                      <div className="text-[10.5px] uppercase tracking-wide text-vs-dim mb-2">reuse feedback · {p.feedback.length}</div>
                      {p.feedback.length === 0 ? (
                        <p className="text-[11px] text-vs-faint">no reuse feedback yet</p>
                      ) : (
                        <div className="space-y-1.5 max-h-40 overflow-y-auto">
                          {p.feedback.map((f) => {
                            const om = f.outcome === 'worked'
                              ? { c: 'text-vs-green', g: '✓' }
                              : f.outcome === 'failed'
                                ? { c: 'text-vs-red', g: '✗' }
                                : { c: 'text-vs-yellow', g: '⚠' };
                            return (
                              <div key={f.id} className="flex items-start gap-2 min-w-0" data-testid="knowledge-feedback-row">
                                <span className={`font-mono text-[11px] flex-none ${om.c}`}>{om.g}</span>
                                <span className="text-[11px] text-vs-dim truncate min-w-0 flex-1" title={f.notes}>{f.notes}</span>
                                <span className="font-mono text-[10px] text-vs-faint flex-none whitespace-nowrap">v{f.experienceVersion} · {shortWhen(f.createdAt)}</span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    {/* honest ack error from the last action */}
                    {p.actionError && (
                      <p className="text-vs-red text-[11px] text-right break-words" data-testid="knowledge-action-error">{p.actionError}</p>
                    )}

                    {/* actions — destructive ones need a confirming second click */}
                    <div className="flex items-center justify-end gap-2 flex-wrap pt-3 border-t border-vs-border/60" data-testid="knowledge-actions">
                      {(p.selected.status === 'candidate' || p.selected.status === 'verification_pending') && (
                        <Button
                          size="sm"
                          className="h-8 gap-1.5"
                          onClick={() => p.onAction('approve', { id: p.selected!.id, version: p.selected!.activeVersion })}
                          title="Promote to verified (owner approval)"
                          data-testid="knowledge-approve"
                        >
                          <CheckCircle2 className="size-3.5" /> Approve
                        </Button>
                      )}
                      {p.selected.status !== 'rejected' && (
                        <Button
                          size="sm"
                          variant="outline"
                          className={cn('h-8 gap-1.5 border-vs-border-2', p.confirm === 'reject' ? 'border-vs-yellow/60 text-vs-yellow' : 'text-vs-dim')}
                          onClick={() => p.onAction('reject', { id: p.selected!.id }, true)}
                          data-testid="knowledge-reject"
                          title="Reject this record"
                        >
                          {p.confirm === 'reject' ? 'confirm?' : <><XCircle className="size-3.5" /> Reject</>}
                        </Button>
                      )}
                      {p.selected.status === 'verified' && (
                        <Button
                          size="sm"
                          variant="outline"
                          className={cn('h-8 gap-1.5 border-vs-border-2', p.confirm === 'deprecate' ? 'border-vs-yellow/60 text-vs-yellow' : 'text-vs-dim')}
                          onClick={() => p.onAction('deprecate', { id: p.selected!.id }, true)}
                          data-testid="knowledge-deprecate"
                          title="Mark as superseded/outdated"
                        >
                          {p.confirm === 'deprecate' ? 'confirm?' : <><History className="size-3.5" /> Deprecate</>}
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        className={cn('h-8 gap-1.5 border-vs-border-2', p.confirm === 'archive' ? 'border-vs-yellow/60 text-vs-yellow' : 'text-vs-dim')}
                        onClick={() => p.onAction('archive', { id: p.selected!.id }, true)}
                        data-testid="knowledge-archive"
                        title="Archive this record"
                      >
                        {p.confirm === 'archive' ? 'confirm?' : <><Archive className="size-3.5" /> Archive</>}
                      </Button>
                      {(p.selected.status === 'deprecated' || p.selected.status === 'archived' || p.selected.status === 'rejected') && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 gap-1.5 border-vs-border-2 text-vs-dim"
                          onClick={() => p.onAction('restore', { id: p.selected!.id })}
                          data-testid="knowledge-restore"
                          title="Restore to candidate"
                        >
                          <Undo2 className="size-3.5" /> Restore
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        className={cn('h-8 gap-1.5', p.confirm === 'delete' ? 'border-vs-red text-vs-red' : 'border-vs-red/40 text-vs-red')}
                        onClick={() => p.onAction('delete', { id: p.selected!.id }, true)}
                        data-testid="knowledge-delete"
                        title="Soft-delete this record"
                      >
                        {p.confirm === 'delete' ? 'confirm?' : <><Trash2 className="size-3.5" /> Delete</>}
                      </Button>
                    </div>
                  </div>
                </Panel>
              ) : (
                <Panel>
                  <EmptyState
                    icon={<Brain className="size-5" />}
                    title="No record selected"
                    hint="Pick a record from the library to read its versions, verification evidence and reuse history."
                  />
                </Panel>
              )}
            </div>
          </div>

          {/* failed attempts + audit log — library-wide, collapsed by default */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
            <div data-testid="knowledge-attempts-section">
              <SubToggle open={p.attemptsOpen} onClick={() => p.onAttemptsOpenChange(!p.attemptsOpen)} testId="knowledge-attempts-toggle">
                failed attempts
                <CountBadge testId="knowledge-attempts-count">{p.counts?.attempts ?? 0}</CountBadge>
              </SubToggle>
              {p.attemptsOpen && (
                (k.attempts ?? []).length === 0 ? (
                  <p className="text-[11px] text-vs-faint pl-5 pt-2" data-testid="knowledge-attempts-empty">no failed attempts recorded</p>
                ) : (
                  <div className="mt-2 max-h-56 overflow-y-auto rounded-lg border border-vs-border" data-testid="knowledge-attempts-list">
                    {(k.attempts ?? []).map((a) => (
                      <div key={a.id} className="flex items-center gap-2.5 px-3 py-2 border-b border-vs-border/60 last:border-b-0 hover:bg-vs-hover/50" data-testid="knowledge-attempt-row">
                        <span className="flex-none" title={a.result}><XCircle className="size-3.5 text-vs-red" /></span>
                        <span className="font-mono text-[10.5px] text-vs-blue-bright flex-none truncate max-w-[7.5rem]" title={a.id}>{a.id}</span>
                        <span className="text-[11px] truncate min-w-0 flex-1" title={a.problemSummary}>{a.problemSummary}</span>
                        <span className="text-[10.5px] text-vs-dim truncate max-w-[14rem] hidden md:inline" title={a.failureReason}>{a.failureReason}</span>
                        <span className="font-mono text-[10px] text-vs-faint flex-none hidden sm:inline">{shortWhen(a.createdAt)}</span>
                      </div>
                    ))}
                  </div>
                )
              )}
            </div>

            <div data-testid="knowledge-audit-section">
              <SubToggle open={p.auditOpen} onClick={() => p.onAuditOpenChange(!p.auditOpen)} testId="knowledge-audit-toggle">
                audit log
                <CountBadge testId="knowledge-audit-count">{p.counts?.audit ?? 0}</CountBadge>
              </SubToggle>
              {p.auditOpen && (
                (k.audit ?? []).length === 0 ? (
                  <p className="text-[11px] text-vs-faint pl-5 pt-2" data-testid="knowledge-audit-empty">no audit events yet</p>
                ) : (
                  <div className="mt-2 max-h-56 overflow-y-auto rounded-lg border border-vs-border" data-testid="knowledge-audit-list">
                    {(k.audit ?? []).map((a) => (
                      <div key={a.id} className="flex items-center gap-2.5 px-3 py-1.5 border-b border-vs-border/60 last:border-b-0 hover:bg-vs-hover/50" data-testid="knowledge-audit-row">
                        <span className="font-mono text-[10px] text-vs-faint flex-none" title={new Date(a.ts).toLocaleString()}>{shortWhen(a.ts)}</span>
                        <span className="text-[10px] text-vs-dim flex-none hidden sm:inline">{shortActor(a.actor)}</span>
                        <span className="font-mono text-[10.5px] text-vs-teal flex-none">{a.operation}</span>
                        <span className="font-mono text-[10.5px] text-vs-blue-bright flex-none truncate max-w-[7.5rem]" title={a.entityId}>{a.entityId}</span>
                        <span className="font-mono text-[10.5px] text-vs-dim flex-none whitespace-nowrap">
                          {a.oldVersion === null && a.newVersion === null
                            ? '—'
                            : `${a.oldVersion !== null ? `v${a.oldVersion}` : ''}→${a.newVersion !== null ? `v${a.newVersion}` : ''}`}
                        </span>
                        <span className="text-[10.5px] text-vs-dim truncate min-w-0 flex-1" title={a.reason}>{a.reason}</span>
                      </div>
                    ))}
                  </div>
                )
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
