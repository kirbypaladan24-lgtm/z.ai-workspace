#!/usr/bin/env python3
"""Builds the createRun + submitPlan payloads for the EXP-000010 verification
run (VRUN-000005). All four bridge cases exceed the 2000-char command limit
and are staged in the run sandbox. V3 (Prisma runtime) runs in the Z.ai
sandbox VM as supplementary evidence (no node on the user's machine) and is
reported in the analysis, not as a bridge case."""
import json, pathlib

HERE = pathlib.Path(__file__).parent

RUN_ID = "VRUN-000005"
SB = f"knowledge/verification/sandbox/{RUN_ID}"

run_payload = {
    "knowledgeId": "EXP-000010",
    "knowledgeVersion": 3,
    "title": "Scientific verification: N+1 query counting, SQLite locking (docs + experiment), and Prisma relation-loading semantics (docs + sandbox experiment)",
    "problem": {
        "description": "EXP-000010 (latest version v3, content of the v2 technical revision) claims: (1) the N+1 pattern runs a query count that grows with row count while a batched read runs a constant count — MEASURE FIRST with query logging; (2) SQLite 'database is locked' is a WRITE-transaction problem, separate from read-side N+1: in the rollback-journal model a write transaction holds RESERVED and takes the database lock at commit, blocking other WRITERS; WAL mode allows readers during a write; a missing busy timeout surfaces as immediate lock errors; (3) 'include = one JOIN' is NOT guaranteed — relation loading may compile to a JOIN or a constant number of batched queries depending on ORM version, provider and relation shape — the verifiable requirement is the constant query count, not a presumed SQL shape; (4) there is no depth threshold that alone mandates denormalization (the v1 rule was removed as unsupported). This run executes the record's own verification plan: V1 (SQLite docs) and V2 (locking experiment) on the user's machine, V4 (Prisma docs for the installed major version, 6.x) on the user's machine, and V0 (N+1 counting on real SQLite). V3 (Prisma runtime query counting) requires node — absent on the user's machine — and was executed in the Z.ai sandbox VM with Prisma 6.19.2 as supplementary evidence reported in the analysis.",
        "symptoms": "list endpoints whose latency grows linearly with row count; SQLite 'database is locked' errors misdiagnosed as read-side N+1; assumed JOIN semantics for include; depth-threshold denormalization rules",
        "expectedBehavior": "V0: the loop pattern executes exactly N+1 queries (501 at 500 parents) while the single JOIN executes 1, with the loop measurably slower. V2: with a short busy timeout a second writer gets 'database is locked' while another writer holds an open transaction; with a real busy timeout it succeeds after the holder commits; in WAL mode a reader proceeds during a pending write while a second writer is still blocked. V1: the official SQLite documentation documents the RESERVED/PENDING lock states, that there can only be one writer at a time in WAL, that readers do not block writers, and the busy-handler semantics. V4: the official Prisma v6 documentation documents the query-logging configuration (new PrismaClient({log:['query',...]}), event-based logging via $on) and defines the n+1 problem ('one additional query per result'), including the batching nuance that the dataloader 'does not currently batch findMany() queries'.",
        "actualBehavior": "to be measured by real execution on the user's machine through the bridge (V0/V1/V2/V4) and in the Z.ai sandbox VM (V3, already executed: loop pattern 11->101 queries at 10->100 rows; include pattern a CONSTANT 2 queries — two batched SELECTs with an IN-list, NOT a single JOIN)",
        "facts": "SQLite rollback-journal lock states are SHARED/RESERVED/PENDING/EXCLUSIVE (sqlite.org/lockingv3.html); WAL allows exactly one writer at a time while readers proceed concurrently (sqlite.org/wal.html); the busy handler sleeps for a specified time when a table is locked (sqlite.org/c3ref/busy_timeout.html); Prisma 6.19.2 + SQLite compiles findMany({include}) to two batched queries (parent SELECT + child SELECT with parentId IN (...)) as observed in the sandbox experiment with event-based query logging; the user's machine has sqlite3 3.46.1 (CLI) and python3 3.14.4 (bundled sqlite reported at runtime).",
        "assumptions": "python3 stdlib sqlite3 on the user's machine behaves per the documented SQLite locking model; the sqlite.org and prisma.io pages fetched live are the authoritative current docs; the installed Prisma major version in the Z.ai sandbox (6.19.2, resolved from ^6.11.1) is representative of the v6 docs.",
        "environment": "user's machine via the bridge extension: Linux, Python 3.14.4, sqlite3 CLI 3.46.1, no node; Z.ai sandbox VM for V3: bun + Prisma 6.19.2",
        "constraints": "all experiments write only to mktemp temp dirs (nothing in the workspace); doc cases fetch only official sqlite.org and prisma.io pages and are flagged requiresNetwork; outputs below the 20KB truncation limit.",
    },
    "hypothesis": {
        "text": "All four bridge cases pass their declared criteria on real execution: the N+1 count grows exactly linearly (501 vs 1 queries at 500 rows) with measurable latency difference; the rollback-journal lock error reproduces with a short busy timeout and clears with a real one; WAL lets readers proceed while writers still serialize; the SQLite documentation contains the lock-state definitions, one-writer and busy-handler statements; and the Prisma v6 documentation documents the logging configuration, the n+1 definition and the findMany batching nuance. Together with the sandbox V3 result (constant 2-query include, growing loop), this verifies the record's core claims: measure query count, not SQL shape; SQLite locking is a separate write-side problem; include semantics are version/provider-dependent.",
        "expectedObservation": "markers: V0-NPLUS1-CONFIRMED, V2-SQLITE-LOCK-CONFIRMED, V1-DOC-VERIFIED, V4-DOC-VERIFIED",
        "supportingEvidence": "VM-local dry-runs reproduce V0 (501 vs 1 queries, 31.2x slower loop) and V2 (lock error, busy-timeout success, WAL reader proceeds, WAL writer blocked) on Python 3.12.16/sqlite 3.53.1; the doc scripts verified all assertions against live fetches; the V3 sandbox experiment (Prisma 6.19.2) already produced its output, preserved at scripts/verifications/exp010/v3-prisma-experiment-output.txt.",
        "contradictingEvidence": "none observed in dry-runs; the Prisma SQLite connector doc page contains no locking/concurrency documentation (checked during design) — the locking claims are therefore verified against SQLite's own docs, which is the authoritative source.",
    },
    "strategy": "Four bridge cases on the user's machine: V0 N+1 query counting on real SQLite (temp dir), V2 concurrent-writer locking experiment (rollback journal + WAL + busy timeout, threads, temp dir), V1 live SQLite documentation inspection (lockingv3, wal, busy_timeout), V4 live Prisma v6 documentation inspection (logging, query-optimization/N+1). V3 (Prisma runtime) executed in the Z.ai sandbox VM as supplementary labeled evidence. All cases critical; doc cases flagged requiresNetwork.",
}

cases = [
    {
        "name": "V0 N+1 measurement: loop pattern grows (N+1), single JOIN constant (1)",
        "objective": "verify the record's core MEASURE-FIRST claim on real SQLite: query count grows linearly with rows for the loop pattern and stays constant for the batched read",
        "category": "unit",
        "command": f"python3 {SB}/v0_nplus1_counts.py",
        "timeoutMs": 120000,
        "expected": {"expectedResult": "V0-NPLUS1-CONFIRMED with exact counts 501 vs 1", "successCriteria": "exit 0, loop executes exactly N+1=501 queries, JOIN exactly 1, loop slower", "failureCriteria": "counts differ or latency relationship not reproduced"},
        "criteria": {"exitCode": 0, "outputContains": ["V0-NPLUS1-CONFIRMED"], "outputNotContains": []},
        "flags": {"critical": True, "requiresNetwork": False, "destructive": False},
    },
    {
        "name": "V2 SQLite locking experiment: lock error, busy timeout, WAL concurrency",
        "objective": "verify the corrected locking explanation experimentally: second writer blocked during an open write transaction; busy timeout defers; WAL allows readers during a pending write while writers still serialize",
        "category": "integration",
        "command": f"python3 {SB}/v2_sqlite_locking.py",
        "timeoutMs": 120000,
        "expected": {"expectedResult": "V2-SQLITE-LOCK-CONFIRMED with all four observations", "successCriteria": "exit 0, 'database is locked' with short timeout, success with real timeout, WAL reader proceeds, WAL second writer blocked", "failureCriteria": "any of the four locking observations not reproduced"},
        "criteria": {"exitCode": 0, "outputContains": ["V2-SQLITE-LOCK-CONFIRMED"], "outputNotContains": []},
        "flags": {"critical": True, "requiresNetwork": False, "destructive": False},
    },
    {
        "name": "V1 doc-based: SQLite lock states, WAL one-writer, busy handler (live fetch)",
        "objective": "verify the corrected locking explanation against the ACTUAL official SQLite documentation",
        "category": "validation",
        "command": f"bash {SB}/v1_sqlite_docs.sh",
        "timeoutMs": 90000,
        "expected": {"expectedResult": "V1-DOC-VERIFIED with quotes from lockingv3, wal and busy_timeout pages", "successCriteria": "exit 0, RESERVED/PENDING state definitions found, one-writer-at-a-time found, busy-handler statement found", "failureCriteria": "doc fetch fails or documented statements differ from the record's explanation"},
        "criteria": {"exitCode": 0, "outputContains": ["V1-DOC-VERIFIED"], "outputNotContains": []},
        "flags": {"critical": True, "requiresNetwork": True, "destructive": False},
    },
    {
        "name": "V4 doc-based: Prisma v6 query logging + N+1 definition + batching nuance (live fetch)",
        "objective": "verify against the ACTUAL official Prisma v6 docs (installed major version): logging configuration, the n+1 definition, and the documented batching nuance",
        "category": "validation",
        "command": f"bash {SB}/v4_prisma_docs.sh",
        "timeoutMs": 90000,
        "expected": {"expectedResult": "V4-DOC-VERIFIED with quotes from the logging and query-optimization pages", "successCriteria": "exit 0, logging constructor + log array + events found, n+1 definition found, findMany batching nuance found", "failureCriteria": "doc fetch fails or documented statements differ"},
        "criteria": {"exitCode": 0, "outputContains": ["V4-DOC-VERIFIED"], "outputNotContains": []},
        "flags": {"critical": True, "requiresNetwork": True, "destructive": False},
    },
]

plan_payload = {
    "runId": RUN_ID,
    "experiments": "Four bridge cases staged in the run sandbox (V0 N+1 counting, V2 locking experiment with threads, V1 SQLite docs, V4 Prisma v6 docs), plus V3 executed in the Z.ai sandbox VM with Prisma 6.19.2 as supplementary labeled evidence (output preserved at scripts/verifications/exp010/v3-prisma-experiment-output.txt).",
    "cases": cases,
}

(HERE / "run-payload.json").write_text(json.dumps(run_payload, indent=1))
(HERE / "plan-payload.json").write_text(json.dumps(plan_payload, indent=1))
print(f"run-payload.json: {len(json.dumps(run_payload))} chars")
print(f"plan-payload.json: {len(json.dumps(plan_payload))} chars, {len(cases)} cases")
