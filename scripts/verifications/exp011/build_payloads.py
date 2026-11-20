#!/usr/bin/env python3
"""Builds the payloads for the EXP-000011 verification run (VRUN-000006).
Bridge cases: V1a (three-layer chain on the user's real workspace) and V3
(Bun lockfile documentation). V1b (layer 3 with node_modules) and V2 (tsc
controls) ran in the Z.ai sandbox VM as supplementary evidence per the
record's own plan ('the sandbox has an installed project')."""
import json, pathlib

HERE = pathlib.Path(__file__).parent
RUN_ID = "VRUN-000006"
SB = f"knowledge/verification/sandbox/{RUN_ID}"

run_payload = {
    "knowledgeId": "EXP-000011",
    "knowledgeVersion": 3,
    "title": "Scientific verification: three-layer dependency verification (manifest -> lockfile -> installed) on the real workspace, lockfile semantics from the docs, and type-check-beats-grep in the sandbox",
    "problem": {
        "description": "EXP-000011 (latest version v3, content of the v2 technical revision) claims: (1) three layers are commonly confused — what the DOCS describe (latest release), what the lockfile RESOLVED (a specific version), and what node_modules CONTAINS (what runs) — and verification must walk down that chain because each layer can differ; (2) the project's lockfile records the exact resolved version while the manifest carries ranges; (3) a type check is STRONGER than grep because it validates call shape, not just name presence; (4) hallucinated dependencies are caught by checking manifest+lockfile before use. The v1 '#1 agent bug source' superlative was retracted in v2 and the ranking is now explicitly unquantified (nothing to verify — the retraction REMOVED a claim). This run executes the record's plan: V1a on the user's real workspace (manifest + lockfile layers, fabricated-dependency negative control, node_modules absence recorded honestly if applicable), V3 live Bun lockfile documentation, and V1b/V2 in the Z.ai sandbox VM (node_modules present, tsc available) as supplementary labeled evidence.",
        "symptoms": "agent-written code calling APIs that do not exist in the installed version; runtime 'x.y is not a function' failures; confusing the latest documented release with the resolved/installed version",
        "expectedBehavior": "V1a on the user's workspace: @prisma/client declared as the range ^6.11.1 in the manifest, resolved to the EXACT version @prisma/client@6.19.2 in bun.lock (with registry tarball + integrity), the drift between layers demonstrated, a plausible fabricated package (react-super-router) present in NEITHER layer (caught), and node_modules observed absent (no node runtime on that machine) — recorded as an environmental limitation, with layer 3 demonstrated in the sandbox. V3 the official Bun documentation states bun install creates bun.lock, the format is text-based (since v1.2), a lockfile can be generated WITHOUT installing to node_modules (--lockfile-only — the layer distinction), and it should be committed to git. V1b (sandbox): manifest ^6.11.1 -> lockfile @6.19.2 -> node_modules 6.19.2, all three layers consistent. V2 (sandbox): tsc passes the correct call (exit 0), fails the fabricated method (TS2339 Property does not exist), fails the real method with wrong call shape (TS2554) while grep still finds the method name 11 times in the .d.ts — the grep blind spot.",
        "actualBehavior": "to be measured by real execution (V1a/V3 on the user's machine; V1b/V2 already executed in the Z.ai sandbox VM, outputs preserved at scripts/verifications/exp011/)",
        "facts": "the user's workspace is the z.ai-workspace-bridge clone with package.json (67 dependencies, ranges) and bun.lock (945 resolved packages, text-based JSONC-lenient format) but no node_modules; the Z.ai sandbox VM has the same project WITH node_modules and tsc 5.9.3; socket.io-client is installed at 4.8.4 in the sandbox.",
        "assumptions": "the user's bun.lock parses with trailing-comma tolerance; the bun.sh docs page fetched live is authoritative; the sandbox's installed tree is representative of what the user's machine would contain after bun install.",
        "environment": "user's machine via the bridge extension (Linux, Python 3.14.4, no node) for V1a/V3; Z.ai sandbox VM (bun, tsc 5.9.3, node_modules present) for V1b/V2",
        "constraints": "V1a only READS the workspace (package.json, bun.lock, node_modules if present); the doc case fetches only the official bun.sh page; outputs below the 20KB truncation limit.",
    },
    "hypothesis": {
        "text": "Both bridge cases pass: the three-layer chain verifies on the user's real workspace with the manifest-range vs lockfile-pin drift demonstrated and the fabricated dependency caught at layers 1-2 (node_modules absent recorded honestly), and the Bun documentation confirms the lockfile semantics (created by bun install, text-based, distinct from node_modules, committed to git). The sandbox supplements (already executed) complete the evidence: all three layers consistent in the installed project, and tsc catching both the fabricated API and the wrong call shape that grep cannot see.",
        "expectedObservation": "markers: V1A-CHAIN-VERIFIED, V3-DOC-VERIFIED",
        "supportingEvidence": "VM dry-run of V1a on the fully-installed project reproduces the whole chain (^6.11.1 -> @6.19.2 -> installed 6.19.2, fabricated caught); V3 assertions verified against a live fetch; V2 tsc outputs preserved with exit codes (0 / TS2339 / TS2554) at scripts/verifications/exp011/v2-tsc-experiment-output.txt.",
        "contradictingEvidence": "none observed; note that on the user's machine layer 3 cannot be exercised (no node_modules) — this is recorded in the case output itself, not hidden.",
    },
    "strategy": "Two bridge cases (V1a real-workspace chain with negative control; V3 live Bun lockfile docs) plus two sandbox supplements per the record's own plan designation (V1b installed-tree chain, V2 tsc-vs-grep controls). All bridge cases critical; the doc case flagged requiresNetwork.",
}

cases = [
    {
        "name": "V1a three-layer chain on the real workspace (manifest -> lockfile -> installed/absent)",
        "objective": "verify the record's core method on the user's actual project files: manifest ranges, lockfile exact pins, layer drift, fabricated-dependency negative control, and honest layer-3 observation",
        "category": "integration",
        "command": f"python3 {SB}/v1a_chain.py",
        "timeoutMs": 60000,
        "expected": {"expectedResult": "V1A-CHAIN-VERIFIED with the drift printed and the fabricated package caught", "successCriteria": "exit 0, manifest range found, exact lockfile pin found, drift shown, fabricated in neither layer, layer 3 verified or absence recorded", "failureCriteria": "chain broken or fabricated package slips through"},
        "criteria": {"exitCode": 0, "outputContains": ["V1A-CHAIN-VERIFIED"], "outputNotContains": []},
        "flags": {"critical": True, "requiresNetwork": False, "destructive": False},
    },
    {
        "name": "V3 doc-based: Bun lockfile semantics (live fetch)",
        "objective": "verify against the ACTUAL official Bun documentation: the lockfile is created by bun install, is text-based, is distinct from node_modules (--lockfile-only), and should be committed to git",
        "category": "validation",
        "command": f"bash {SB}/v3_bun_docs.sh",
        "timeoutMs": 90000,
        "expected": {"expectedResult": "V3-DOC-VERIFIED with quotes", "successCriteria": "exit 0, all four documented statements found", "failureCriteria": "doc fetch fails or documented statements differ"},
        "criteria": {"exitCode": 0, "outputContains": ["V3-DOC-VERIFIED"], "outputNotContains": []},
        "flags": {"critical": True, "requiresNetwork": True, "destructive": False},
    },
]

plan_payload = {
    "runId": RUN_ID,
    "experiments": "Two bridge cases staged in the run sandbox (V1a real-workspace chain, V3 Bun lockfile docs), plus two sandbox supplements per the record's plan (V1b installed-tree chain, V2 tsc-vs-grep controls — outputs preserved at scripts/verifications/exp011/).",
    "cases": cases,
}

(HERE / "run-payload.json").write_text(json.dumps(run_payload, indent=1))
(HERE / "plan-payload.json").write_text(json.dumps(plan_payload, indent=1))
print(f"run-payload.json: {len(json.dumps(run_payload))} chars")
print(f"plan-payload.json: {len(json.dumps(plan_payload))} chars, {len(cases)} cases")
