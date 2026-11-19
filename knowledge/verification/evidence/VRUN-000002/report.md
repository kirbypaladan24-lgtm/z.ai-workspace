# Verification Report — VRUN-000002

- **Knowledge record:** EXP-000003 (version 1) — ML numerics: loss becomes NaN with large logits — softmax overflows; subtract max(x) first
- **Verification status:** VERIFIED
- **Conclusion:** VERIFIED — all 2 critical test(s) passed against real executions
- **Generated:** 2026-11-18T21:35:30.762Z by the bridge (from persisted records only)

## 1. Original problem
EXP-000003 claims naive softmax exp(x)/sum(exp(x)) overflows to NaN/Infinity for large logits while the max-shifted form is stable. This run re-verifies with controlled experiments.

**Symptoms:** loss NaN from step 0 with confident predictions
**Expected:** stable softmax finite and sums to 1 for logits [1000, 1001]; naive form overflows
**Actual:** to be measured

**Facts:** IEEE-754 double overflows above exp(709.78)
**Assumptions:** python3 available

## 2. Hypothesis (initial)
For x=[1000,1001], naive exp overflows (OverflowError or inf) while max-shifted softmax returns finite values summing to 1.

**Expected observation:** naive: overflow; stable: finite, sum=1

## 3. Hypothesis history (all rounds preserved)
- **Round 1** (initial): For x=[1000,1001], naive exp overflows (OverflowError or inf) while max-shifted softmax returns finite values summing to 1. — _initial hypothesis_ → 2/2 executed tests passed (pass rate 100%)

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
### VTC-000007 — Naive softmax overflows on [1000,1001] [PASS] (negative, critical)
- Objective: demonstrate the failure mode
- Command: `python3 -c 'import math,sys
x=[1000.0,1001.0]
try:
 t=sum(math.exp(v) for v in x); print("naive total:",t); print("OVERFLOW" if not math.isfinite(t) else "NO-OVERFLOW"); sys.exit(0 if not math.isfinite(t) else 1)
except OverflowError:
 print("OVERFLOW (OverflowError)"); sys.exit(0)'`
- Success criteria: exit 0 + output contains ["OVERFLOW"]
- **Attempt 1: PASS** (exit 0, 56ms, journal rxxqtgwj) — exit 0 + 1 output assertion(s) satisfied

```
$ python3 -c 'import math,sys
x=[1000.0,1001.0]
try:
 t=sum(math.exp(v) for v in x); print("naive total:",t); print("OVERFLOW" if not math.isfinite(t) else "NO-OVERFLOW"); sys.exit(0 if not math.isfinite(t) else 1)
except OverflowError:
 print("OVERFLOW (OverflowError)"); sys.exit(0)'
OVERFLOW (OverflowError)
exit code: 0
```

### VTC-000008 — Max-shifted softmax stable and normalized [PASS] (unit, critical)
- Objective: verify the fix
- Command: `python3 -c 'import math,sys
x=[1000.0,1001.0];m=max(x)
t=sum(math.exp(v-m) for v in x);s=[math.exp(v-m)/t for v in x]
ok=all(map(math.isfinite,s)) and abs(sum(s)-1)<1e-12
print("stable softmax:",s)
print("STABLE" if ok else "UNSTABLE")
sys.exit(0 if ok else 1)'`
- Success criteria: exit 0 + output contains ["STABLE"]
- **Attempt 1: PASS** (exit 0, 57ms, journal cg52uf8i) — exit 0 + 1 output assertion(s) satisfied

```
$ python3 -c 'import math,sys
x=[1000.0,1001.0];m=max(x)
t=sum(math.exp(v-m) for v in x);s=[math.exp(v-m)/t for v in x]
ok=all(map(math.isfinite,s)) and abs(sum(s)-1)<1e-12
print("stable softmax:",s)
print("STABLE" if ok else "UNSTABLE")
sys.exit(0 if ok else 1)'
stable softmax: [0.2689414213699951, 0.7310585786300049]
STABLE
exit code: 0
```

## 7. Metrics
- **stable_softmax_sum_deviation:** 0.0 abs — measured (verified against cited output)

## 8. AI INTERPRETATION (submitted by GLM — not measurement)
### Round 1 analysis (by GLM (z.ai web))
Both critical tests passed on the user's machine: naive softmax overflows (OverflowError caught and demonstrated) while the max-shifted softmax returns finite values [0.269, 0.731] summing to 1 within 1e-12. The knowledge record's claims are confirmed exactly as stated.

**Expected vs observed:** Expected: overflow on naive / finite normalized stable — observed: both confirmed

**Proposed conclusion:** VERIFIED — both critical tests pass; claims confirmed as stated
**Engine decision:** ACCEPTED → VERIFIED. GLM's proposal matches the evidence: all 2 critical test(s) passed against real executions

## 9. Limitations
- Commands executed on the user's machine through the VS Code extension as the local user — no CPU/memory sandbox isolation is enforceable through this transport.
- Network access for non-flagged tests could not be technically blocked; tests that declared network needs required explicit owner confirmation instead.
- Attempt outputs are redacted for secrets and capped at 20,000 characters per attempt.