# Verification Report — VRUN-000006

- **Knowledge record:** EXP-000011 (version 3) — AI-operator self-correction: verify an API exists in the INSTALLED project before using it — hallucinated APIs are a recurrent, high-severity agent failure mode
- **Verification status:** VERIFIED
- **Conclusion:** VERIFIED — all 2 critical test(s) passed against real executions
- **Generated:** 2026-11-19T11:26:28.468Z by the bridge (from persisted records only)

## 1. Original problem
EXP-000011 (latest version v3, content of the v2 technical revision) claims: (1) three layers are commonly confused — what the DOCS describe (latest release), what the lockfile RESOLVED (a specific version), and what node_modules CONTAINS (what runs) — and verification must walk down that chain because each layer can differ; (2) the project's lockfile records the exact resolved version while the manifest carries ranges; (3) a type check is STRONGER than grep because it validates call shape, not just name presence; (4) hallucinated dependencies are caught by checking manifest+lockfile before use. The v1 '#1 agent bug source' superlative was retracted in v2 and the ranking is now explicitly unquantified (nothing to verify — the retraction REMOVED a claim). This run executes the record's plan: V1a on the user's real workspace (manifest + lockfile layers, fabricated-dependency negative control, node_modules absence recorded honestly if applicable), V3 live Bun lockfile documentation, and V1b/V2 in the Z.ai sandbox VM (node_modules present, tsc available) as supplementary labeled evidence.

**Symptoms:** agent-written code calling APIs that do not exist in the installed version; runtime 'x.y is not a function' failures; confusing the latest documented release with the resolved/installed version
**Expected:** V1a on the user's workspace: @prisma/client declared as the range ^6.11.1 in the manifest, resolved to the EXACT version @prisma/client@6.19.2 in bun.lock (with registry tarball + integrity), the drift between layers demonstrated, a plausible fabricated package (react-super-router) present in NEITHER layer (caught), and node_modules observed absent (no node runtime on that machine) — recorded as an environmental limitation, with layer 3 demonstrated in the sandbox. V3 the official Bun documentation states bun install creates bun.lock, the format is text-based (since v1.2), a lockfile can be generated WITHOUT installing to node_modules (--lockfile-only — the layer distinction), and it should be committed to git. V1b (sandbox): manifest ^6.11.1 -> lockfile @6.19.2 -> node_modules 6.19.2, all three layers consistent. V2 (sandbox): tsc passes the correct call (exit 0), fails the fabricated method (TS2339 Property does not exist), fails the real method with wrong call shape (TS2554) while g… (1076 chars)
**Actual:** to be measured by real execution (V1a/V3 on the user's machine; V1b/V2 already executed in the Z.ai sandbox VM, outputs preserved at scripts/verifications/exp011/)

**Facts:** the user's workspace is the z.ai-workspace-bridge clone with package.json (67 dependencies, ranges) and bun.lock (945 resolved packages, text-based JSONC-lenient format) but no node_modules; the Z.ai sandbox VM has the same project WITH node_modules and tsc 5.9.3; socket.io-client is installed at 4.8.4 in the sandbox.
**Assumptions:** the user's bun.lock parses with trailing-comma tolerance; the bun.sh docs page fetched live is authoritative; the sandbox's installed tree is representative of what the user's machine would contain after bun install.

## 2. Hypothesis (initial)
Both bridge cases pass: the three-layer chain verifies on the user's real workspace with the manifest-range vs lockfile-pin drift demonstrated and the fabricated dependency caught at layers 1-2 (node_modules absent recorded honestly), and the Bun documentation confirms the lockfile semantics (created by bun install, text-based, distinct from node_modules, committed to git). The sandbox supplements (already executed) complete the evidence: all three layers consistent in the installed project, and tsc catching both the fabricated API and the wrong call shape that grep cannot see.

**Expected observation:** markers: V1A-CHAIN-VERIFIED, V3-DOC-VERIFIED

## 3. Hypothesis history (all rounds preserved)
- **Round 1** (initial): Both bridge cases pass: the three-layer chain verifies on the user's real workspace with the manifest-range vs lockfile-pin drift demonstrated and the fabricated dependency caught at layers 1-2 (node_modules absent recorded honestly), and the Bun documentation confirms the lockfile semantics (created by bun install, text-based, distinct from node_modules, committed to git). The sandbox supplements (already executed) complete the evidence: all three layers consistent in the installed project, and tsc catching both the fabricated API and the wrong call shape that grep cannot see. — _initial hypothesis_ → 2/2 executed tests passed (pass rate 100%)

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
| 2 | 2 | 2 | 0 | 0 | 0 | 0 | 2 | 100% |

## 6. Test results (every attempt preserved)
### VTC-000026 — V1a three-layer chain on the real workspace (manifest -> lockfile -> installed/absent) [PASS] (integration, critical)
- Objective: verify the record's core method on the user's actual project files: manifest ranges, lockfile exact pins, layer drift, fabricated-dependency negative control, and honest layer-3 observation
- Command: `python3 knowledge/verification/sandbox/VRUN-000006/v1a_chain.py`
- Success criteria: exit 0 + output contains ["V1A-CHAIN-VERIFIED"]
- **Attempt 1: PASS** (exit 0, 86ms, journal 3ibcqxdd) — exit 0 + 1 output assertion(s) satisfied

```
$ python3 knowledge/verification/sandbox/VRUN-000006/v1a_chain.py
V1A layer1 manifest: @prisma/client declared as '^6.11.1' (a RANGE — what the manifest asks for)
V1A layer2 lockfile: resolved to '@prisma/client@6.19.2' (EXACT version + registry tarball + integrity hash)
V1A drift: manifest range '^6.11.1' vs lockfile pin '6.19.2' — each layer can differ; verification must walk down the chain
V1A fabricated package 'react-super-router': in-manifest=False in-lockfile=False -> hallucinated dependency caught at layers 1-2
V1A layer3: node_modules ABSENT on this workspace (no node runtime here) — recorded as an environmental limitation
V1A-NODE-MODULES-ABSENT
V1A layer3 is demonstrated in the Z.ai sandbox VM (installed tree present there) — see the run analysis
V1A-CHAIN-VERIFIED
exit code: 0
```

### VTC-000027 — V3 doc-based: Bun lockfile semantics (live fetch) [PASS] (validation, critical)
- Objective: verify against the ACTUAL official Bun documentation: the lockfile is created by bun install, is text-based, is distinct from node_modules (--lockfile-only), and should be committed to git
- Command: `bash knowledge/verification/sandbox/VRUN-000006/v3_bun_docs.sh`
- Success criteria: exit 0 + output contains ["V3-DOC-VERIFIED"]
- **Attempt 1: PASS** (exit 0, 600ms, journal wg0xxp75) — exit 0 + 1 output assertion(s) satisfied

```
$ bash knowledge/verification/sandbox/VRUN-000006/v3_bun_docs.sh
DOC-SOURCE: https://bun.sh/docs/install/lockfile
DOC-lockfile-created: FOUND
DOC-text-based-format: FOUND
DOC-distinct-from-node-modules: FOUND
DOC-committed-to-git: FOUND
DOC-QUOTE-layer-distinction: To generate a lockfile without installing to node_modules , use the --lockfile-only flag.
DOC-QUOTE-text-based: Bun v1.2 changed the default lockfile format to the text-based bun.
DOC-QUOTE-commit: Should it be committed to git? # Yes
V3-DOC-VERIFIED
exit code: 0
```

## 7. Metrics
- **manifest_declared_range:** ^6.11.1 semver range — measured (verified against cited output)
- **lockfile_resolved_version:** @prisma/client@6.19.2 exact pin — measured (verified against cited output)
- **fabricated_package_layers_hit:** 0 layers — measured (verified against cited output)
- **tsc_positive_exit_code_sandbox:** 0 — reported (reported, untied)
- **tsc_fabricated_exit_code_sandbox:** 2 — reported (reported, untied)
- **tsc_wrong_shape_exit_code_sandbox:** 2 — reported (reported, untied)
- **grep_hits_on_wrong_shape_call_sandbox:** 11 — reported (reported, untied)

## 8. AI INTERPRETATION (submitted by GLM — not measurement)
### Round 1 analysis (by GLM (z.ai web))
Both bridge cases passed against real executions on the user's machine (first round). Measured: V1a on the user's actual workspace — @prisma/client is declared as the RANGE ^6.11.1 in package.json while bun.lock records the EXACT resolved pin @prisma/client@6.19.2 (with registry tarball URL and integrity hash); the layer drift the record describes is real and demonstrated; the plausible-but-fabricated package 'react-super-router' is in NEITHER the manifest nor the lockfile (hallucinated dependencies are caught at layers 1-2 before any code runs); node_modules is ABSENT on that workspace (no node runtime) — recorded in the case output itself as an environmental limitation, with layer 3 demonstrated in the sandbox. V3 the live-fetched official Bun documentation (bun.sh/docs/install/lockfile) states bun install creates bun.lock, the format is text-based (since v1.2), a lockfile can be generated WITHOUT installing to node_modules (--lockfile-only — the documented layer distinction), and it should be committed to git. SUPPLEMENTARY (Z.ai sandbox VM, labeled): V1b the full three-layer chain on the installed project — manifest ^6.11.1 -> lockfile @prisma/client@6.19.2 -> node_modules/@prisma/client 6.19.2, all consistent; V2 tsc 5.9.3 against installed socket.io-client 4.8.4 — the correct call compiles (exit 0), the fabricated method s.setReconnectionLag(5) fails with TS2339 'Property does not exist', and the REAL method called with the wrong shape s.on(42) fails with TS2554 while grep still finds 'on(' 11 times in the installed .d.ts — the exact blind spot the record warns about (grep validates presence, not call shape). The retracted '#1' superlative needs no evidence: v2 REMOVED the claim and the record now states the ranking is unquantified.

**Expected vs observed:** Every prediction matched: the manifest-range/lockfile-pin drift observed on the user's real files; the fabricated package caught at layers 1-2; all four Bun doc statements found verbatim; the sandbox three-layer chain consistent (6.19.2 across lockfile and installed tree); tsc exit codes 0/2/2 with the expected TS2339 and TS2554 error classes.
**Alternative explanations:** (1) Layer 3 could not run on the user's machine (node_modules absent — the workspace was never bun-installed there); the sandbox supplement covers it, clearly labeled as VM-executed. (2) The fabricated-package negative control uses one invented name; catching one plausible fake demonstrates the mechanism, not a statistical guarantee. (3) The docs-describe-latest-release layer is supported by the Prisma docs navigation (v7 exists alongside v6) rather than a dedicated assertion. (4) bun.lock's trailing-comma tolerance required a lenient parse — a strictly-JSON parser would misread the lockfile, which is itself a verification-relevant nuance.
**Recommended modifications:** The verified evidence supports the record's revised claims. For the owner's review: the record's step-1 check (package in manifest AND lockfile) is now backed by a real-workspace demonstration including the range-vs-pin distinction; the tsc-vs-grep claim is backed by a controlled sandbox experiment with both failure classes (TS2339 fabricated, TS2554 wrong shape) and the grep blind spot shown. No changes required to the record's substance.

**Proposed conclusion:** VERIFIED — Both critical bridge cases passed on real executions on the user's machine: the three-layer verification chain (with layer drift demonstrated and the fabricated dependency caught at manifest+lockfile, node_modules absence honestly recorded), and the Bun lockfile documentation semantics. Supplementary sandbox evidence completes the picture: the installed-tree layer consistent with the lockfile pin, and tsc catching both fabricated APIs and wrong call shapes that grep cannot see. Environmental limitation: node_modules and tsc are not available on the user's machine itself — those layers were verified in the Z.ai sandbox as the record's plan itself anticipated.
**Engine decision:** ACCEPTED → VERIFIED. GLM's proposal matches the evidence: all 2 critical test(s) passed against real executions

## 9. Limitations
- Commands executed on the user's machine through the VS Code extension as the local user — no CPU/memory sandbox isolation is enforceable through this transport.
- Network access for non-flagged tests could not be technically blocked; tests that declared network needs required explicit owner confirmation instead.
- Attempt outputs are redacted for secrets and capped at 20,000 characters per attempt.