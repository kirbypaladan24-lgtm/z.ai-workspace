# Verification Store — Scientific Verification Engine

Evidence records for the Workspace Bridge verification runs. Plain JSONL —
portable with the repo, git-versioned, human-readable. GLM designs the
experiments; this store only ever contains results captured by the bridge
from REAL executions on this machine (exit codes, output, durations).

| File          | Contents                                              |
|---------------|-------------------------------------------------------|
| runs.jsonl    | One verification run per line (steps, rounds, analyses, conclusion) |
| cases.jsonl   | Test cases — the declared plan and criteria           |
| attempts.jsonl| Every real execution attempt (redacted output)        |
| metrics.jsonl | Measured/reported metrics, tied to test attempts      |
| evidence.jsonl| Evidence artifacts (reports live in evidence/<runId>/)|
| meta.json     | Schema version + ID counters (managed by the bridge)  |

Lifecycle: PENDING → PLANNING → READY → TESTING → ANALYZING →
VERIFIED | PARTIALLY_VERIFIED | FAILED | BLOCKED. Failed attempts are
never deleted — every round and every retry is preserved. A verification
run NEVER approves knowledge by itself; the owner stays in control.
