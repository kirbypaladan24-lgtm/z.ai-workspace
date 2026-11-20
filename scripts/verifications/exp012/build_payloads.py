#!/usr/bin/env python3
"""Builds the payloads for the EXP-000012 verification run (VRUN-000007).
All five cases stage as sandbox scripts (four git experiments in temp dirs +
one local-man-page documentation inspection)."""
import json, pathlib

HERE = pathlib.Path(__file__).parent
RUN_ID = "VRUN-000007"
SB = f"knowledge/verification/sandbox/{RUN_ID}"

run_payload = {
    "knowledgeId": "EXP-000012",
    "knowledgeVersion": 2,
    "title": "Scientific verification: selective safe rollback — path-limited restore, path-limited stash, content-capture for mixed files, and the banned blanket restore (negative control)",
    "problem": {
        "description": "EXP-000012 (latest version v2, the technical revision) claims: (1) rollback must be SELECTIVE and SAFE — restore exactly what the agent changed (git restore -- <path>, git stash push -- <paths>, or re-apply captured pre-edit content), never repo-wide git checkout . / git reset --hard which destroy the user's unrelated uncommitted work; (2) when the agent's edit and the user's pre-existing WIP share ONE file, prefer restoring just the agent's hunks — the content-capture path (capture before the first edit, re-apply on failure) is the non-interactive mechanism; (3) the rollback must be CONFIRMED by re-running the exact failing check — the ORIGINAL error must reproduce as the known-green marker; (4) git restore -p and path-limited stash semantics are doc-verifiable. The v2 revision REMOVED the arbitrary two-attempt rewrite threshold (continuation is governed by information gain — process guidance, plan item V3, not mechanically testable per the record itself).",
        "symptoms": "agent rewrites spiral; user's uncommitted work destroyed by blanket restores; failed fixes stacked on unknown state; loss of attribution",
        "expectedBehavior": "V1a: after a failed agent edit, `git restore -- lib.js` (plus removing the agent's scratch file) leaves the USER's uncommitted WIP in app.js intact, removes exactly the agent's edit, and the ORIGINAL failing check reproduces. V1b: `git stash push -- lib.js` achieves the same with the change recoverable in the stash. V1c (negative control): the banned `git checkout -- .` destroys the user's WIP along with the agent's edit. V1d: when user WIP and the agent edit share one file, capturing the pre-edit content BEFORE the edit and re-applying it on failure restores the user's hunk and removes the agent's hunk, leaving the working tree at exactly the user's WIP. V2: the locally installed git documentation (man git-restore / man git-stash for git 2.53.0) documents path-scoped working-tree restore, interactive hunk selection, and stash push with pathspec.",
        "actualBehavior": "to be measured by real execution on the user's machine through the bridge",
        "facts": "git restore restores specified paths in the working tree from a restore source (default: the index); git stash push accepts pathspecs; the user's machine has git 2.53.0 with local man pages (phrases pre-verified via bridge probes); all experiments run in mktemp scratch dirs — nothing in the user's workspace is touched.",
        "assumptions": "git 2.53.0 semantics match the VM dry-run environment (git 2.47.3) for the operations used (restore, stash push with pathspec, checkout -- .); man pages are present on the user's machine (verified by probe).",
        "environment": "user's machine via the bridge extension: Linux, git 2.53.0, local man pages; VM dry-runs on git 2.47.3",
        "constraints": "every experiment writes only to mktemp -d scratch dirs (removed on exit); no workspace files touched; V2 uses local documentation (no network); outputs below the 20KB truncation limit.",
    },
    "hypothesis": {
        "text": "All five cases pass on real execution: the two selective mechanisms (path-limited restore, path-limited stash) preserve the user's uncommitted work while removing exactly the agent's edit and reproducing the original error; the banned blanket restore demonstrably destroys user work; the content-capture path handles the mixed-file case leaving the working tree at exactly the user's WIP; and the installed git's own documentation states the path-scoped restore and stash-pathspec semantics.",
        "expectedObservation": "markers: V1a-SELECTIVE-RESTORE-VERIFIED, V1b-PATH-LIMITED-STASH-VERIFIED, V1c-BLANKET-RESTORE-DAMAGE-CONFIRMED, V1d-CONTENT-CAPTURE-ROLLBACK-VERIFIED, V2-DOC-VERIFIED",
        "supportingEvidence": "VM dry-runs (git 2.47.3) reproduce all four experimental markers; all V2 man-page phrases were pre-verified present on the user's machine via bridge probes (git-restore: 'Restore working tree files', 'Restore specified paths in the working tree with some contents from a restore source', 'Interactively select hunks'; git-stash: 'new stash entry', 'pathspec', 'stash push ... pathspec').",
        "contradictingEvidence": "none observed in dry-runs; V2 cannot be dry-run in the VM (no git man pages there) — its phrases were verified directly on the target machine instead.",
    },
    "strategy": "Five cases, all staged in the run sandbox: V1a/V1b selective rollback mechanisms, V1c the banned-command negative control, V1d the mixed-file content-capture path, V2 local documentation inspection (man pages of the installed git). V3 (continuation criteria) is process guidance per the record's own plan and is not mechanically testable — no case, noted in the analysis.",
}

cases = [
    {
        "name": "V1a path-limited git restore: user WIP survives, agent edit gone, original error reproduces",
        "objective": "verify the record's primary selective-rollback mechanism end to end in a scratch repo",
        "category": "unit",
        "command": f"bash {SB}/v1a_restore_selective.sh",
        "timeoutMs": 60000,
        "expected": {"expectedResult": "V1a-SELECTIVE-RESTORE-VERIFIED", "successCriteria": "exit 0, user WIP intact, agent edit reverted, original error reproduced", "failureCriteria": "user work lost, agent edit survives, or the check outcome changes"},
        "criteria": {"exitCode": 0, "outputContains": ["V1a-SELECTIVE-RESTORE-VERIFIED"], "outputNotContains": []},
        "flags": {"critical": True, "requiresNetwork": False, "destructive": False},
    },
    {
        "name": "V1b path-limited stash: same guarantees, change recoverable",
        "objective": "verify git stash push -- <path> as the alternative selective rollback",
        "category": "unit",
        "command": f"bash {SB}/v1b_stash_pathlimited.sh",
        "timeoutMs": 60000,
        "expected": {"expectedResult": "V1b-PATH-LIMITED-STASH-VERIFIED", "successCriteria": "exit 0, user WIP intact, agent edit stashed (recoverable), original error reproduced", "failureCriteria": "any guarantee broken"},
        "criteria": {"exitCode": 0, "outputContains": ["V1b-PATH-LIMITED-STASH-VERIFIED"], "outputNotContains": []},
        "flags": {"critical": True, "requiresNetwork": False, "destructive": False},
    },
    {
        "name": "V1c negative control: repo-wide git checkout . destroys user work (why it is banned)",
        "objective": "demonstrate the blast radius of the banned blanket restore on the user's unrelated uncommitted work",
        "category": "negative",
        "command": f"bash {SB}/v1c_negative_checkout.sh",
        "timeoutMs": 60000,
        "expected": {"expectedResult": "V1c-BLANKET-RESTORE-DAMAGE-CONFIRMED", "successCriteria": "exit 0, user WIP destroyed by the banned command (damage demonstrated)", "failureCriteria": "user work survives the blanket restore (the ban would be unjustified)"},
        "criteria": {"exitCode": 0, "outputContains": ["V1c-BLANKET-RESTORE-DAMAGE-CONFIRMED"], "outputNotContains": []},
        "flags": {"critical": True, "requiresNetwork": False, "destructive": False},
    },
    {
        "name": "V1d mixed file: content-capture rollback preserves the user's hunk, removes the agent's",
        "objective": "verify the record's prescribed mechanism when the agent's edit and the user's pre-existing WIP share one file (capture pre-edit content before the first edit, re-apply on failure)",
        "category": "boundary",
        "command": f"bash {SB}/v1d_content_capture.sh",
        "timeoutMs": 60000,
        "expected": {"expectedResult": "V1d-CONTENT-CAPTURE-ROLLBACK-VERIFIED", "successCriteria": "exit 0, user hunk intact, agent hunk gone, working tree at exactly the user's WIP, original error reproduced", "failureCriteria": "either hunk mishandled"},
        "criteria": {"exitCode": 0, "outputContains": ["V1d-CONTENT-CAPTURE-ROLLBACK-VERIFIED"], "outputNotContains": []},
        "flags": {"critical": True, "requiresNetwork": False, "destructive": False},
    },
    {
        "name": "V2 doc-based: installed git's own man pages on restore/stash selectivity (local, no network)",
        "objective": "verify against the ACTUAL documentation of the installed git 2.53.0: path-scoped working-tree restore, interactive hunk selection, stash push with pathspec",
        "category": "validation",
        "command": f"bash {SB}/v2_git_docs.sh",
        "timeoutMs": 60000,
        "expected": {"expectedResult": "V2-DOC-VERIFIED", "successCriteria": "exit 0, all six documented phrases found in the local man pages", "failureCriteria": "man pages unavailable or documented statements differ"},
        "criteria": {"exitCode": 0, "outputContains": ["V2-DOC-VERIFIED"], "outputNotContains": []},
        "flags": {"critical": True, "requiresNetwork": False, "destructive": False},
    },
]

plan_payload = {
    "runId": RUN_ID,
    "experiments": "Five sandbox-staged cases: four git experiments in mktemp scratch repos (selective restore, path-limited stash, banned-command negative control, mixed-file content capture) plus a local man-page documentation inspection of the installed git. V3 (continuation criteria) is process guidance per the record's own plan — not mechanically testable.",
    "cases": cases,
}

(HERE / "run-payload.json").write_text(json.dumps(run_payload, indent=1))
(HERE / "plan-payload.json").write_text(json.dumps(plan_payload, indent=1))
print(f"run-payload.json: {len(json.dumps(run_payload))} chars")
print(f"plan-payload.json: {len(json.dumps(plan_payload))} chars, {len(cases)} cases")
