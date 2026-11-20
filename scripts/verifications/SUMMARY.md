# Verification Runs — Reproducibility Index

Scientific verification of knowledge records EXP-000008..012 (second curation
pass), executed 2026-11-19 through the Workspace Bridge verification engine.
Every test ran on the USER'S machine via the paired VS Code extension
(`/bin/bash -c`, cwd = workspace root) unless explicitly labeled otherwise.
Evidence lives in the user's workspace: `knowledge/verification/` (runs,
cases, attempts, metrics, evidence) — the reports are sha256-stamped by the
engine. This folder holds the design-side artifacts (scripts, payloads, dry-run
outputs, sandbox experiment results).

## Engine statistics (bridge-computed, never GLM-asserted)

| Run | Record | Verdict | Cases | Attempts | Rounds | Evidence |
|-----|--------|---------|-------|----------|--------|----------|
| VRUN-000003 | EXP-000008 v3 | VERIFIED | 8/8 passed (100%) | 13 (5 failed infra attempts preserved) | 2 | VEVA-000006 |
| VRUN-000004 | EXP-000009 v3 | VERIFIED | 5/5 passed (100%) | 5 | 1 | VEVA-000008 |
| VRUN-000005 | EXP-000010 v3 | VERIFIED | 4/4 passed (100%) | 4 | 1 | VEVA-000010 |
| VRUN-000006 | EXP-000011 v3 | VERIFIED | 2/2 passed (100%) | 2 | 1 | VEVA-000012 |
| VRUN-000007 | EXP-000012 v2 | VERIFIED | 5/5 passed (100%) | 6 (1 failed definition attempt preserved) | 2 | VEVA-000014 |

Overall: 32 planned / 32 executed / 32 passed / 0 failed / 0 errors / 0 blocked;
pass rate 100% (passed/(passed+failed)); 40 total attempts preserved. Two
GLM-proposed metrics were REJECTED by the bridge validator in VRUN-000007
(values not present verbatim in the cited outputs) — the evidence gate worked.

## Environment snapshots (captured by the engine, per run)

- User machine: Linux kirby-LOQ-15IAX9E, Python 3.14.4, numpy 2.3.5 (unused —
  stdlib-only experiments), torch ABSENT, node ABSENT, git 2.53.0,
  sqlite3 3.46.1 (python sqlite module 3.46.1), local man pages present,
  outbound HTTPS available.
- Z.ai sandbox VM (supplementary experiments, clearly labeled): bun, tsc 5.9.3,
  Prisma 6.19.2 (resolved from ^6.11.1), socket.io-client 4.8.4.

## Case inventory (32 bridge-executed cases)

- exp008: C1 analytic baselines, C2 class-spanning, C4a healthy-pipeline PASS
  (FD-certified pure-python MLP), C4b shuffled-labels FAIL (negative control),
  C4c capacity boundary (excess capacity memorizes shuffled labels), C5 fixed
  threshold scale-dependence, C6 zero-grads-normal (dead ReLUs), C3 PyTorch
  2.15 CrossEntropyLoss docs (live fetch, quotes captured).
- exp009: C1 chance floors, C2 confident-CE→0, C5 flat-loss three-cause
  ambiguity (value+checks disambiguate), C6 NaN/Inf-early ambiguity (loss
  fault vs LR fault), C3 PyTorch 2.15 clip_grad_norm_ docs (live fetch).
- exp010: V0 N+1 counting on real SQLite (501 vs 1 queries), V2 SQLite locking
  experiment (lock error, busy timeout, WAL reader concurrency, WAL writer
  serialization), V1 SQLite docs (lockingv3/wal/busy_timeout, quotes), V4
  Prisma v6 docs (logging + n+1 definition + batching nuance). Sandbox
  supplement: Prisma 6.19.2 loop 11→101 queries vs include constant 2 queries
  (batched IN-list, NOT one JOIN) — see exp010/v3-prisma-experiment-output.txt.
- exp011: V1a three-layer chain on the real workspace (manifest range
  ^6.11.1 → lockfile pin @6.19.2, fabricated package caught, node_modules
  absence recorded), V3 Bun lockfile docs. Sandbox supplements: installed-tree
  chain (6.19.2 consistent), tsc controls (TS2339 fabricated / TS2554 wrong
  shape; grep blind spot) — see exp011/v2-tsc-experiment-output.txt.
- exp012: V1a path-limited restore, V1b path-limited stash, V1c banned
  blanket-restore negative control (user WIP destroyed), V1d mixed-file
  content-capture rollback, V2 installed-git man-page docs (local).

## Reproducing a run

Every case command invokes a script staged in the run's sandbox on the user's
machine (`knowledge/verification/sandbox/<runId>/…`, sha256-verified at
staging; the attempt records embed the exact commands and outputs). The
authoritative copies of the same scripts live here:

    scripts/verifications/exp00NN/<case>.py|.sh        (executed on the user machine)
    scripts/verifications/exp00NN/build_payloads.py    (run + plan payloads)
    scripts/verifications/exp00NN/run-payload.json     (as submitted)
    scripts/verifications/exp00NN/plan-payload.json    (as submitted)

To re-verify: re-stage the scripts to a new run's sandbox via the admin API,
submit the plan payload (with the new runId), start, and compare attempt
outputs — all experiments are deterministic (fixed seeds; doc checks re-fetch
live sources and record DOC-SOURCE/DOC-VERSION).

## Documentation sources actually inspected (live, recorded in attempts)

- PyTorch 2.15 CrossEntropyLoss (VTA-000023) and clip_grad_norm_ (VTA-000028)
- SQLite lockingv3.html, wal.html, busy_timeout.html (VTA-000031)
- Prisma v6 observability-and-logging/logging, queries/query-optimization-performance (VTA-000032)
- Bun bun.sh/docs/install/lockfile (VTA-000034)
- Local man pages: git-restore(1), git-stash(1) for the installed git 2.53.0 (VTA-000040)
- Note: the Prisma SQLite connector page was fetched and inspected during
  design — it contains NO locking/concurrency documentation (relevant negative
  finding; locking claims are verified against SQLite's own docs).

## Incidents during verification (preserved, root-caused, fixed)

1. VRUN-000003 round 1: five cases failed because the engine silently
   truncated case commands to 2000 chars (attempts VTA-000013/14/15/17/18
   preserve the mangled commands and their SyntaxErrors). Fix: the engine now
   REFUSES commands over MAX_CASE_COMMAND_CHARS=2000; long scripts are staged
   in the run sandbox and invoked by path. Regression round 2 re-executed all
   five with intact commands.
2. VRUN-000007 round 1: one doc case failed because man pages hard-wrap
   sentences (attempt VTA-000039 preserved). Fix: whitespace normalization
   before matching; no assertion weakened.
3. Design-iteration findings caught in VM dry-runs (never submitted as
   failing engine attempts, reported in analyses): capacity sensitivity of the
   tiny-batch protocol (became case C4c), a noise-vs-signal scaling bug in an
   early C5 draft, a math.log(0) crash in an early C6 draft, an over-strict
   C2 threshold, and pytorch.org intermittently serving bot-protection
   challenges on the stable path (doc scripts fall back to the versioned URL
   and record which source actually served).
