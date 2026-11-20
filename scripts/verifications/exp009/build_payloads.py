#!/usr/bin/env python3
"""Builds the createRun + submitPlan payloads for the EXP-000009 verification
run (VRUN-000004). C1/C2 are small inline heredoc cases; C5/C6/C3 exceed the
engine's 2000-char command limit and are staged in the run sandbox."""
import json, pathlib, sys

HERE = pathlib.Path(__file__).parent

def script(name):
    return (HERE / name).read_text().rstrip("\n")

def py_cmd(script_text):
    return f"python3 - <<'PYEOF'\n{script_text}\nPYEOF"

RUN_ID = "VRUN-000004"
SB = f"knowledge/verification/sandbox/{RUN_ID}"

run_payload = {
    "knowledgeId": "EXP-000009",
    "knowledgeVersion": 3,
    "title": "Scientific verification: loss-curve shapes are diagnostic clues — analytic baselines, flat/explosion ambiguity, and documentation-verified clipping semantics",
    "problem": {
        "description": "EXP-000009 (latest version v3, content of the v2 technical revision) claims: (1) a loss-curve SHAPE is a clue that narrows to a candidate list, never a diagnosis by itself; (2) the loss VALUE relative to the analytic baseline disambiguates what the shape alone cannot — flat at ln(K) = not-learning, flat near zero = likely already fit, flat at the class-prior entropy = learned only the prior; (3) the quoted baseline numbers are exact (ln2=0.693147, ln10=2.302585, near-one-hot CE approaching 0); (4) for NaN/Inf-early curves the listed checks (input min/max scan, loss-formula audit, grad norms, LR probe) discriminate between a numeric loss fault and an LR fault; (5) framework clipping semantics are doc-verifiable. This run executes the record's own verification plan C1-C3 (C4 is practice-based and not mechanically testable, per the record itself), plus two cases verifying the rootCause's ambiguity claims (C5 flat-ambiguity, C6 explosion-ambiguity).",
        "symptoms": "shotgun debugging during training misbehavior; acting on a loss-curve shape without a confirming check; misreading flat or exploding curves",
        "expectedBehavior": "C1: -log(1/K) equals ln(K) exactly for K=2,10 and the CE of a constant p=1/K prediction equals ln(K). C2: the CE of a near-one-hot confident correct prediction approaches 0 (bounded by ~1-confidence). C5: three distinct causes (optimizer not stepping, broken graph, near-constant labels with uninformative inputs) all produce a FLAT curve; the first two sit at exactly ln(2)=0.693147 and are separated by the gradient/parameter-drift checks; the third converges to the class-prior entropy (~0.357), a different value — the VALUE splits the candidate space before any check runs. C6: a numeric loss fault (naive -log(p) underflow with clean inputs) and an LR fault (explosion at lr=1e4 with healthy step-0 loss) both produce NaN/Inf-early curves; the input scan, loss-formula audit and LR probe discriminate them. C3: the official PyTorch documentation states clip_grad_norm_ clips the gradient norm of an iterable of parameters, computes the norm as if concatenated into a single vector, and modifies gradients in place.",
        "actualBehavior": "to be measured by real execution on the user's machine through the bridge",
        "facts": "-log(1/K)=ln(K); the entropy of a 90/10 class prior is ~0.357 nats; naive -log(softmax) underflows to inf for logit gaps beyond ~745 while the log-sum-exp form stays finite; an LR of 1e4 amplifies a sane 0.122 gradient norm into a weight jump of ~1220 per step, driving the next step's loss to inf.",
        "assumptions": "python3 3.14.4 on the user's machine; fixed seeds make every result deterministic; pure-python softmax regression substitutes framework training dynamics (torch absent on the workspace machine); outbound HTTPS available for the documentation check; pytorch.org may intermittently serve a bot-protection challenge on the stable path, so the doc case falls back to the versioned 2.15 URL resolved earlier the same day.",
        "environment": "user's machine via the bridge extension: Linux, Python 3.14.4, torch absent; VM dry-runs on Python 3.12.16",
        "constraints": "stdlib-only experiments; non-destructive (doc check writes only to mktemp); outputs below the 20KB truncation limit; the doc case fetches only official pytorch.org pages and is flagged requiresNetwork.",
    },
    "hypothesis": {
        "text": "All five cases pass their declared criteria on real execution: the chance-floor baselines are exact; the confident-prediction CE approaches zero; the flat-curve ambiguity demonstration shows three causes with the value+checks separating them exactly as the record's triage method prescribes; the explosion ambiguity shows the loss-fault and LR-fault separated by the record's listed checks; and the live-fetched PyTorch documentation confirms the clipping semantics.",
        "expectedObservation": "markers: C1-CHANCE-FLOORS-VERIFIED, C2-CONFIDENT-CE-APPROACHES-ZERO, C5-VALUE-AND-CHECKS-DISAMBIGUATE, C6-CHECKS-DISAMBIGUATE, C3-DOC-VERIFIED",
        "supportingEvidence": "VM-local dry-runs (Python 3.12.16) reproduce every marker; design iterations (C2 threshold too strict at 1e-3; C6 initially crashed on math.log(0) and mislabeled sane norms as growing) were caught locally and corrected — the final C6 honestly reports sane norms and relies on elimination + the LR probe, exactly as the record's own check list prescribes.",
        "contradictingEvidence": "none observed in dry-runs.",
    },
    "strategy": "Execute the record's plan C1/C2 (exact analytic baselines, deterministic), C5/C6 (ambiguity demonstrations implementing the record's triage method on pure-python training dynamics), C3 (live documentation inspection of clip_grad_norm_ semantics from the user's machine). C4 (shape->candidate mappings as practice-based priors) is deliberately NOT tested — the record itself classifies it as untested practice knowledge, and no source has been read to elevate it.",
}

cases = [
    {
        "name": "C1 chance floors: -log(1/K) = ln(K) and constant-predictor CE = ln(K)",
        "objective": "validate the baseline numbers quoted in the record's step 0 (ln2=0.693147, ln10=2.302585) and the constant p=1/K predictor floor",
        "category": "validation",
        "command": py_cmd(script("c1_chance_floors.py")),
        "timeoutMs": 60000,
        "expected": {"expectedResult": "C1-CHANCE-FLOORS-VERIFIED", "successCriteria": "exit 0, exact matches for K=2 and K=10", "failureCriteria": "any baseline mismatch"},
        "criteria": {"exitCode": 0, "outputContains": ["C1-CHANCE-FLOORS-VERIFIED"], "outputNotContains": []},
        "flags": {"critical": True, "requiresNetwork": False, "destructive": False},
    },
    {
        "name": "C2 confident-correct CE approaches zero (flat-near-zero interpretation)",
        "objective": "validate the analytic basis for reading a flat loss near zero as 'likely already fit'",
        "category": "validation",
        "command": py_cmd(script("c2_confident_ce.py")),
        "timeoutMs": 60000,
        "expected": {"expectedResult": "C2-CONFIDENT-CE-APPROACHES-ZERO", "successCriteria": "exit 0, each CE < 1.1x(1-conf), tightest < 1e-8", "failureCriteria": "CE does not approach zero"},
        "criteria": {"exitCode": 0, "outputContains": ["C2-CONFIDENT-CE-APPROACHES-ZERO"], "outputNotContains": []},
        "flags": {"critical": True, "requiresNetwork": False, "destructive": False},
    },
    {
        "name": "C5 flat-curve ambiguity: three causes, value + checks disambiguate (rootCause claim)",
        "objective": "demonstrate the record's core claim — the same flat shape arises from optimizer-not-stepping, broken graph, and prior-only learning; the loss VALUE (ln2 vs prior entropy) plus the cheapest checks (grad norms, param drift, majority baseline) separate them",
        "category": "boundary",
        "command": f"python3 {SB}/c5_flat_ambiguity.py",
        "timeoutMs": 120000,
        "expected": {"expectedResult": "C5-VALUE-AND-CHECKS-DISAMBIGUATE", "successCriteria": "exit 0, A and B flat at exactly ln(2) with different check outcomes, C flat at the prior entropy", "failureCriteria": "flat curves not reproduced or checks do not discriminate"},
        "criteria": {"exitCode": 0, "outputContains": ["C5-VALUE-AND-CHECKS-DISAMBIGUATE"], "outputNotContains": []},
        "flags": {"critical": True, "requiresNetwork": False, "destructive": False},
    },
    {
        "name": "C6 NaN/Inf-early ambiguity: loss fault vs LR fault, checks disambiguate",
        "objective": "demonstrate that a numeric loss fault (naive log(p) underflow, clean inputs) and an LR fault (explosion at lr=1e4) produce the same early-explosion shape, and the record's checks (input scan, loss audit, LR probe) separate them",
        "category": "boundary",
        "command": f"python3 {SB}/c6_exploding_ambiguity.py",
        "timeoutMs": 120000,
        "expected": {"expectedResult": "C6-CHECKS-DISAMBIGUATE", "successCriteria": "exit 0, cause-1 inf with clean inputs and finite stable-form audit, cause-2 explosion with LR probe stabilizing", "failureCriteria": "explosions not reproduced or checks do not discriminate"},
        "criteria": {"exitCode": 0, "outputContains": ["C6-CHECKS-DISAMBIGUATE"], "outputNotContains": []},
        "flags": {"critical": True, "requiresNetwork": False, "destructive": False},
    },
    {
        "name": "C3 doc-based: PyTorch clip_grad_norm_ semantics (live fetch)",
        "objective": "inspect the ACTUAL official PyTorch documentation for the clipping semantics the record references (plan C3: clipping and loss-dtype semantics of the framework in use)",
        "category": "validation",
        "command": f"bash {SB}/c3_clip_doc.sh",
        "timeoutMs": 90000,
        "expected": {"expectedResult": "C3-DOC-VERIFIED with DOC-SOURCE, DOC-VERSION and quoted sentences", "successCriteria": "exit 0, all three documented phrases found, marker printed", "failureCriteria": "doc fetch fails or documented statements differ"},
        "criteria": {"exitCode": 0, "outputContains": ["C3-DOC-VERIFIED"], "outputNotContains": []},
        "flags": {"critical": True, "requiresNetwork": True, "destructive": False},
    },
]

plan_payload = {
    "runId": RUN_ID,
    "experiments": "Five single-purpose deterministic experiments: C1/C2 exact analytic baselines (inline), C5/C6 ambiguity demonstrations on pure-python softmax-regression dynamics (sandbox scripts staged via journaled write_file), C3 live documentation inspection (sandbox script, official pytorch.org). C4 (shape->candidate mappings) deliberately untested — the record classifies it as practice-based priors.",
    "cases": cases,
}

(HERE / "run-payload.json").write_text(json.dumps(run_payload, indent=1))
(HERE / "plan-payload.json").write_text(json.dumps(plan_payload, indent=1))
print(f"run-payload.json: {len(json.dumps(run_payload))} chars")
print(f"plan-payload.json: {len(json.dumps(plan_payload))} chars, {len(cases)} cases")
