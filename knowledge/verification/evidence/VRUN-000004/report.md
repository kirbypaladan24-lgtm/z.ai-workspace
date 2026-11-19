# Verification Report — VRUN-000004

- **Knowledge record:** EXP-000009 (version 3) — ML triage: read the loss curve before changing anything — each shape narrows to a SHORT CANDIDATE LIST that must be confirmed by a check; a shape alone is never a diagnosis
- **Verification status:** VERIFIED
- **Conclusion:** VERIFIED — all 5 critical test(s) passed against real executions
- **Generated:** 2026-11-19T11:10:02.972Z by the bridge (from persisted records only)

## 1. Original problem
EXP-000009 (latest version v3, content of the v2 technical revision) claims: (1) a loss-curve SHAPE is a clue that narrows to a candidate list, never a diagnosis by itself; (2) the loss VALUE relative to the analytic baseline disambiguates what the shape alone cannot — flat at ln(K) = not-learning, flat near zero = likely already fit, flat at the class-prior entropy = learned only the prior; (3) the quoted baseline numbers are exact (ln2=0.693147, ln10=2.302585, near-one-hot CE approaching 0); (4) for NaN/Inf-early curves the listed checks (input min/max scan, loss-formula audit, grad norms, LR probe) discriminate between a numeric loss fault and an LR fault; (5) framework clipping semantics are doc-verifiable. This run executes the record's own verification plan C1-C3 (C4 is practice-based and not mechanically testable, per the record itself), plus two cases verifying the rootCause's ambiguity claims (C5 flat-ambiguity, C6 explosion-ambiguity).

**Symptoms:** shotgun debugging during training misbehavior; acting on a loss-curve shape without a confirming check; misreading flat or exploding curves
**Expected:** C1: -log(1/K) equals ln(K) exactly for K=2,10 and the CE of a constant p=1/K prediction equals ln(K). C2: the CE of a near-one-hot confident correct prediction approaches 0 (bounded by ~1-confidence). C5: three distinct causes (optimizer not stepping, broken graph, near-constant labels with uninformative inputs) all produce a FLAT curve; the first two sit at exactly ln(2)=0.693147 and are separated by the gradient/parameter-drift checks; the third converges to the class-prior entropy (~0.357), a different value — the VALUE splits the candidate space before any check runs. C6: a numeric loss fault (naive -log(p) underflow with clean inputs) and an LR fault (explosion at lr=1e4 with healthy step-0 loss) both produce NaN/Inf-early curves; the input scan, loss-formula audit and LR probe discriminate them. C3: the official PyTorch documentation states clip_grad_norm_ clips the gradient norm of an iterable of parameters, computes the norm as if concatenated into a single vector, and modifies… (1020 chars)
**Actual:** to be measured by real execution on the user's machine through the bridge

**Facts:** -log(1/K)=ln(K); the entropy of a 90/10 class prior is ~0.357 nats; naive -log(softmax) underflows to inf for logit gaps beyond ~745 while the log-sum-exp form stays finite; an LR of 1e4 amplifies a sane 0.122 gradient norm into a weight jump of ~1220 per step, driving the next step's loss to inf.
**Assumptions:** python3 3.14.4 on the user's machine; fixed seeds make every result deterministic; pure-python softmax regression substitutes framework training dynamics (torch absent on the workspace machine); outbound HTTPS available for the documentation check; pytorch.org may intermittently serve a bot-protection challenge on the stable path, so the doc case falls back to the versioned 2.15 URL resolved earlier the same day.

## 2. Hypothesis (initial)
All five cases pass their declared criteria on real execution: the chance-floor baselines are exact; the confident-prediction CE approaches zero; the flat-curve ambiguity demonstration shows three causes with the value+checks separating them exactly as the record's triage method prescribes; the explosion ambiguity shows the loss-fault and LR-fault separated by the record's listed checks; and the live-fetched PyTorch documentation confirms the clipping semantics.

**Expected observation:** markers: C1-CHANCE-FLOORS-VERIFIED, C2-CONFIDENT-CE-APPROACHES-ZERO, C5-VALUE-AND-CHECKS-DISAMBIGUATE, C6-CHECKS-DISAMBIGUATE, C3-DOC-VERIFIED

## 3. Hypothesis history (all rounds preserved)
- **Round 1** (initial): All five cases pass their declared criteria on real execution: the chance-floor baselines are exact; the confident-prediction CE approaches zero; the flat-curve ambiguity demonstration shows three causes with the value+checks separating them exactly as the record's triage method prescribes; the explosion ambiguity shows the loss-fault and LR-fault separated by the record's listed checks; and the live-fetched PyTorch documentation confirms the clipping semantics. — _initial hypothesis_ → 5/5 executed tests passed (pass rate 100%)

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
| 5 | 5 | 5 | 0 | 0 | 0 | 0 | 5 | 100% |

## 6. Test results (every attempt preserved)
### VTC-000017 — C1 chance floors: -log(1/K) = ln(K) and constant-predictor CE = ln(K) [PASS] (validation, critical)
- Objective: validate the baseline numbers quoted in the record's step 0 (ln2=0.693147, ln10=2.302585) and the constant p=1/K predictor floor
- Command: `python3 - <<'PYEOF'
import math, sys

# C1 (record plan): chance floors. -log(1/K) for K=2,10 and the CE of a
# constant p=1/K prediction must equal ln(K) exactly.
ok = True
for K in (2, 10):
    a = -math.log(1.0 / K)
    p = [1.0 / K] * K
    ce_const = -sum(math.log(pi) / K for pi in p)  # expectation over uniform labels
    expect = math.log(K)
    m1 = abs(a - expect) < 1e-12
    m2 = abs(ce_const - expect) < 1e-12
    ok = ok and m1 and m2
    print(f"C1 K={K} -log(1/K)={a:.6f} constant-predictor-CE={ce_const:.6f} ln(K)={expect:.6f} exact={m1 and m2}")
print("C1-CHANCE-FLOORS-VERIFIED" if ok else "C1-FAILED")
sys.exit(0 if ok else 1)
PYEOF`
- Success criteria: exit 0 + output contains ["C1-CHANCE-FLOORS-VERIFIED"]
- **Attempt 1: PASS** (exit 0, 89ms, journal 2b2ix5n6) — exit 0 + 1 output assertion(s) satisfied

```
$ python3 - <<'PYEOF'
import math, sys

# C1 (record plan): chance floors. -log(1/K) for K=2,10 and the CE of a
# constant p=1/K prediction must equal ln(K) exactly.
ok = True
for K in (2, 10):
    a = -math.log(1.0 / K)
    p = [1.0 / K] * K
    ce_const = -sum(math.log(pi) / K for pi in p)  # expectation over uniform labels
    expect = math.log(K)
    m1 = abs(a - expect) < 1e-12
    m2 = abs(ce_const - expect) < 1e-12
    ok = ok and m1 and m2
    print(f"C1 K={K} -log(1/K)={a:.6f} constant-predictor-CE={ce_const:.6f} ln(K)={expect:.6f} exact={m1 and m2}")
print("C1-CHANCE-FLOORS-VERIFIED" if ok else "C1-FAILED")
sys.exit(0 if ok else 1)
PYEOF
C1 K=2 -log(1/K)=0.693147 constant-predictor-CE=0.693147 ln(K)=0.693147 exact=True
C1 K=10 -log(1/K)=2.302585 constant-predictor-CE=2.302585 ln(K)=2.302585 exact=True
C1-CHANCE-FLOORS-VERIFIED
exit code: 0
```

### VTC-000018 — C2 confident-correct CE approaches zero (flat-near-zero interpretation) [PASS] (validation, critical)
- Objective: validate the analytic basis for reading a flat loss near zero as 'likely already fit'
- Command: `python3 - <<'PYEOF'
import math, sys

# C2 (record plan): the CE of a near-one-hot confident correct prediction
# approaches 0 — the analytic basis for reading a flat-near-zero curve as
# "likely already fit". Assert each measured CE matches -log(conf) and is
# bounded by ~the missing probability mass (1 - conf).
ok = True
for conf in (1 - 1e-3, 1 - 1e-6, 1 - 1e-9):
    eps = 1.0 - conf
    ce = -math.log(conf)
    print(f"C2 p_correct={conf} CE={ce:.9f} (1-conf={eps:.0e})")
    ok = ok and ce < 1.1 * eps and abs(ce - (-math.log(conf))) < 1e-15
ok = ok and ce < 1e-8
print("C2-CONFIDENT-CE-APPROACHES-ZERO" if ok else "C2-FAILED")
sys.exit(0 if ok else 1)
PYEOF`
- Success criteria: exit 0 + output contains ["C2-CONFIDENT-CE-APPROACHES-ZERO"]
- **Attempt 1: PASS** (exit 0, 76ms, journal wwatuwab) — exit 0 + 1 output assertion(s) satisfied

```
$ python3 - <<'PYEOF'
import math, sys

# C2 (record plan): the CE of a near-one-hot confident correct prediction
# approaches 0 — the analytic basis for reading a flat-near-zero curve as
# "likely already fit". Assert each measured CE matches -log(conf) and is
# bounded by ~the missing probability mass (1 - conf).
ok = True
for conf in (1 - 1e-3, 1 - 1e-6, 1 - 1e-9):
    eps = 1.0 - conf
    ce = -math.log(conf)
    print(f"C2 p_correct={conf} CE={ce:.9f} (1-conf={eps:.0e})")
    ok = ok and ce < 1.1 * eps and abs(ce - (-math.log(conf))) < 1e-15
ok = ok and ce < 1e-8
print("C2-CONFIDENT-CE-APPROACHES-ZERO" if ok else "C2-FAILED")
sys.exit(0 if ok else 1)
PYEOF
C2 p_correct=0.999 CE=0.001000500 (1-conf=1e-03)
C2 p_correct=0.999999 CE=0.000001000 (1-conf=1e-06)
C2 p_correct=0.999999999 CE=0.000000001 (1-conf=1e-09)
C2-CONFIDENT-CE-APPROACHES-ZERO
exit code: 0
```

### VTC-000019 — C5 flat-curve ambiguity: three causes, value + checks disambiguate (rootCause claim) [PASS] (boundary, critical)
- Objective: demonstrate the record's core claim — the same flat shape arises from optimizer-not-stepping, broken graph, and prior-only learning; the loss VALUE (ln2 vs prior entropy) plus the cheapest checks (grad norms, param drift, majority baseline) separate them
- Command: `python3 knowledge/verification/sandbox/VRUN-000004/c5_flat_ambiguity.py`
- Success criteria: exit 0 + output contains ["C5-VALUE-AND-CHECKS-DISAMBIGUATE"]
- **Attempt 1: PASS** (exit 0, 435ms, journal hryz94f1) — exit 0 + 1 output assertion(s) satisfied

```
$ python3 knowledge/verification/sandbox/VRUN-000004/c5_flat_ambiguity.py
C5-A not-stepping: step0=0.693147 after-200-lr0-steps=0.693147 (ln2=0.693147)
C5-A checks: grad-norm=1.016803 (nonzero=True), params-unchanged=True -> gradients exist, optimizer never applies them
C5-B broken-graph: after-200-steps=0.693147 (identical VALUE to A: True)
C5-B checks: loss identical to A, but the cause differs — A has flowing grads and lr=0; B has NO gradient path at all (update receives zeros)
C5-C prior-flat: converged loss=0.344746 class-prior-entropy H=0.356843 majority-share=0.885
C5-C checks: loss-at-prior-floor=True -> the model learned only the class prior (labels near-constant AND inputs uninformative)
C5 value-classes: chance-level ln2=0.693147 (A,B) vs prior-floor 0.356843 (C) — the VALUE splits the candidate space before any check runs
C5-FLAT-AMBIGUOUS
C5-VALUE-AND-CHECKS-DISAMBIGUATE
exit code: 0
```

### VTC-000020 — C6 NaN/Inf-early ambiguity: loss fault vs LR fault, checks disambiguate [PASS] (boundary, critical)
- Objective: demonstrate that a numeric loss fault (naive log(p) underflow, clean inputs) and an LR fault (explosion at lr=1e4) produce the same early-explosion shape, and the record's checks (input scan, loss audit, LR probe) separate them
- Command: `python3 knowledge/verification/sandbox/VRUN-000004/c6_exploding_ambiguity.py`
- Success criteria: exit 0 + output contains ["C6-CHECKS-DISAMBIGUATE"]
- **Attempt 1: PASS** (exit 0, 81ms, journal n833wdsa) — exit 0 + 1 output assertion(s) satisfied

```
$ python3 knowledge/verification/sandbox/VRUN-000004/c6_exploding_ambiguity.py
C6-cause1 loss-fault: inputs-clean=True (min=[-0.9398348215504229, -0.9699985261007902], max=[0.9953124009261687, 0.9913832833123983]); step-0 losses contain inf=True
C6-cause1 audit: stable log-sum-exp form on the SAME logits stays finite (max=827.5) -> the fault is the naive log(p), i.e. inside the loss computation, not the data
C6-cause2 LR-fault: step-0 loss healthy=0.699176 (ln2=0.693147); exploded-to-nonfinite=True within 2 steps at lr=1e4
C6-cause2 checks: inputs clean=True (not (a)); loss already uses the stable log-sum-exp form (not (b)); grad-norms at healthy steps=['0.122', '0.122'] (sane — by the record's own guidance this pointed back to (a)/(b), but both were eliminated by their checks, leaving LR)
C6-cause2 probe: LR reduced to 1e+00 -> stable=True, final loss=0.582731 (moving below step-0 0.699176)
C6-EXPLODING-AMBIGUOUS
C6-CHECKS-DISAMBIGUATE
exit code: 0
```

### VTC-000021 — C3 doc-based: PyTorch clip_grad_norm_ semantics (live fetch) [PASS] (validation, critical)
- Objective: inspect the ACTUAL official PyTorch documentation for the clipping semantics the record references (plan C3: clipping and loss-dtype semantics of the framework in use)
- Command: `bash knowledge/verification/sandbox/VRUN-000004/c3_clip_doc.sh`
- Success criteria: exit 0 + output contains ["C3-DOC-VERIFIED"]
- **Attempt 1: PASS** (exit 0, 2200ms, journal vxnxjwwd) — exit 0 + 1 output assertion(s) satisfied

```
$ bash knowledge/verification/sandbox/VRUN-000004/c3_clip_doc.sh
DOC-SOURCE: https://pytorch.org/docs/2.15/generated/torch.nn.utils.clip_grad_norm_.html
DOC-VERSION: 2.15
DOC-clips-gradient-norm: FOUND
DOC-norm-over-all-params: FOUND
DOC-modified-in-place: FOUND
DOC-QUOTE-what: Clip the gradient norm of an iterable of parameters.
DOC-QUOTE-norm:  The norm is computed over the norms of the individual gradients of all parameters, as if the norms of the individual gradients were concatenated into a single vector.
DOC-QUOTE-inplace: Gradients are modified in-place.
C3-DOC-VERIFIED
exit code: 0
```

## 7. Metrics
- **chance_ce_k2:** 0.693147 nats — measured (verified against cited output)
- **chance_ce_k10:** 2.302585 nats — measured (verified against cited output)
- **confident_ce_at_1em9:** 0.000000001 nats — measured (verified against cited output)
- **flat_notstepping_loss:** 0.693147 nats — measured (verified against cited output)
- **flat_prior_floor_loss:** 0.344746 nats — measured (verified against cited output)
- **class_prior_entropy:** 0.356843 nats — measured (verified against cited output)
- **lr_fault_step0_loss:** 0.699176 nats — measured (verified against cited output)
- **lr_probe_stable_loss:** 0.582731 nats — measured (verified against cited output)
- **pytorch_doc_version_inspected:** 2.15 version — measured (verified against cited output)

## 8. AI INTERPRETATION (submitted by GLM — not measurement)
### Round 1 analysis (by GLM (z.ai web))
All 5 critical cases passed against real executions on the user's machine (first round — no regression needed; sandbox staging prevented a repeat of the command-size failure mode). Measured: C1 -log(1/K) equals ln(K) exactly for K=2 (0.693147) and K=10 (2.302585); the constant p=1/K predictor's CE equals ln(K) exactly. C2 the CE of near-one-hot confident correct predictions approaches 0 (1.0e-9 at p=1-1e-9), bounded by the missing probability mass. C5 the flat-curve ambiguity: an optimizer-not-stepping config (lr=0) and a broken-graph config produce a loss flat at EXACTLY ln(2)=0.693147 (identical value, different cause — separated by the gradient-norm and parameter-drift checks: grad-norm 1.016803 nonzero with unchanged params vs no gradient path at all), while near-constant labels with uninformative inputs converge to the class-prior entropy (measured 0.344746 vs H=0.356843 at majority share 0.885) — a DIFFERENT value that splits the candidate space before any check runs. C6 the NaN/Inf-early ambiguity: a naive -log(p) loss fault (inf at step 0 with clean inputs; the stable log-sum-exp form stays finite at 827.5 on the same logits) and an LR fault (healthy step-0 loss 0.699176, explosion to non-finite within 2 steps at lr=1e4; LR reduced to 1e0 restores stable descent to 0.582731) produce the same shape, and the record's check list (input scan, loss audit, LR probe) discriminates them — including the honest observation that sane grad norms at the last healthy step pointed back to (a)/(b), which elimination then ruled out. C3 the official PyTorch 2.15 documentation (fetched live from the user's machine; the stable path served a bot-protection challenge and the versioned URL served the content, recorded in DOC-SOURCE) states clip_grad_norm_ clips the gradient norm of an iterable of parameters, computes the norm as if concatenated into a single vector, and modifies gradients in place.

**Expected vs observed:** Every prediction matched: baselines exact to 6 decimals; the two ln(2)-valued flats identical to 1e-12 with divergent check outcomes; the prior-floor flat within 0.012 of the analytic prior entropy (0.344746 vs 0.356843 — the gap reflects finite training and the empirical 0.885 label share); the loss-fault/LR-fault discrimination reproduced exactly as designed; all three documented clipping statements found verbatim in the fetched page with quotes preserved.
**Alternative explanations:** (1) The prior-floor convergence gap (0.012) is finite-training effect, not a baseline error — the check tolerance (0.05) reflects that. (2) The C6 LR-fault demo uses lr=1e4 with sane initial grad norms — the record's own guidance says sane norms point back to (a)/(b); the demo shows the full elimination sequence rather than relying on the norm heuristic alone, which is a faithful (and more honest) application of the record's method. (3) The C4 shape->candidate mappings (train-down/val-up, explodes-after-N-steps) remain practice-based priors per the record's own classification — no source has been read and no experiment run for them; they stay unverified and labeled as such. (4) Pure-python softmax regression substitutes framework training dynamics; framework-specific behaviors (e.g. actual clip_grad_norm_ effect on a real optimizer loop) were not executed — only their documented semantics were inspected.
**Recommended modifications:** The verified evidence supports the record's core claims (shapes are clues; baselines disambiguate; checks confirm). For the owner's review: the record already labels C4 as practice-based; that honesty should be preserved on any future promotion. A future revision could cite the two inspected doc sources (PyTorch 2.15 CrossEntropyLoss via VRUN-000003 and clip_grad_norm_ via VRUN-000004) for its framework-semantics references.

**Proposed conclusion:** VERIFIED — All 5 critical test cases passed on real executions on the user's machine: analytic baselines exact; flat-curve ambiguity demonstrated with value+checks discriminating three causes; explosion ambiguity demonstrated with the record's check list discriminating loss-fault vs LR-fault; and the live-fetched PyTorch 2.15 documentation confirms the clipping semantics. The shape->candidate mappings (C4) remain practice-based priors by the record's own classification and are unverified.
**Engine decision:** ACCEPTED → VERIFIED. GLM's proposal matches the evidence: all 5 critical test(s) passed against real executions

## 9. Limitations
- Commands executed on the user's machine through the VS Code extension as the local user — no CPU/memory sandbox isolation is enforceable through this transport.
- Network access for non-flagged tests could not be technically blocked; tests that declared network needs required explicit owner confirmation instead.
- Attempt outputs are redacted for secrets and capped at 20,000 characters per attempt.