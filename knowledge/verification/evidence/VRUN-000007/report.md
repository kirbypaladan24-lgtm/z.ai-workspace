# Verification Report — VRUN-000007

- **Knowledge record:** EXP-000012 (version 2) — AI-operator self-correction: minimal surgical edits, one change per cycle, revert before the next attempt — the antidote to overthinking
- **Verification status:** VERIFIED
- **Conclusion:** VERIFIED — all 5 critical test(s) passed against real executions
- **Generated:** 2026-11-19T11:32:06.823Z by the bridge (from persisted records only)

## 1. Original problem
EXP-000012 (latest version v2, the technical revision) claims: (1) rollback must be SELECTIVE and SAFE — restore exactly what the agent changed (git restore -- <path>, git stash push -- <paths>, or re-apply captured pre-edit content), never repo-wide git checkout . / git reset --hard which destroy the user's unrelated uncommitted work; (2) when the agent's edit and the user's pre-existing WIP share ONE file, prefer restoring just the agent's hunks — the content-capture path (capture before the first edit, re-apply on failure) is the non-interactive mechanism; (3) the rollback must be CONFIRMED by re-running the exact failing check — the ORIGINAL error must reproduce as the known-green marker; (4) git restore -p and path-limited stash semantics are doc-verifiable. The v2 revision REMOVED the arbitrary two-attempt rewrite threshold (continuation is governed by information gain — process guidance, plan item V3, not mechanically testable per the record itself).

**Symptoms:** agent rewrites spiral; user's uncommitted work destroyed by blanket restores; failed fixes stacked on unknown state; loss of attribution
**Expected:** V1a: after a failed agent edit, `git restore -- lib.js` (plus removing the agent's scratch file) leaves the USER's uncommitted WIP in app.js intact, removes exactly the agent's edit, and the ORIGINAL failing check reproduces. V1b: `git stash push -- lib.js` achieves the same with the change recoverable in the stash. V1c (negative control): the banned `git checkout -- .` destroys the user's WIP along with the agent's edit. V1d: when user WIP and the agent edit share one file, capturing the pre-edit content BEFORE the edit and re-applying it on failure restores the user's hunk and removes the agent's hunk, leaving the working tree at exactly the user's WIP. V2: the locally installed git documentation (man git-restore / man git-stash for git 2.53.0) documents path-scoped working-tree restore, interactive hunk selection, and stash push with pathspec.
**Actual:** to be measured by real execution on the user's machine through the bridge

**Facts:** git restore restores specified paths in the working tree from a restore source (default: the index); git stash push accepts pathspecs; the user's machine has git 2.53.0 with local man pages (phrases pre-verified via bridge probes); all experiments run in mktemp scratch dirs — nothing in the user's workspace is touched.
**Assumptions:** git 2.53.0 semantics match the VM dry-run environment (git 2.47.3) for the operations used (restore, stash push with pathspec, checkout -- .); man pages are present on the user's machine (verified by probe).

## 2. Hypothesis (initial)
All five cases pass on real execution: the two selective mechanisms (path-limited restore, path-limited stash) preserve the user's uncommitted work while removing exactly the agent's edit and reproducing the original error; the banned blanket restore demonstrably destroys user work; the content-capture path handles the mixed-file case leaving the working tree at exactly the user's WIP; and the installed git's own documentation states the path-scoped restore and stash-pathspec semantics.

**Expected observation:** markers: V1a-SELECTIVE-RESTORE-VERIFIED, V1b-PATH-LIMITED-STASH-VERIFIED, V1c-BLANKET-RESTORE-DAMAGE-CONFIRMED, V1d-CONTENT-CAPTURE-ROLLBACK-VERIFIED, V2-DOC-VERIFIED

## 3. Hypothesis history (all rounds preserved)
- **Round 1** (initial): All five cases pass on real execution: the two selective mechanisms (path-limited restore, path-limited stash) preserve the user's uncommitted work while removing exactly the agent's edit and reproducing the original error; the banned blanket restore demonstrably destroys user work; the content-capture path handles the mixed-file case leaving the working tree at exactly the user's WIP; and the installed git's own documentation states the path-scoped restore and stash-pathspec semantics. — _initial hypothesis_ → 4/5 executed tests passed (pass rate 80%)
- **Round 2** (regression): The V2 failure was a case-definition flaw, not a documentation mismatch: the man page hard-wraps the sentence 'Restore specified paths in the working tree with some contents from a restore source' across two lines, so the literal single-line grep missed it (the probe had verified the phrase exists, split by the wrap). Normalizing newlines/whitespace before matching makes all six assertions pass without weakening any of them. — _root cause: man-page line wrapping broke a literal substring match (attempt VTA-000039 preserved: 5/6 phrases found, the wrapped one missed). Fix: the case command now pipes the man output through tr '\n' ' ' + squeeze before matching; the sandbox script was restaged with the identical normalization. No assertion was weakened._ → 5/5 executed tests passed (pass rate 100%)

## 4. Testing environment
- OS: Linux kirby-LOQ-15IAX9E 7.0.0-43-generic #43-Ubuntu SMP PREEMPT_DYNAMIC Fri Oct 23 13:25:25 UTC 2026 x86_64 GNU/Linux
exit code: 0
- Runtimes: Python 3.14.4
/bin/bash: line 1: node: command not found
git version 2.53.0
3.46.1 2024-08-13 09:16:08 c9c2ab54ba1f5f46360f1b4f35d849cd3f080e6fc2b6c60e91b16c63f69aalt1 (64-bit)
exit code: 0
- Source revision: 6c04b92

## 5. Statistics (computed by the bridge)
| planned | executed | passed | failed | errors | skipped | blocked | attempts | pass rate |
|---|---|---|---|---|---|---|---|---|
| 5 | 5 | 5 | 0 | 0 | 0 | 0 | 6 | 100% |

## 6. Test results (every attempt preserved)
### VTC-000028 — V1a path-limited git restore: user WIP survives, agent edit gone, original error reproduces [PASS] (unit, critical)
- Objective: verify the record's primary selective-rollback mechanism end to end in a scratch repo
- Command: `bash knowledge/verification/sandbox/VRUN-000007/v1a_restore_selective.sh`
- Success criteria: exit 0 + output contains ["V1a-SELECTIVE-RESTORE-VERIFIED"]
- **Attempt 1: PASS** (exit 0, 290ms, journal cmkpgxbh) — exit 0 + 1 output assertion(s) satisfied

```
$ bash knowledge/verification/sandbox/VRUN-000007/v1a_restore_selective.sh
V1a confirm: original error reproduced after rollback (known-green marker)
V1a-user-wip-survived: YES
V1a-agent-edit-gone: YES
V1a-SELECTIVE-RESTORE-VERIFIED
exit code: 0
```

### VTC-000029 — V1b path-limited stash: same guarantees, change recoverable [PASS] (unit, critical)
- Objective: verify git stash push -- <path> as the alternative selective rollback
- Command: `bash knowledge/verification/sandbox/VRUN-000007/v1b_stash_pathlimited.sh`
- Success criteria: exit 0 + output contains ["V1b-PATH-LIMITED-STASH-VERIFIED"]
- **Attempt 1: PASS** (exit 0, 242ms, journal 58ooo5em) — exit 0 + 1 output assertion(s) satisfied

```
$ bash knowledge/verification/sandbox/VRUN-000007/v1b_stash_pathlimited.sh
V1b confirm: original error reproduced after path-limited stash
V1b-user-wip-survived: YES
V1b-agent-edit-gone: YES
V1b-stashed-change-recoverable: YES
V1b-PATH-LIMITED-STASH-VERIFIED
exit code: 0
```

### VTC-000030 — V1c negative control: repo-wide git checkout . destroys user work (why it is banned) [PASS] (negative, critical)
- Objective: demonstrate the blast radius of the banned blanket restore on the user's unrelated uncommitted work
- Command: `bash knowledge/verification/sandbox/VRUN-000007/v1c_negative_checkout.sh`
- Success criteria: exit 0 + output contains ["V1c-BLANKET-RESTORE-DAMAGE-CONFIRMED"]
- **Attempt 1: PASS** (exit 0, 195ms, journal hz07q7q4) — exit 0 + 1 output assertion(s) satisfied

```
$ bash knowledge/verification/sandbox/VRUN-000007/v1c_negative_checkout.sh
V1c-user-wip-after-banned-command: DESTROYED (user work lost)
V1c-agent-edit-after-banned-command: gone
V1c conclusion: the repo-wide rollback destroyed the USER's unrelated uncommitted work — the reason the record bans it
V1c-BLANKET-RESTORE-DAMAGE-CONFIRMED
exit code: 0
```

### VTC-000031 — V1d mixed file: content-capture rollback preserves the user's hunk, removes the agent's [PASS] (boundary, critical)
- Objective: verify the record's prescribed mechanism when the agent's edit and the user's pre-existing WIP share one file (capture pre-edit content before the first edit, re-apply on failure)
- Command: `bash knowledge/verification/sandbox/VRUN-000007/v1d_content_capture.sh`
- Success criteria: exit 0 + output contains ["V1d-CONTENT-CAPTURE-ROLLBACK-VERIFIED"]
- **Attempt 1: PASS** (exit 0, 120ms, journal qtp2pes3) — exit 0 + 1 output assertion(s) satisfied

```
$ bash knowledge/verification/sandbox/VRUN-000007/v1d_content_capture.sh
V1d confirm: original error reproduced after content-capture rollback
V1d-user-hunk-survived: YES
V1d-agent-hunk-gone: YES
V1d working tree: back to exactly the user's uncommitted WIP (git diff non-empty, no agent content)
V1d-CONTENT-CAPTURE-ROLLBACK-VERIFIED
exit code: 0
```

### VTC-000032 — V2 doc-based: installed git's own man pages on restore/stash selectivity (local, no network) [PASS] (validation, critical)
- Objective: verify against the ACTUAL documentation of the installed git 2.53.0: path-scoped working-tree restore, interactive hunk selection, stash push with pathspec
- Command: `bash knowledge/verification/sandbox/VRUN-000007/v2_git_docs.sh`
- Success criteria: exit 0 + output contains ["V2-DOC-VERIFIED"]
- **Attempt 1: FAIL** (exit 1, 300ms, journal up6b00fx) — exit code 1 ≠ expected 0

```
$ bash knowledge/verification/sandbox/VRUN-000007/v2_git_docs.sh
DOC-SOURCE-1: man git-restore (local documentation of the installed git 2.53.0)
DOC-restore: FOUND: git-restore - Restore working tree files
DOC-restore: MISSING: Restore specified paths in the working tree with some contents from a restore source
DOC-restore: FOUND: Interactively select hunks
DOC-SOURCE-2: man git-stash (local documentation of the installed git)
DOC-stash: FOUND: new stash entry
DOC-stash: FOUND: pathspec
DOC-stash-push-pathspec-synopsis: FOUND
V2-DOC-NOT-VERIFIED
exit code: 1
```
- **Attempt 2: PASS** (exit 0, 157ms, journal 901mc36c) — exit 0 + 1 output assertion(s) satisfied

```
$ bash knowledge/verification/sandbox/VRUN-000007/v2_git_docs.sh
DOC-SOURCE-1: man git-restore (local documentation of the installed git 2.53.0)
DOC-restore: FOUND: git-restore - Restore working tree files
DOC-restore: FOUND: Restore specified paths in the working tree with some contents from a restore source
DOC-restore: FOUND: Interactively select hunks
DOC-SOURCE-2: man git-stash (local documentation of the installed git)
DOC-stash: FOUND: new stash entry
DOC-stash: FOUND: pathspec
DOC-stash-push-pathspec-synopsis: FOUND
V2-DOC-VERIFIED
exit code: 0
```

## 7. Metrics
- **user_wip_preserved_selective:** YES — measured (verified against cited output)
- **user_wip_after_blanket_restore:** DESTROYED — measured (verified against cited output)
- **mixed_file_user_hunk_preserved:** YES — measured (verified against cited output)

## 8. AI INTERPRETATION (submitted by GLM — not measurement)
### Round 2 analysis (by GLM (z.ai web))
All 5 critical cases passed against real executions on the user's machine (round 2; round 1 preserved one failed attempt VTA-000039 whose cause was a case-definition flaw — man-page line wrapping broke a literal substring match — fixed by normalizing whitespace, no assertion weakened). Measured: V1a path-limited `git restore -- lib.js` removed exactly the agent's failed edit (plus its scratch file) while the USER's uncommitted WIP in app.js survived, and the ORIGINAL failing check reproduced after rollback (the record's known-green confirmation marker). V1b `git stash push -- lib.js` achieved the same guarantees with the stashed change recoverable in the stash list. V1c (negative control) the banned repo-wide `git checkout -- .` destroyed the user's uncommitted WIP along with the agent's edit — the demonstrated blast radius justifying the record's ban. V1d when the user's WIP and the agent's edit shared ONE file, the record's prescribed content-capture path (capture pre-edit content before the first edit, re-apply on failure) restored the user's hunk, removed the agent's hunk, and left the working tree at exactly the user's WIP (git diff non-empty, no agent content). V2 the locally installed git 2.53.0's own documentation (man git-restore, man git-stash) documents 'Restore working tree files', 'Restore specified paths in the working tree with some contents from a restore source', 'Interactively select hunks' (patch mode), 'new stash entry', 'pathspec', and the stash-push pathspec synopsis — the selective-rollback semantics are exactly as the record describes.

**Expected vs observed:** Every prediction matched: both selective mechanisms preserved user work while reverting exactly the agent's edit and reproducing the original error; the blanket restore destroyed user work; the mixed-file content-capture path left the tree at exactly the user's WIP; and all six documented phrases were found in the installed git's man pages after whitespace normalization.
**Alternative explanations:** (1) The experiments use crafted scratch repos in mktemp dirs — they verify git's MECHANICS, not any real repository of the user; the user's actual workspace was never touched. (2) git restore -p (interactive hunk selection) could not be exercised non-interactively; its semantics are doc-verified (V2: 'Interactively select hunks') and the non-interactive content-capture path (V1d) covers the same mixed-file requirement. (3) The VM dry-run environment runs git 2.47.3 while the user machine has 2.53.0 — all four experimental behaviors were identical on both, and the doc assertions target the user machine's own man pages. (4) V3 (continuation/stop criteria) is process guidance — the record's own plan classifies it as not mechanically testable; no case was created for it.
**Recommended modifications:** The verified evidence supports the record's revised claims in full. For the owner's review: the two-attempt threshold removal is justified (V3 is guidance, not a rule); the selective-rollback safety property is now demonstrated for all three prescribed mechanisms (path restore, path stash, content capture) with the negative control showing why blanket restores are banned.

**Proposed conclusion:** VERIFIED — All 5 critical test cases passed on real executions on the user's machine: path-limited restore and path-limited stash both preserve the user's uncommitted work while reverting exactly the agent's failed edit (original error reproducing as the known-green marker); the banned repo-wide checkout demonstrably destroys user work; the content-capture path handles the mixed-file case leaving the tree at exactly the user's WIP; and the installed git's own documentation states the selective semantics. The removed two-attempt threshold required no evidence (a removal, like EXP-000011's retracted superlative).
**Engine decision:** ACCEPTED → VERIFIED. GLM's proposal matches the evidence: all 5 critical test(s) passed against real executions

## 9. Limitations
- Commands executed on the user's machine through the VS Code extension as the local user — no CPU/memory sandbox isolation is enforceable through this transport.
- Network access for non-flagged tests could not be technically blocked; tests that declared network needs required explicit owner confirmation instead.
- Attempt outputs are redacted for secrets and capped at 20,000 characters per attempt.