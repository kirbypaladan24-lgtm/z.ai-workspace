# Task 6-a — Knowledge tab (frontend only)

Task ID: 6-a
Scope: ONLY `/home/z/my-project/src/app/page.tsx`. No backend files touched. No new files in app code. No dependencies added (lucide icons `Brain, FlaskConical, History, Archive, Undo2` added to the existing lucide-react import).

## What was added

### Socket wiring (inside the existing main `useEffect`, next to `skill:list`)
- `socket.on('knowledge:state', ...)` — stores the full `KnowledgeState`, clears the refreshing spinner, pushes to the raw-event console (`v = verified + candidate`).

### Types (after `SkillFileView`)
- `KnowledgeStatus`, `KnowledgeStatusFilter`, `KnowledgeVerifStatus`, `KnowledgeEvidence`, `KnowledgeVersion`, `KnowledgeRecord`, `KnowledgeAttempt`, `KnowledgeFeedback`, `KnowledgeAudit`, `KnowledgeCounts`, `KnowledgeState` — exactly per the frozen spec.
- `SvcStatus` extended with `knowledge?: { counts?; online?; syncedAt?; note? } | null`.

### State (after skills state)
- `knowledge`, `knowledgeRefreshing`, `knowledgeSearch`, `knowledgeScope` (all|global|project), `knowledgeStatusFilter` (all|...6 statuses), `knowledgeCategory`, `knowledgeSelected`, `knowledgeConfirm`, `knowledgeActionError`, `knowledgeVersionsOpen`, `knowledgeOpenVersions` (Set<number>), `knowledgeAttemptsOpen`, `knowledgeAuditOpen`, `knowledgeConfirmTimer` (ref).

### Actions
- `knowledgeAction(action, opts, onDone)` — verbatim from spec (emits `knowledge:action`, guarded by `paired`).
- `refreshKnowledge()` — spinner + ack callback + 30s safety timeout.
- `selectKnowledge(id)` — toggle selection, resets confirm/error/open-version state.
- `toggleKnowledgeVersion(version)`.
- `runKnowledgeAction(action, opts, needsConfirm)` — two-click confirm pattern for destructive actions (reject/deprecate/archive/delete): first click arms "confirm?" for 4s, second click fires; after ack shows honest error if `!ok`, then always re-syncs via `knowledgeAction('refresh', ...)`.

### Derived data (useMemos after `totalFlatHits`)
- `knowledgeCounts`, `knowledgeTotal`, `knowledgeEmpty`, `knowledgeCategories`, `knowledgeRecords` (client-side search+scope+status+category filter), `selectedKnowledge`, `selectedKnowledgeVersions` (desc), `activeKnowledgeVersion`, `selectedKnowledgeFeedback`.

### UI — full-width Card between the Stats row and the Main grid
1. Header: Brain icon (teal) + "Knowledge" + total-records badge + verified/candidate/verifying/rejected/failed-attempts sub-badges + synced-at time (`timeStr`) + re-sync button (Loader2 spin, disabled when !paired or refreshing). When `knowledge` is null → subtle "syncing knowledge…" placeholder in the badge area.
2. Note line (yellow + AlertTriangle) when `knowledge.note`.
3. Explainer line when all record counts are zero (`knowledge/` in mono).
4. Filter row: search input + FeedChip scope chips + FeedChip status chips (+ category chips only when >1 category exists).
5. Library list (`max-h-72 overflow-y-auto`): row = status dot + id (mono blue-bright) + title + scope badge (blue/purple) + category + `vN · Nv` + worked✓/failed✗ + updated; progressive disclosure via responsive `hidden sm/md/lg/xl:inline`; active row `bg-vs-active`.
6. Inline detail panel (skill-viewer pattern, NOT a Dialog): header (id + title + status + close X), meta grid, active version content (problem/root-cause/solution mono block/environment/applicable/limitations), verification box (glyph + summary + evidence: exit-code glyph ✓/✗/?, command mono, journalRef badge, ts, summary, actor), "all versions" collapsible (default collapsed, per-version expandable), reuse feedback list, ack error line, right-aligned action buttons (Approve/Reject/Deprecate/Archive/Restore/Delete with visibility rules per spec).
7. Failed attempts section (collapsible, default collapsed, count badge, `max-h-48` list).
8. Audit log section (collapsible, default collapsed, count badge, `max-h-48` list).

### Small surgical updates
- `ActivityEntry.kind` union + `'knowledge'`.
- `ActivityRow` icon branch for `knowledge:*` tools (FlaskConical / Search / Brain / XCircle).
- Feed filter 'ai' includes `e.kind === 'knowledge'`.
- Footer status bar: `{(knowledge?.counts?.verified ?? 0) > 0 && <span>… N verified</span>}` after the skills span.
- `FeedChip` gained an optional `testId` prop (backward compatible) so knowledge filter chips can carry data-testids.

### Sub-components / helpers added (bottom of file / near timeStr)
- `knowledgeStatusMeta(s)`, `knowledgeVerifMeta(s)` (defensive default branches for unknown runtime strings), `shortWhen(value)` (time today / short date otherwise), `KnowledgeMetaItem`, `KnowledgeVersionView`.

## Verification
- `bun run lint` → exit 0, zero errors.
- `bunx tsc --noEmit` → zero errors in `src/app/page.tsx` (only pre-existing errors in out-of-scope files: examples/, extension/, mini-services/, skills/ — untouched by this task; also lint-ignored).
- dev.log: `✓ Compiled` + `GET / 200` with no compile errors after every save.
- SSR sanity: `curl /` renders `knowledge-card` + `knowledge-syncing` + LockedPanel text (unpaired state), no crash when knowledge is null.

## data-testids added (static)
knowledge-card, knowledge-syncing, knowledge-synced-at, knowledge-refresh, knowledge-loading, knowledge-note, knowledge-explainer, knowledge-filters, knowledge-search, knowledge-list, knowledge-empty, knowledge-row (+ data-knowledge-id / data-knowledge-status attrs), knowledge-detail, knowledge-detail-close, knowledge-meta, knowledge-active-version, knowledge-versions-toggle, knowledge-version-header (+ data-version), knowledge-version-content, knowledge-solution, knowledge-verification, knowledge-feedback, knowledge-feedback-row, knowledge-action-error, knowledge-actions, knowledge-approve, knowledge-reject, knowledge-deprecate, knowledge-archive, knowledge-restore, knowledge-delete, knowledge-total-badge, knowledge-count-verified, knowledge-count-candidate, knowledge-count-pending, knowledge-count-rejected, knowledge-count-attempts, knowledge-attempts-section, knowledge-attempts-toggle, knowledge-attempts-count, knowledge-attempts-empty, knowledge-attempts-list, knowledge-attempt-row, knowledge-audit-section, knowledge-audit-toggle, knowledge-audit-count, knowledge-audit-empty, knowledge-audit-list, knowledge-audit-row.
Dynamic: `knowledge-filter-scope-{all|global|project}`, `knowledge-filter-status-{all|verified|candidate|verification_pending|rejected|deprecated|archived}`, `knowledge-filter-category-{cat}`.

## Deviations (minor, intentional)
1. Category filter chips render only when the library has more than one category (the spec required the category filter state; the search box also matches category text).
2. Detail is one inline panel with an internal "all versions" collapsible rather than tabs — spec said "keep simple: one detail dialog".
3. Reject visibility checks `status !== 'rejected'`; the 'deleted' half of "not already rejected/deleted" is structurally satisfied because soft-deleted records are excluded from `experiences` (deletedAt is typed `null`).
4. stopPropagation was not needed anywhere: rows and version headers are plain `<button>` elements (existing FileRow convention) with no nested interactive elements.
5. `FeedChip` got an optional `testId` prop (no behavior change for existing usages).
6. One lucide detail: lucide icons in this version don't accept `title`, so the attempt result-glyph title moved to a wrapping `<span title>`.

## Notes for later tasks
- Server pushes `knowledge:state` automatically on pair (verified in spec; no change made to the `pair:ok` handler).
- Actions available over `knowledge:action`: refresh, approve, reject, deprecate, archive, restore, delete — all wired in the detail panel with honest ack errors and post-action re-sync.
