#!/usr/bin/env python3
"""Builds the createRun + submitPlan payloads for the EXP-000008 verification
run. Reads the experiment scripts from this folder and embeds them verbatim as
stdin-heredoc commands, so every attempt is independently reproducible."""
import json, pathlib, sys

HERE = pathlib.Path(__file__).parent

def script(name):
    return (HERE / name).read_text().rstrip("\n")

def py_cmd(script_text, args=""):
    if args:
        return f"python3 - {args} <<'PYEOF'\n{script_text}\nPYEOF"
    return f"python3 - <<'PYEOF'\n{script_text}\nPYEOF"

run_payload = {
    "knowledgeId": "EXP-000008",
    "knowledgeVersion": 3,
    "title": "Scientific verification: tiny-batch overfit protocol — scale-relative criteria, class-spanning batches, discriminating power, gradient-health semantics",
    "problem": {
        "description": "EXP-000008 (latest version v3, content of the v2 technical revision) claims: (1) the single-batch overfit test is a discriminator between mechanical bugs and convergence limits, not an absolute proof; (2) pass criteria must be scale-relative (100% batch accuracy; loss vs the ln(K) baseline and the memorization floor), never a fixed constant like loss<1e-2; (3) the tiny batch must span the classes — a single-class batch voids the test because a constant predictor wins it; (4) gradient checks verify FLOW not correctness, individual zero grads are normal (dead ReLUs, frozen params) and an all-nonzero-grad assertion is a false-positive generator; (5) the loss-dtype/logits expectations (e.g. CrossEntropyLoss) are doc-verifiable per framework version. This run executes the record's own embedded verification plan C1-C4, with C4 adapted to a pure-python MLP because no DL framework is installed on the workspace machine, plus a C4c capacity-boundary case added from design-iteration findings.",
        "symptoms": "networks that never learn; hours of hyperparameter tuning against broken pipelines; false-positive gradient assertions; fixed loss thresholds misjudging good fits at large target scales",
        "expectedBehavior": "C1: chance-level CE equals ln(K) exactly (K=2: 0.693147, K=10: 2.302585); near-one-hot correct-prediction CE approaches 0. C2: a constant predictor scores 100% on a single-class batch but exactly 1/K on a class-spanning batch. C4a: a finite-difference-verified healthy pure-python MLP (dh=4) reaches 100% batch accuracy with loss < 0.1*ln(4) within 400 steps at lr 0.5. C4b: the same architecture on independently shuffled labels fails the protocol even after 4x steps at raised LR (accuracy below 100%, loss above 0.1*ln4). C4c: at excess capacity (dh=16) the same budget fully memorizes the misaligned labels — documenting that the protocol's inference requires task-matched capacity (the record's own limitation note). C5: a fixed loss<1e-2 threshold false-fails a fully-fitted MSE problem at target scale 1000 (MSE~100 with R2>0.999) while passing the identical problem at scale 1 (MSE~1e-4). C6: a healthy memorizing pipeline with dead ReLU units carries exactly-zero grads on a large fraction of weights; the naive all-nonzero assertion fails (false positive) while the correct assertion (no NaN/Inf + every trainable layer has a nonzero grad) passes. C3: the official PyTorch documentation (version resolved live) states the CE loss expects unnormalized logits and long-dtype class-index targets.",
        "actualBehavior": "to be measured by real execution on the user's machine through the bridge",
        "facts": "-log(1/K) = ln(K); the CE floor of a fully memorizing classifier is ~0; MSE noise floors scale with the square of the target scale; ReLU units with negative pre-activations contribute exactly-zero gradients; excess-capacity networks can memorize random labels (Zhang et al. 2017), so the protocol's discriminating power depends on task-matched capacity — which the record's limitations section already mandates.",
        "assumptions": "python3 3.14.4 on the user's machine; fixed seeds (random.Random) make every result deterministic and reproducible; a pure-python MLP substitutes the DL-framework variant of C4 (no framework installed); outbound HTTPS is available for the documentation check; identical results are expected from the VM dry-run environment (Python 3.12.16) and the target machine modulo floating-point formatting.",
        "environment": "user's machine via the bridge extension: Linux, Python 3.14.4, numpy 2.3.5 present (unused — stdlib only), torch absent, git 2.53.0, sqlite3 3.46.1; VM dry-runs on Python 3.12.16",
        "constraints": "stdlib-only experiments (math/random — no framework dependency); every case is non-destructive (no workspace files written; the doc check writes only to mktemp); outputs kept below the 20KB attempt truncation limit; the documentation case fetches only the official pytorch.org docs and is flagged requiresNetwork so it cannot run without explicit confirmation.",
    },
    "hypothesis": {
        "text": "All eight cases pass their declared criteria on real execution: the analytic baselines are exact; the class-spanning requirement holds; a gradient-verified healthy pipeline passes the protocol while a label-misaligned copy fails it at task-matched capacity; excess capacity memorizes misaligned labels (boundary documented, not hidden); a fixed 1e-2 loss threshold is scale-dependent and false-fails a fully-fitted large-scale MSE problem; dead ReLU units produce zero grads in a healthy pipeline, making the naive all-nonzero-grad assertion a false-positive generator; and the live-fetched PyTorch documentation confirms the logits/dtype expectations quoted in the record.",
        "expectedObservation": "each case prints its declared marker and exits 0: C1-BASELINES-VERIFIED, C2-CLASS-SPANNING-REQUIRED, C4a-HEALTHY-PIPELINE-VERIFIED, C4b-MECHANICAL-BUG-CORRECTLY-FLAGGED, C4c-CAPACITY-BOUNDARY-DOCUMENTED, C5-SCALE-RELATIVE-CRITERIA-REQUIRED, C6-ZERO-GRADS-NORMAL-CONFIRMED, C3-DOC-VERIFIED",
        "supportingEvidence": "VM-local dry-runs (Python 3.12.16) reproduce every marker; the FD gradient check max relative error 2.187e-09 certifies the pure-python implementation used as the known-healthy pipeline; design-iteration failures (capacity sensitivity, noise-vs-signal scaling bug in an early C5 draft) were caught locally and are reported in the analysis rather than hidden.",
        "contradictingEvidence": "none observed in dry-runs; the capacity sensitivity discovered during design iteration is converted into boundary case C4c instead of being suppressed.",
    },
    "strategy": "Execute the record's own embedded verification plan: C1/C2 analytic baselines (exact math, deterministic), C4a/C4b protocol discriminating power on a finite-difference-certified pure-python MLP at task-matched capacity (dh=4), C4c the capacity boundary at dh=16, C5 fixed-threshold scale dependence via exact least squares at two target scales, C6 gradient-health semantics with dead ReLU units, C3 live documentation inspection (official PyTorch docs fetched from the user's machine). One case per claim class; all cases critical; the doc case is flagged requiresNetwork and executes only with explicit confirmation.",
}

cases = [
    {
        "name": "C1 analytic baselines: chance CE = ln(K), confident CE -> 0",
        "objective": "validate every baseline number the record quotes (ln2=0.693147, ln10=2.302585, near-one-hot CE approaching 0)",
        "category": "validation",
        "command": py_cmd(script("c1_baselines.py")),
        "timeoutMs": 60000,
        "expected": {"expectedResult": "C1-BASELINES-VERIFIED with exact ln(K) matches", "successCriteria": "exit 0, output contains C1-BASELINES-VERIFIED", "failureCriteria": "any baseline mismatch or missing marker"},
        "criteria": {"exitCode": 0, "outputContains": ["C1-BASELINES-VERIFIED"], "outputNotContains": []},
        "flags": {"critical": True, "requiresNetwork": False, "destructive": False},
    },
    {
        "name": "C2 class-spanning requirement: single-class batch voids the test",
        "objective": "show a constant predictor scores 100% on a single-class batch but exactly 1/K on a class-spanning batch",
        "category": "validation",
        "command": py_cmd(script("c2_class_spanning.py")),
        "timeoutMs": 60000,
        "expected": {"expectedResult": "C2-CLASS-SPANNING-REQUIRED", "successCriteria": "exit 0, output contains C2-CLASS-SPANNING-REQUIRED", "failureCriteria": "constant predictor fails to win the single-class batch"},
        "criteria": {"exitCode": 0, "outputContains": ["C2-CLASS-SPANNING-REQUIRED"], "outputNotContains": []},
        "flags": {"critical": True, "requiresNetwork": False, "destructive": False},
    },
    {
        "name": "C4a healthy pipeline must PASS the protocol (pure-python MLP, FD-certified)",
        "objective": "known-correct implementation (finite-difference gradient check) memorizes 12 class-spanning samples: 100% batch accuracy, loss far below ln(4) baseline",
        "category": "unit",
        "command": py_cmd(script("c4_protocol.py"), "healthy 4"),
        "timeoutMs": 120000,
        "expected": {"expectedResult": "C4a-HEALTHY-PIPELINE-VERIFIED", "successCriteria": "exit 0, FD rel-err < 1e-4, final acc 100%, loss < 0.1*ln(4)", "failureCriteria": "FD check fails or healthy pipeline does not pass the protocol"},
        "criteria": {"exitCode": 0, "outputContains": ["C4a-HEALTHY-PIPELINE-VERIFIED"], "outputNotContains": []},
        "flags": {"critical": True, "requiresNetwork": False, "destructive": False},
    },
    {
        "name": "C4b label-misaligned copy must FAIL the protocol (negative control)",
        "objective": "same architecture at task-matched capacity on independently shuffled labels: protocol escalation (4x steps, raised LR) still fails the pass bar -> mechanical bug correctly flagged",
        "category": "negative",
        "command": py_cmd(script("c4_protocol.py"), "shuffled 4"),
        "timeoutMs": 120000,
        "expected": {"expectedResult": "C4b-MECHANICAL-BUG-CORRECTLY-FLAGGED", "successCriteria": "exit 0, accuracy stays below 100% and/or loss above 0.1*ln(4) after escalation", "failureCriteria": "shuffled labels pass the protocol bar (discriminating power broken at task-matched capacity)"},
        "criteria": {"exitCode": 0, "outputContains": ["C4b-MECHANICAL-BUG-CORRECTLY-FLAGGED"], "outputNotContains": []},
        "flags": {"critical": True, "requiresNetwork": False, "destructive": False},
    },
    {
        "name": "C4c capacity boundary: excess capacity memorizes misaligned labels",
        "objective": "at dh=16 (excess capacity) the SAME budget that the healthy run uses fully memorizes shuffled labels — the protocol's failure->mechanical-bug inference requires task-matched capacity (validates the record's own limitation note about reducing width)",
        "category": "boundary",
        "command": py_cmd(script("c4_protocol.py"), "boundary 16"),
        "timeoutMs": 120000,
        "expected": {"expectedResult": "C4c-CAPACITY-BOUNDARY-DOCUMENTED", "successCriteria": "exit 0, shuffled labels reach 100% accuracy and loss < 0.1 at dh=16 within the healthy budget", "failureCriteria": "boundary behavior does not reproduce (result would still be reported honestly)"},
        "criteria": {"exitCode": 0, "outputContains": ["C4c-CAPACITY-BOUNDARY-DOCUMENTED"], "outputNotContains": []},
        "flags": {"critical": True, "requiresNetwork": False, "destructive": False},
    },
    {
        "name": "C5 fixed loss threshold is scale-dependent (false-fails large-scale MSE)",
        "objective": "identical regression problems at target scale 1 vs 1000, both fitted to the noise floor: fixed loss<1e-2 gives opposite verdicts; scale-relative criteria (R2) are consistent",
        "category": "boundary",
        "command": py_cmd(script("c5_fixed_threshold.py")),
        "timeoutMs": 60000,
        "expected": {"expectedResult": "C5-SCALE-RELATIVE-CRITERIA-REQUIRED", "successCriteria": "exit 0, fixed threshold verdicts differ across scales while R2>0.99 both", "failureCriteria": "fixed threshold holds across scales or relative criteria disagree"},
        "criteria": {"exitCode": 0, "outputContains": ["C5-SCALE-RELATIVE-CRITERIA-REQUIRED"], "outputNotContains": []},
        "flags": {"critical": True, "requiresNetwork": False, "destructive": False},
    },
    {
        "name": "C6 zero grads are normal: naive all-nonzero assertion is a false-positive generator",
        "objective": "healthy memorizing pipeline with dead ReLU units carries exactly-zero grads; the naive assertion fails while the correct assertion (no NaN/Inf + per-layer nonzero) passes",
        "category": "negative",
        "command": py_cmd(script("c6_zero_grads.py")),
        "timeoutMs": 120000,
        "expected": {"expectedResult": "C6-ZERO-GRADS-NORMAL-CONFIRMED", "successCriteria": "exit 0, training reaches 100% acc with zero-grad weights present, naive assertion fails, correct assertion passes", "failureCriteria": "no zero grads in a healthy pipeline or naive assertion passes"},
        "criteria": {"exitCode": 0, "outputContains": ["C6-ZERO-GRADS-NORMAL-CONFIRMED"], "outputNotContains": []},
        "flags": {"critical": True, "requiresNetwork": False, "destructive": False},
    },
    {
        "name": "C3 doc-based: PyTorch CrossEntropyLoss logits/dtype expectations (live fetch)",
        "objective": "inspect the ACTUAL official PyTorch documentation from the user's machine: CE input must be unnormalized logits; target dtype long for class indices (record claims these are doc-verifiable per framework version)",
        "category": "validation",
        "command": script("c3_pytorch_doc.sh"),
        "timeoutMs": 90000,
        "expected": {"expectedResult": "C3-DOC-VERIFIED with DOC-SOURCE, DOC-VERSION and quoted sentences", "successCriteria": "exit 0, all three documented phrases found in the fetched page, marker printed", "failureCriteria": "doc fetch fails or the documented statements differ from the record's claim"},
        "criteria": {"exitCode": 0, "outputContains": ["C3-DOC-VERIFIED"], "outputNotContains": []},
        "flags": {"critical": True, "requiresNetwork": True, "destructive": False},
    },
]

plan_payload = {
    "experiments": "Eight single-purpose deterministic experiments, one per claim class (C1/C2 analytic baselines, C4a/C4b discriminating power at task-matched capacity, C4c capacity boundary, C5 threshold scale-dependence, C6 gradient-health semantics, C3 live documentation inspection). Pure-python stdlib only; fixed seeds; no workspace writes.",
    "cases": cases,
}

(HERE / "run-payload.json").write_text(json.dumps(run_payload, indent=1))
(HERE / "plan-payload.json").write_text(json.dumps(plan_payload, indent=1))
print(f"run-payload.json: {len(json.dumps(run_payload))} chars")
print(f"plan-payload.json: {len(json.dumps(plan_payload))} chars, {len(cases)} cases")
for c in cases:
    print(f"  - {c['name'][:80]} ({c['category']}, {len(c['command'])} chars)")
