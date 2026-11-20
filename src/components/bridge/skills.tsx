'use client';

/* ------------------------------------------------------------------ */
/* Skills — documents in the workspace .skills/ folder that GLM        */
/* re-reads before every task.                                         */
/* ------------------------------------------------------------------ */

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  GraduationCap, RefreshCw, Loader2, BookOpen, X, AlertTriangle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Skill, SkillsMeta, SkillViewState } from './types';
import { fmtBytes } from './types';
import { EmptyState, LockedPanel, Panel, ViewHeader, CountBadge } from './bits';

function SkillRow({ s, active, onOpen }: { s: Skill; active: boolean; onOpen: () => void }) {
  return (
    <button
      suppressHydrationWarning
      onClick={onOpen}
      className={cn(
        'w-full flex items-center gap-2.5 px-3 py-2 rounded-lg border text-left transition-colors',
        active ? 'bg-vs-active border-vs-blue/40' : 'bg-vs-bg/40 border-vs-border hover:bg-vs-hover'
      )}
      data-testid="skill-row"
      data-skill={s.name}
    >
      <BookOpen className="size-4 flex-none text-vs-purple" />
      <span className="font-mono text-xs text-vs-text truncate flex-1 min-w-0" title={s.path}>{s.name}</span>
      {s.format === 'package' && (
        <Badge variant="outline" className="border-vs-blue/40 text-vs-blue text-[9.5px] px-1.5 flex-none" title={`skill package · ${s.files?.length ?? 0} files`}>
          pkg · {s.files?.length ?? 0} files
        </Badge>
      )}
      <span className="text-[10px] text-vs-faint flex-none">{fmtBytes(s.size)}</span>
    </button>
  );
}

export function SkillsView({
  paired, wsOnline, skills, skillsMeta, refreshing, onRefresh,
  skillView, onClose, onOpen, onSelectFile,
}: {
  paired: boolean;
  wsOnline: boolean;
  skills: Skill[];
  skillsMeta: SkillsMeta;
  refreshing: boolean;
  onRefresh: () => void;
  skillView: SkillViewState | null;
  onClose: () => void;
  onOpen: (name: string) => void;
  onSelectFile: (path: string) => void;
}) {
  return (
    <div className="space-y-4">
      <ViewHeader
        title="Skills"
        sub="Skill documents live in your workspace — GLM re-reads them before every task, automatically."
      />

      <Panel testId="skills-card">
        <div className="flex items-center gap-2.5 px-4 py-3 border-b border-vs-border/70 flex-wrap">
          <GraduationCap className="size-4 text-vs-purple flex-none" />
          <h2 className="text-[13px] font-medium text-vs-bright">Library</h2>
          <CountBadge>{skills.length} in .skills/</CountBadge>
          <div className="flex-1" />
          <button
            suppressHydrationWarning
            className="text-[11px] text-vs-dim hover:text-vs-text flex items-center gap-1.5 disabled:opacity-50 transition-colors"
            onClick={onRefresh}
            disabled={!paired || refreshing}
            title="Re-check the workspace .skills/ folder now"
            data-testid="skill-refresh"
          >
            {refreshing ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
            re-check
          </button>
        </div>

        <div className="p-4 space-y-4">
          <p className="text-xs text-vs-dim leading-relaxed" data-testid="skill-explainer">
            Create a <span className="font-mono text-vs-purple">.skills/</span> folder in your workspace and drop skill
            documents in — loose files, or a sub-folder per skill with a <span className="font-mono">SKILL.md</span>.
            Say <span className="font-mono text-vs-text">{'“use the skill <name>”'}</span> in your z.ai chat to apply one on request.
          </p>

          {!paired ? (
            <LockedPanel text="Pair this browser to browse the skills in your workspace." />
          ) : (
            <>
              {!wsOnline && (
                <p className="text-[11.5px] text-vs-yellow flex items-center gap-2" data-testid="skill-offline">
                  <AlertTriangle className="size-3.5 flex-none" /> workspace offline — .skills/ is checked when VS Code reconnects.
                </p>
              )}
              {wsOnline && skills.length === 0 && skillsMeta.note && (
                <p className="text-[11.5px] text-vs-dim flex items-start gap-2" data-testid="skill-note">
                  <AlertTriangle className="size-3.5 flex-none mt-0.5 text-vs-yellow" /> {skillsMeta.note}
                </p>
              )}

              {skills.length === 0 ? (
                <EmptyState
                  icon={<GraduationCap className="size-5" />}
                  title="No skills yet"
                  hint="Create the .skills/ folder in your workspace and drop skill documents in — they appear here instantly."
                  testId="skill-empty"
                />
              ) : (
                <div className="max-h-72 overflow-y-auto space-y-1.5 pr-1" data-testid="skill-list">
                  {skills.map((s) => (
                    <SkillRow
                      key={s.name}
                      s={s}
                      active={skillView?.name === s.name}
                      onOpen={() => onOpen(s.name)}
                    />
                  ))}
                </div>
              )}

              {/* skill viewer */}
              {skillView && (
                <div className="rounded-xl border border-vs-border overflow-hidden" data-testid="skill-viewer">
                  <div className="flex items-center gap-2.5 px-3.5 py-2.5 bg-vs-panel-2/60 min-w-0">
                    <BookOpen className="size-4 text-vs-purple flex-none" />
                    <span className="font-mono text-xs text-vs-bright truncate flex-1 min-w-0" title={skillView.name}>
                      {skillView.name}
                    </span>
                    {skillView.skill?.format === 'package' && (
                      <Badge variant="outline" className="border-vs-blue/40 text-vs-blue text-[9.5px] px-1.5 flex-none" data-testid="skill-package-badge">
                        folder · {skillView.skill.files?.length ?? 0} files
                      </Badge>
                    )}
                    <span className="text-[10px] text-vs-faint flex-none hidden sm:inline">from .skills/</span>
                    <button suppressHydrationWarning className="text-vs-dim hover:text-vs-text flex-none transition-colors" onClick={onClose} title="Close">
                      <X className="size-4" />
                    </button>
                  </div>
                  {skillView.loading ? (
                    <div className="py-10 text-center text-vs-dim text-xs flex flex-col items-center gap-2.5">
                      <Loader2 className="size-5 animate-spin" /> reading {skillView.name}…
                    </div>
                  ) : skillView.error ? (
                    <p className="py-6 text-center text-vs-red text-xs">{skillView.error}</p>
                  ) : (
                    <>
                      <div className="px-3.5 py-2.5 bg-vs-purple/[0.07] border-b border-vs-border text-[11px] text-vs-purple leading-relaxed" data-testid="skill-learned">
                        <span className="font-semibold">learned by GLM:</span> re-read from the workspace .skills/ folder before every task — applied automatically, and on request via “use the skill {skillView.name}”.
                      </div>
                      {(skillView.files ?? []).length > 1 && (
                        <div className="flex items-center gap-1 px-2.5 py-2 border-b border-vs-border bg-vs-panel-2 overflow-x-auto" data-testid="skill-files">
                          {skillView.files!.map((f) => (
                            <button
                              key={f.path}
                              suppressHydrationWarning
                              onClick={() => onSelectFile(f.path)}
                              title={`${f.path} · ${fmtBytes(f.size)}`}
                              className={cn(
                                'flex-none font-mono text-[10.5px] px-2.5 py-1 rounded-t-md border-b-2 transition-colors',
                                skillView.activeFile === f.path
                                  ? 'border-b-vs-blue text-vs-blue-bright bg-vs-bg'
                                  : 'border-b-transparent text-vs-dim hover:text-vs-text hover:bg-vs-hover'
                              )}
                              data-file={f.path}
                              data-file-main={skillView.skill?.files?.find((m) => m.path === f.path)?.main ? 'true' : undefined}
                            >
                              {f.path.split('/').pop()}
                              {skillView.skill?.files?.find((m) => m.path === f.path)?.main ? ' ★' : ''}
                            </button>
                          ))}
                        </div>
                      )}
                      <pre className="text-[11px] font-mono text-vs-text whitespace-pre-wrap break-all bg-vs-bg p-3.5 max-h-80 overflow-auto" data-testid="skill-content">
                        {(skillView.files && skillView.files.length > 0
                          ? skillView.files.find((f) => f.path === skillView.activeFile)?.content ?? skillView.files[0].content
                          : skillView.content ?? '').slice(0, 300000) || '(empty skill)'}
                      </pre>
                    </>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </Panel>
    </div>
  );
}
