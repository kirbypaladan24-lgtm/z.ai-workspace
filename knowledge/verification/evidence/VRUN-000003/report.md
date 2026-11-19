# Verification Report — VRUN-000003

- **Knowledge record:** EXP-000008 (version 3) — ML debugging: network does not learn — overfit 10 samples FIRST (single-batch sanity protocol) before tuning anything
- **Verification status:** VERIFIED
- **Conclusion:** VERIFIED — all 8 critical test(s) passed against real executions
- **Generated:** 2026-11-19T10:59:18.855Z by the bridge (from persisted records only)

## 1. Original problem
EXP-000008 (latest version v3, content of the v2 technical revision) claims: (1) the single-batch overfit test is a discriminator between mechanical bugs and convergence limits, not an absolute proof; (2) pass criteria must be scale-relative (100% batch accuracy; loss vs the ln(K) baseline and the memorization floor), never a fixed constant like loss<1e-2; (3) the tiny batch must span the classes — a single-class batch voids the test because a constant predictor wins it; (4) gradient checks verify FLOW not correctness, individual zero grads are normal (dead ReLUs, frozen params) and an all-nonzero-grad assertion is a false-positive generator; (5) the loss-dtype/logits expectations (e.g. CrossEntropyLoss) are doc-verifiable per framework version. This run executes the record's own embedded verification plan C1-C4, with C4 adapted to a pure-python MLP because no DL framework is installed on the workspace machine, plus a C4c capacity-boundary case added from design-iteration findings.

**Symptoms:** networks that never learn; hours of hyperparameter tuning against broken pipelines; false-positive gradient assertions; fixed loss thresholds misjudging good fits at large target scales
**Expected:** C1: chance-level CE equals ln(K) exactly (K=2: 0.693147, K=10: 2.302585); near-one-hot correct-prediction CE approaches 0. C2: a constant predictor scores 100% on a single-class batch but exactly 1/K on a class-spanning batch. C4a: a finite-difference-verified healthy pure-python MLP (dh=4) reaches 100% batch accuracy with loss < 0.1*ln(4) within 400 steps at lr 0.5. C4b: the same architecture on independently shuffled labels fails the protocol even after 4x steps at raised LR (accuracy below 100%, loss above 0.1*ln4). C4c: at excess capacity (dh=16) the same budget fully memorizes the misaligned labels — documenting that the protocol's inference requires task-matched capacity (the record's own limitation note). C5: a fixed loss<1e-2 threshold false-fails a fully-fitted MSE problem at target scale 1000 (MSE~100 with R2>0.999) while passing the identical problem at scale 1 (MSE~1e-4). C6: a healthy memorizing pipeline with dead ReLU units carries exactly-zero grads on a large fraction o… (1303 chars)
**Actual:** to be measured by real execution on the user's machine through the bridge

**Facts:** -log(1/K) = ln(K); the CE floor of a fully memorizing classifier is ~0; MSE noise floors scale with the square of the target scale; ReLU units with negative pre-activations contribute exactly-zero gradients; excess-capacity networks can memorize random labels (Zhang et al. 2017), so the protocol's discriminating power depends on task-matched capacity — which the record's limitations section already mandates.
**Assumptions:** python3 3.14.4 on the user's machine; fixed seeds (random.Random) make every result deterministic and reproducible; a pure-python MLP substitutes the DL-framework variant of C4 (no framework installed); outbound HTTPS is available for the documentation check; identical results are expected from the VM dry-run environment (Python 3.12.16) and the target machine modulo floating-point formatting.

## 2. Hypothesis (initial)
All eight cases pass their declared criteria on real execution: the analytic baselines are exact; the class-spanning requirement holds; a gradient-verified healthy pipeline passes the protocol while a label-misaligned copy fails it at task-matched capacity; excess capacity memorizes misaligned labels (boundary documented, not hidden); a fixed 1e-2 loss threshold is scale-dependent and false-fails a fully-fitted large-scale MSE problem; dead ReLU units produce zero grads in a healthy pipeline, making the naive all-nonzero-grad assertion a false-positive generator; and the live-fetched PyTorch documentation confirms the logits/dtype expectations quoted in the record.

**Expected observation:** each case prints its declared marker and exits 0: C1-BASELINES-VERIFIED, C2-CLASS-SPANNING-REQUIRED, C4a-HEALTHY-PIPELINE-VERIFIED, C4b-MECHANICAL-BUG-CORRECTLY-FLAGGED, C4c-CAPACITY-BOUNDARY-DOCUMENTED, C5-SCALE-RELATIVE-CRITERIA-REQUIRED, C6-ZERO-GRADS-NORMAL-CONFIRMED, C3-DOC-VERIFIED

## 3. Hypothesis history (all rounds preserved)
- **Round 1** (initial): All eight cases pass their declared criteria on real execution: the analytic baselines are exact; the class-spanning requirement holds; a gradient-verified healthy pipeline passes the protocol while a label-misaligned copy fails it at task-matched capacity; excess capacity memorizes misaligned labels (boundary documented, not hidden); a fixed 1e-2 loss threshold is scale-dependent and false-fails a fully-fitted large-scale MSE problem; dead ReLU units produce zero grads in a healthy pipeline, making the naive all-nonzero-grad assertion a false-positive generator; and the live-fetched PyTorch documentation confirms the logits/dtype expectations quoted in the record. — _initial hypothesis_ → 3/8 executed tests passed (pass rate 37.5%)
- **Round 2** (regression): The five round-1 failures were infrastructure failures, not experimental results: the engine silently truncated case commands to 2000 chars (appending an ellipsis marker), so bash executed mangled scripts (heredoc delimited by end-of-file; python died on SyntaxError U+2026). The engine now REFUSES oversized commands instead of truncating them. The experiment scripts are staged verbatim in the run sandbox (sha256-verified on the user's machine) and the cases invoke them by path. With commands intact, the same five cases should pass on real execution exactly as the VM dry-runs predicted. — _root cause: normalizeCase applied truncate(command, 2000) — five of eight commands were silently mangled (attempts VTA-000013/14/15/17/18 preserve the mangled commands and their SyntaxError outputs). Fix applied to the engine: commands over MAX_CASE_COMMAND_CHARS=2000 are now refused at plan/update time, never truncated. Scripts staged via journaled write_file into knowledge/verification/sandbox/VRUN-000003/ (c4_protocol.py 2f923811..., c6_zero_grads.py 4037d077..., c3_pytorch_doc.sh 347ff9cd...); case commands now invoke them by relative path (workspace cwd)._ → 8/8 executed tests passed (pass rate 100%)

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
| 8 | 8 | 8 | 0 | 0 | 0 | 0 | 13 | 100% |

## 6. Test results (every attempt preserved)
### VTC-000009 — C1 analytic baselines: chance CE = ln(K), confident CE -> 0 [PASS] (validation, critical)
- Objective: validate every baseline number the record quotes (ln2=0.693147, ln10=2.302585, near-one-hot CE approaching 0)
- Command: `python3 - <<'PYEOF'
import math, sys

ok = True
# C1a: chance-level CE = -log(1/K) = ln(K) for K=2 and K=10
for K in (2, 10):
    chance = -math.log(1.0 / K)
    expect = math.log(K)
    match = abs(chance - expect) < 1e-12
    ok = ok and match
    print(f"C1 K={K} chance-CE={chance:.6f} ln(K)={expect:.6f} exact-match={match}")

# C1b: CE of a near-one-hot confident correct prediction approaches 0
p_correct = 1.0 - 1e-9
ce_conf = -math.log(p_correct)
print(f"C1 near-one-hot CE={ce_conf:.9f}")
ok = ok and ce_conf < 1e-6

# C1c: constant p=1/K prediction on the true class = ln(K)
K = 10
ce_const = -math.log(1.0 / K)
print(f"C1 constant-predictor CE on true class={ce_const:.6f}")
ok = ok and abs(ce_const - math.log(K)) < 1e-12

# reference constants quoted in the knowledge record
print(f"C1 ln2={math.log(2):.6f} ln10={math.log(10):.6f}")
ok = ok and abs(math.log(2) - 0.693147) < 1e-5 and abs(math.log(10) - 2.302585) < 1e-5

print("C1-BASELINES-VERIFIED" if ok else "C1-BASELINES-FAILED")
sys.exit(0 if ok else 1)
PYEOF`
- Success criteria: exit 0 + output contains ["C1-BASELINES-VERIFIED"]
- **Attempt 1: PASS** (exit 0, 102ms, journal frr1ma42) — exit 0 + 1 output assertion(s) satisfied

```
$ python3 - <<'PYEOF'
import math, sys

ok = True
# C1a: chance-level CE = -log(1/K) = ln(K) for K=2 and K=10
for K in (2, 10):
    chance = -math.log(1.0 / K)
    expect = math.log(K)
    match = abs(chance - expect) < 1e-12
    ok = ok and match
    print(f"C1 K={K} chance-CE={chance:.6f} ln(K)={expect:.6f} exact-match={match}")

# C1b: CE of a near-one-hot confident correct prediction approaches 0
p_correct = 1.0 - 1e-9
ce_conf = -math.log(p_correct)
print(f"C1 near-one-hot CE={ce_conf:.9f}")
ok = ok and ce_conf < 1e-6

# C1c: constant p=1/K prediction on the true class = ln(K)
K = 10
ce_const = -math.log(1.0 / K)
print(f"C1 constant-predictor CE on true class={ce_const:.6f}")
ok = ok and abs(ce_const - math.log(K)) < 1e-12

# reference constants quoted in the knowledge record
print(f"C1 ln2={math.log(2):.6f} ln10={math.log(10):.6f}")
ok = ok and abs(math.log(2) - 0.693147) < 1e-5 and abs(math.log(10) - 2.302585) < 1e-5

print("C1-BASELINES-VERIFIED" if ok else "C1-BASELINES-FAILED")
sys.exit(0 if ok else 1)
PYEOF
C1 K=2 chance-CE=0.693147 ln(K)=0.693147 exact-match=True
C1 K=10 chance-CE=2.302585 ln(K)=2.302585 exact-match=True
C1 near-one-hot CE=0.000000001
C1 constant-predictor CE on true class=2.302585
C1 ln2=0.693147 ln10=2.302585
C1-BASELINES-VERIFIED
exit code: 0
```

### VTC-000010 — C2 class-spanning requirement: single-class batch voids the test [PASS] (validation, critical)
- Objective: show a constant predictor scores 100% on a single-class batch but exactly 1/K on a class-spanning batch
- Command: `python3 - <<'PYEOF'
import sys

ok = True
# A constant predictor always outputs class c.
# Single-class batch (all labels = c): it scores 100% with zero learning.
# Class-spanning balanced batch: it scores exactly 1/K.
for K, c in ((4, 2), (10, 7)):
    single = [c] * 10                         # single-class batch
    spanning = [i % K for i in range(K * 3)]  # 3 samples per class, spans all classes
    acc_single = sum(1 for y in single if y == c) / len(single)
    acc_span = sum(1 for y in spanning if y == c) / len(spanning)
    expected_span = 1.0 / K
    print(f"C2 K={K} single-class-batch acc={acc_single * 100:.1f}PCT spanning-batch acc={acc_span * 100:.1f}PCT expected-chance={expected_span * 100:.1f}PCT")
    ok = ok and acc_single == 1.0 and abs(acc_span - expected_span) < 1e-12

# A single-class batch therefore cannot detect failure-to-learn: the constant
# predictor "passes" a 100%-accuracy criterion without any signal.
print("C2-SINGLE-CLASS-VOIDS-TEST: CONFIRMED")
print("C2-CLASS-SPANNING-REQUIRED")
sys.exit(0 if ok else 1)
PYEOF`
- Success criteria: exit 0 + output contains ["C2-CLASS-SPANNING-REQUIRED"]
- **Attempt 1: PASS** (exit 0, 107ms, journal 5p2zd7ei) — exit 0 + 1 output assertion(s) satisfied

```
$ python3 - <<'PYEOF'
import sys

ok = True
# A constant predictor always outputs class c.
# Single-class batch (all labels = c): it scores 100% with zero learning.
# Class-spanning balanced batch: it scores exactly 1/K.
for K, c in ((4, 2), (10, 7)):
    single = [c] * 10                         # single-class batch
    spanning = [i % K for i in range(K * 3)]  # 3 samples per class, spans all classes
    acc_single = sum(1 for y in single if y == c) / len(single)
    acc_span = sum(1 for y in spanning if y == c) / len(spanning)
    expected_span = 1.0 / K
    print(f"C2 K={K} single-class-batch acc={acc_single * 100:.1f}PCT spanning-batch acc={acc_span * 100:.1f}PCT expected-chance={expected_span * 100:.1f}PCT")
    ok = ok and acc_single == 1.0 and abs(acc_span - expected_span) < 1e-12

# A single-class batch therefore cannot detect failure-to-learn: the constant
# predictor "passes" a 100%-accuracy criterion without any signal.
print("C2-SINGLE-CLASS-VOIDS-TEST: CONFIRMED")
print("C2-CLASS-SPANNING-REQUIRED")
sys.exit(0 if ok else 1)
PYEOF
C2 K=4 single-class-batch acc=100.0PCT spanning-batch acc=25.0PCT expected-chance=25.0PCT
C2 K=10 single-class-batch acc=100.0PCT spanning-batch acc=10.0PCT expected-chance=10.0PCT
C2-SINGLE-CLASS-VOIDS-TEST: CONFIRMED
C2-CLASS-SPANNING-REQUIRED
exit code: 0
```

### VTC-000011 — C4a healthy pipeline must PASS the protocol (pure-python MLP, FD-certified) [PASS] (unit, critical)
- Objective: known-correct implementation (finite-difference gradient check) memorizes 12 class-spanning samples: 100% batch accuracy, loss far below ln(4) baseline
- Command: `python3 knowledge/verification/sandbox/VRUN-000003/c4_protocol.py healthy 4`
- Success criteria: exit 0 + output contains ["C4a-HEALTHY-PIPELINE-VERIFIED"]
- **Attempt 1: FAIL** (exit 1, 180ms, journal 6bk7sld1) — exit code 1 ≠ expected 0

```
$ python3 - healthy 4 <<'PYEOF'
import math, random, sys

# C4 protocol core: pure-python MLP 6 -> dh(ReLU) -> 4, CE loss, SGD.
# Modes:
#   healthy  DH        - FD gradient check + 400 steps @ lr 0.5. Protocol must PASS.
#   shuffled 4         - misaligned labels, protocol escalation (1600 total, lr 1.0).
#                        Protocol must FAIL -> mechanical bug correctly flagged.
#   boundary 16        - EXCESS capacity at the SAME budget as healthy (400 @ 0.5):
#                        misaligned labels get fully memorized -> documents the
#                        capacity boundary of the protocol's inference.
def gen_data(seed=42, n=12, din=6, K=4):
    rng = random.Random(seed)
    centers = [[rng.uniform(-1, 1) for _ in range(din)] for _ in range(K)]
    X, Y = [], []
    for i in range(n):
        c = i % K
        X.append([centers[c][j] + rng.gauss(0, 0.25) for j in range(din)])
        Y.append(c)
    return X, Y

def init_net(seed=7, din=6, dh=4, K=4):
    rng = random.Random(seed)
    W1 = [[rng.gauss(0, math.sqrt(2.0 / din)) for _ in range(dh)] for _ in range(din)]
    b1 = [0.0] * dh
    W2 = [[rng.gauss(0, math.sqrt(2.0 / dh)) for _ in range(K)] for _ in range(dh)]
    b2 = [0.0] * K
    return W1, b1, W2, b2

def forward(X, W1, b1, W2, b2):
    H, L = [], []
    for x in X:
        h = [max(0.0, sum(x[i] * W1[i][j] for i in range(len(x))) + b1[j]) for j in range(len(b1))]
        l = [sum(h[j] * W2[j][k] for j in range(len(h))) + b2[k] for k in range(len(b2))]
        H.append(h); L.append(l)
    return H, L

def softmax(l):
    m = max(l); e = [math.exp(v - m) for v in l]; s = sum(e)
    return [v / s for v in e]

def loss_acc(L, Y):
    tot = 0.0; hit = 0
    for l, y in zip(L, Y):
        p = softmax(l); tot += -math.log(p[y])
        if max(range(len(p)), key=lambda k: p[k]) == y: hit += 1
    return tot / len(Y), hit / len(Y)

def grads(X, Y, W1, b1, W2, b2):
    H, L = forward(X, W1, b1, W2, b2)
    n, din, dh, K = len(Y), len(W1), len(b1),
```
- **Attempt 2: PASS** (exit 0, 106ms, journal bclhxr5o) — exit 0 + 1 output assertion(s) satisfied

```
$ python3 knowledge/verification/sandbox/VRUN-000003/c4_protocol.py healthy 4
C4a FD-gradient-check max-rel-err=2.187e-09 (dh=4)
C4a step0 loss=1.779646 (~ln4=1.386294) acc=0.0PCT
C4a final loss=0.003293 acc=100.0PCT steps=400 lr=0.5 dh=4
C4a-PROTOCOL-PASS
C4a-HEALTHY-PIPELINE-VERIFIED
exit code: 0
```

### VTC-000012 — C4b label-misaligned copy must FAIL the protocol (negative control) [PASS] (negative, critical)
- Objective: same architecture at task-matched capacity on independently shuffled labels: protocol escalation (4x steps, raised LR) still fails the pass bar -> mechanical bug correctly flagged
- Command: `python3 knowledge/verification/sandbox/VRUN-000003/c4_protocol.py shuffled 4`
- Success criteria: exit 0 + output contains ["C4b-MECHANICAL-BUG-CORRECTLY-FLAGGED"]
- **Attempt 1: FAIL** (exit 1, 161ms, journal nwgurkmd) — exit code 1 ≠ expected 0

```
$ python3 - shuffled 4 <<'PYEOF'
import math, random, sys

# C4 protocol core: pure-python MLP 6 -> dh(ReLU) -> 4, CE loss, SGD.
# Modes:
#   healthy  DH        - FD gradient check + 400 steps @ lr 0.5. Protocol must PASS.
#   shuffled 4         - misaligned labels, protocol escalation (1600 total, lr 1.0).
#                        Protocol must FAIL -> mechanical bug correctly flagged.
#   boundary 16        - EXCESS capacity at the SAME budget as healthy (400 @ 0.5):
#                        misaligned labels get fully memorized -> documents the
#                        capacity boundary of the protocol's inference.
def gen_data(seed=42, n=12, din=6, K=4):
    rng = random.Random(seed)
    centers = [[rng.uniform(-1, 1) for _ in range(din)] for _ in range(K)]
    X, Y = [], []
    for i in range(n):
        c = i % K
        X.append([centers[c][j] + rng.gauss(0, 0.25) for j in range(din)])
        Y.append(c)
    return X, Y

def init_net(seed=7, din=6, dh=4, K=4):
    rng = random.Random(seed)
    W1 = [[rng.gauss(0, math.sqrt(2.0 / din)) for _ in range(dh)] for _ in range(din)]
    b1 = [0.0] * dh
    W2 = [[rng.gauss(0, math.sqrt(2.0 / dh)) for _ in range(K)] for _ in range(dh)]
    b2 = [0.0] * K
    return W1, b1, W2, b2

def forward(X, W1, b1, W2, b2):
    H, L = [], []
    for x in X:
        h = [max(0.0, sum(x[i] * W1[i][j] for i in range(len(x))) + b1[j]) for j in range(len(b1))]
        l = [sum(h[j] * W2[j][k] for j in range(len(h))) + b2[k] for k in range(len(b2))]
        H.append(h); L.append(l)
    return H, L

def softmax(l):
    m = max(l); e = [math.exp(v - m) for v in l]; s = sum(e)
    return [v / s for v in e]

def loss_acc(L, Y):
    tot = 0.0; hit = 0
    for l, y in zip(L, Y):
        p = softmax(l); tot += -math.log(p[y])
        if max(range(len(p)), key=lambda k: p[k]) == y: hit += 1
    return tot / len(Y), hit / len(Y)

def grads(X, Y, W1, b1, W2, b2):
    H, L = forward(X, W1, b1, W2, b2)
    n, din, dh, K = len(Y), len(W1), len(b1)
```
- **Attempt 2: PASS** (exit 0, 215ms, journal zlqcmj54) — exit 0 + 1 output assertion(s) satisfied

```
$ python3 knowledge/verification/sandbox/VRUN-000003/c4_protocol.py shuffled 4
C4b mechanical bug: labels shuffled independently of inputs (dh=4, task-matched)
C4b phase1 (400 steps, lr 0.5): loss=0.191832 acc=91.7PCT
C4b phase2 (1600 total steps, lr 1.0): loss=0.162318 acc=91.7PCT
C4b chance floor ln(4)=1.386294; protocol pass bar: acc=100PCT and loss<0.1*lnK=0.138629
C4b-PROTOCOL-FAIL-DETECTED
C4b-MECHANICAL-BUG-CORRECTLY-FLAGGED
exit code: 0
```

### VTC-000013 — C4c capacity boundary: excess capacity memorizes misaligned labels [PASS] (boundary, critical)
- Objective: at dh=16 (excess capacity) the SAME budget that the healthy run uses fully memorizes shuffled labels — the protocol's failure->mechanical-bug inference requires task-matched capacity (validates the record's own limitation note about reducing width)
- Command: `python3 knowledge/verification/sandbox/VRUN-000003/c4_protocol.py boundary 16`
- Success criteria: exit 0 + output contains ["C4c-CAPACITY-BOUNDARY-DOCUMENTED"]
- **Attempt 1: FAIL** (exit 1, 149ms, journal plnf095j) — exit code 1 ≠ expected 0

```
$ python3 - boundary 16 <<'PYEOF'
import math, random, sys

# C4 protocol core: pure-python MLP 6 -> dh(ReLU) -> 4, CE loss, SGD.
# Modes:
#   healthy  DH        - FD gradient check + 400 steps @ lr 0.5. Protocol must PASS.
#   shuffled 4         - misaligned labels, protocol escalation (1600 total, lr 1.0).
#                        Protocol must FAIL -> mechanical bug correctly flagged.
#   boundary 16        - EXCESS capacity at the SAME budget as healthy (400 @ 0.5):
#                        misaligned labels get fully memorized -> documents the
#                        capacity boundary of the protocol's inference.
def gen_data(seed=42, n=12, din=6, K=4):
    rng = random.Random(seed)
    centers = [[rng.uniform(-1, 1) for _ in range(din)] for _ in range(K)]
    X, Y = [], []
    for i in range(n):
        c = i % K
        X.append([centers[c][j] + rng.gauss(0, 0.25) for j in range(din)])
        Y.append(c)
    return X, Y

def init_net(seed=7, din=6, dh=4, K=4):
    rng = random.Random(seed)
    W1 = [[rng.gauss(0, math.sqrt(2.0 / din)) for _ in range(dh)] for _ in range(din)]
    b1 = [0.0] * dh
    W2 = [[rng.gauss(0, math.sqrt(2.0 / dh)) for _ in range(K)] for _ in range(dh)]
    b2 = [0.0] * K
    return W1, b1, W2, b2

def forward(X, W1, b1, W2, b2):
    H, L = [], []
    for x in X:
        h = [max(0.0, sum(x[i] * W1[i][j] for i in range(len(x))) + b1[j]) for j in range(len(b1))]
        l = [sum(h[j] * W2[j][k] for j in range(len(h))) + b2[k] for k in range(len(b2))]
        H.append(h); L.append(l)
    return H, L

def softmax(l):
    m = max(l); e = [math.exp(v - m) for v in l]; s = sum(e)
    return [v / s for v in e]

def loss_acc(L, Y):
    tot = 0.0; hit = 0
    for l, y in zip(L, Y):
        p = softmax(l); tot += -math.log(p[y])
        if max(range(len(p)), key=lambda k: p[k]) == y: hit += 1
    return tot / len(Y), hit / len(Y)

def grads(X, Y, W1, b1, W2, b2):
    H, L = forward(X, W1, b1, W2, b2)
    n, din, dh, K = len(Y), len(W1), len(b1
```
- **Attempt 2: PASS** (exit 0, 195ms, journal 0hl9rxip) — exit 0 + 1 output assertion(s) satisfied

```
$ python3 knowledge/verification/sandbox/VRUN-000003/c4_protocol.py boundary 16
C4c excess capacity: SAME budget as healthy (400 steps, lr 0.5) but dh=16 on misaligned labels
C4c final loss=0.023197 acc=100.0PCT steps=400 lr=0.5 dh=16
C4c-EXCESS-CAPACITY-MEMORIZES-SHUFFLED
C4c-CAPACITY-BOUNDARY-DOCUMENTED
exit code: 0
```

### VTC-000014 — C5 fixed loss threshold is scale-dependent (false-fails large-scale MSE) [PASS] (boundary, critical)
- Objective: identical regression problems at target scale 1 vs 1000, both fitted to the noise floor: fixed loss<1e-2 gives opposite verdicts; scale-relative criteria (R2) are consistent
- Command: `python3 - <<'PYEOF'
import math, random, sys

# Fixed absolute thresholds are invalid across target scales. Two identical
# regression problems differing ONLY in target scale (1x vs 1000x): the whole
# target (signal AND noise) is scaled. Both are fitted to their irreducible
# noise floor by exact least squares - i.e. both are "fully memorized" in the
# sense that no model can beat the noise floor.
rng = random.Random(2024)

def make_data(scale):
    xs, ys = [], []
    for i in range(40):
        x = rng.uniform(0, 1)
        y = (3.0 * x + rng.gauss(0, 0.01)) * scale
        xs.append(x); ys.append(y)
    return xs, ys

def fit_least_squares(xs, ys):
    n = len(xs)
    mx = sum(xs) / n; my = sum(ys) / n
    sxx = sum((x - mx) ** 2 for x in xs)
    sxy = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    w = sxy / sxx
    b = my - w * mx
    return w, b

def mse_and_r2(xs, ys, w, b):
    n = len(xs)
    mse = sum((y - (w * x + b)) ** 2 for x, y in zip(xs, ys)) / n
    var = sum((y - (sum(ys) / n)) ** 2 for y in ys) / n
    return mse, 1.0 - mse / var

results = {}
for name, scale in (("scale1", 1.0), ("scale1000", 1000.0)):
    xs, ys = make_data(scale)
    w, b = fit_least_squares(xs, ys)
    mse, r2 = mse_and_r2(xs, ys, w, b)
    results[name] = (mse, r2)
    fixed = "PASS" if mse < 1e-2 else "FAIL"
    print(f"C5 {name}: MSE={mse:.6f} R2={r2:.6f} fixed-threshold(loss<1e-2)={fixed}")

fixed_scale1 = results["scale1"][0] < 1e-2
fixed_scale1000 = results["scale1000"][0] < 1e-2
rel_ok = results["scale1"][1] > 0.99 and results["scale1000"][1] > 0.99

opposite = fixed_scale1 != fixed_scale1000
print(f"C5 fixed-threshold verdicts differ across scales: {opposite}")
print(f"C5 scale-relative (R2>0.99) verdicts consistent: {rel_ok}")
ok = opposite and rel_ok
print("C5-FIXED-THRESHOLD-SCALE-DEPENDENT" if opposite else "C5-FIXED-THRESHOLD-HELD")
print("C5-SCALE-RELATIVE-CRITERIA-REQUIRED" if ok else "C5-FAILED")
sys.exit(0 if ok else 1)
PYEOF`
- Success criteria: exit 0 + output contains ["C5-SCALE-RELATIVE-CRITERIA-REQUIRED"]
- **Attempt 1: PASS** (exit 0, 96ms, journal jckhtq8g) — exit 0 + 1 output assertion(s) satisfied

```
$ python3 - <<'PYEOF'
import math, random, sys

# Fixed absolute thresholds are invalid across target scales. Two identical
# regression problems differing ONLY in target scale (1x vs 1000x): the whole
# target (signal AND noise) is scaled. Both are fitted to their irreducible
# noise floor by exact least squares - i.e. both are "fully memorized" in the
# sense that no model can beat the noise floor.
rng = random.Random(2024)

def make_data(scale):
    xs, ys = [], []
    for i in range(40):
        x = rng.uniform(0, 1)
        y = (3.0 * x + rng.gauss(0, 0.01)) * scale
        xs.append(x); ys.append(y)
    return xs, ys

def fit_least_squares(xs, ys):
    n = len(xs)
    mx = sum(xs) / n; my = sum(ys) / n
    sxx = sum((x - mx) ** 2 for x in xs)
    sxy = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    w = sxy / sxx
    b = my - w * mx
    return w, b

def mse_and_r2(xs, ys, w, b):
    n = len(xs)
    mse = sum((y - (w * x + b)) ** 2 for x, y in zip(xs, ys)) / n
    var = sum((y - (sum(ys) / n)) ** 2 for y in ys) / n
    return mse, 1.0 - mse / var

results = {}
for name, scale in (("scale1", 1.0), ("scale1000", 1000.0)):
    xs, ys = make_data(scale)
    w, b = fit_least_squares(xs, ys)
    mse, r2 = mse_and_r2(xs, ys, w, b)
    results[name] = (mse, r2)
    fixed = "PASS" if mse < 1e-2 else "FAIL"
    print(f"C5 {name}: MSE={mse:.6f} R2={r2:.6f} fixed-threshold(loss<1e-2)={fixed}")

fixed_scale1 = results["scale1"][0] < 1e-2
fixed_scale1000 = results["scale1000"][0] < 1e-2
rel_ok = results["scale1"][1] > 0.99 and results["scale1000"][1] > 0.99

opposite = fixed_scale1 != fixed_scale1000
print(f"C5 fixed-threshold verdicts differ across scales: {opposite}")
print(f"C5 scale-relative (R2>0.99) verdicts consistent: {rel_ok}")
ok = opposite and rel_ok
print("C5-FIXED-THRESHOLD-SCALE-DEPENDENT" if opposite else "C5-FIXED-THRESHOLD-HELD")
print("C5-SCALE-RELATIVE-CRITERIA-REQUIRED" if ok else "C5-FAILED")
sys.exit(0 if ok else 1)
PYEOF
C5 scale1: MSE=0.000121 R2
```

### VTC-000015 — C6 zero grads are normal: naive all-nonzero assertion is a false-positive generator [PASS] (negative, critical)
- Objective: healthy memorizing pipeline with dead ReLU units carries exactly-zero grads; the naive assertion fails while the correct assertion (no NaN/Inf + per-layer nonzero) passes
- Command: `python3 knowledge/verification/sandbox/VRUN-000003/c6_zero_grads.py`
- Success criteria: exit 0 + output contains ["C6-ZERO-GRADS-NORMAL-CONFIRMED"]
- **Attempt 1: FAIL** (exit 1, 147ms, journal bmofjvyl) — exit code 1 ≠ expected 0

```
$ python3 - <<'PYEOF'
import math, random, sys

# Zero gradients on individual parameters are NORMAL in a healthy pipeline
# (dead ReLU units); asserting all-non-zero grads is a false-positive machine.
def gen_data(seed=42, n=12, din=6, K=4):
    rng = random.Random(seed)
    centers = [[rng.uniform(-1, 1) for _ in range(din)] for _ in range(K)]
    X, Y = [], []
    for i in range(n):
        c = i % K
        X.append([centers[c][j] + rng.gauss(0, 0.25) for j in range(din)])
        Y.append(c)
    return X, Y

def init_net(seed=7, din=6, dh=16, K=4):
    # dead_bias: half the hidden units start with a strongly negative bias and
    # never activate on this tiny batch -> exactly-zero grads, by construction
    rng = random.Random(seed)
    W1 = [[rng.gauss(0, math.sqrt(2.0 / din)) for _ in range(dh)] for _ in range(din)]
    b1 = [-3.0 if j >= dh // 2 else 0.0 for j in range(dh)]
    W2 = [[rng.gauss(0, math.sqrt(2.0 / dh)) for _ in range(K)] for _ in range(dh)]
    b2 = [0.0] * K
    return W1, b1, W2, b2

def forward(X, W1, b1, W2, b2):
    H, L = [], []
    for x in X:
        h = [max(0.0, sum(x[i] * W1[i][j] for i in range(len(x))) + b1[j]) for j in range(len(b1))]
        l = [sum(h[j] * W2[j][k] for j in range(len(h))) + b2[k] for k in range(len(b2))]
        H.append(h); L.append(l)
    return H, L

def softmax(l):
    m = max(l); e = [math.exp(v - m) for v in l]; s = sum(e)
    return [v / s for v in e]

def loss_acc(L, Y):
    tot = 0.0; hit = 0
    for l, y in zip(L, Y):
        p = softmax(l); tot += -math.log(p[y])
        if max(range(len(p)), key=lambda k: p[k]) == y: hit += 1
    return tot / len(Y), hit / len(Y)

def grads(X, Y, W1, b1, W2, b2):
    H, L = forward(X, W1, b1, W2, b2)
    n, din, dh, K = len(Y), len(W1), len(b1), len(b2)
    P = [softmax(l) for l in L]
    dW1 = [[0.0] * dh for _ in range(din)]; db1 = [0.0] * dh
    dW2 = [[0.0] * K for _ in range(dh)]; db2 = [0.0] * K
    for s in range(n):
        dl = [P[s][k] - (1.0 if k == Y[s]
```
- **Attempt 2: PASS** (exit 0, 232ms, journal 2k5n0i0k) — exit 0 + 1 output assertion(s) satisfied

```
$ python3 knowledge/verification/sandbox/VRUN-000003/c6_zero_grads.py
C6 training with dead-biased init: final loss=0.000900 acc=100.0PCT
C6 dead hidden units on this batch=8 of 16
C6 zero-grad weights=80 of 160
C6 naive all-nonzero-grad assertion: FAIL (false positive)
C6 correct assertion (no NaN/Inf + every trainable layer has nonzero grad): PASS
C6-ZERO-GRADS-NORMAL-CONFIRMED
exit code: 0
```

### VTC-000016 — C3 doc-based: PyTorch CrossEntropyLoss logits/dtype expectations (live fetch) [PASS] (validation, critical)
- Objective: inspect the ACTUAL official PyTorch documentation from the user's machine: CE input must be unnormalized logits; target dtype long for class indices (record claims these are doc-verifiable per framework version)
- Command: `bash knowledge/verification/sandbox/VRUN-000003/c3_pytorch_doc.sh`
- Success criteria: exit 0 + output contains ["C3-DOC-VERIFIED"]
- **Attempt 1: FAIL** (exit 1, 1990ms, journal 0oazoabs) — exit code 1 ≠ expected 0

```
$ #!/usr/bin/env bash
# C3 (doc-based): inspect the ACTUAL PyTorch documentation for CrossEntropyLoss
# label-dtype and raw-logits expectations. Resolves the current stable version
# from the official redirect, fetches that exact versioned page, and asserts
# the documented statements. Executed on the user's machine through the bridge.
set -u
STABLE='https://pytorch.org/docs/stable/generated/torch.nn.CrossEntropyLoss.html'
REDIR=$(curl -sL --max-time 25 "$STABLE") || { echo "C3-DOC-FETCH-FAILED: $STABLE"; exit 1; }
VER=$(printf '%s' "$REDIR" | grep -oE '[0-9]+\.[0-9]+/generated' | head -1 | cut -d/ -f1)
if [ -z "$VER" ]; then echo "C3-DOC-VERSION-RESOLVE-FAILED"; exit 1; fi
URL="https://pytorch.org/docs/$VER/generated/torch.nn.CrossEntropyLoss.html"
TMPF=$(mktemp)
curl -sL --max-time 30 "$URL" -o "$TMPF" || { echo "C3-DOC-FETCH-FAILED: $URL"; rm -f "$TMPF"; exit 1; }
python3 - "$TMPF" "$VER" "$URL" <<'PYEOF'
import sys, re, html
path, ver, url = sys.argv[1], sys.argv[2], sys.argv[3]
raw = open(path, encoding='utf-8', errors='replace').read()
text = html.unescape(re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', ' ', raw)))
checks = {
    'raw-logits-expected': 'unnormalized logits for each class',
    'target-dtype-long': 'The target data type is required to be',
    'class-indices-context': 'when using class indices',
}
print('DOC-SOURCE:', url)
print('DOC-VERSION:', ver)
ok = True
for name, needle in checks.items():
    found = needle in text
    print(f'DOC-{name}:', 'FOUND' if found else 'MISSING')
    ok = ok and found
m = re.search(r'The target data type[^.]*\.[^.]*\.?', text)
if m: print('DOC-QUOTE-dtype:', m.group(0)[:320])
m2 = re.search(r'[^.]{0,200}unnormalized logits for each class[^.]*\.', text)
if m2: print('DOC-QUOTE-logits:', m2.group(0)[:320])
m3 = re.search(r'[^.]{0,120}class probabilities only when[^.]*\.', text)
if m3: print('DOC-QUOTE-softlabel-nuance:', m3.group(0)[:320])
print('C3-DOC-VERIFIED' if ok else 'C3-DOC-NOT-VERIFIED')
sys.exit(0 if ok else 1)
P
```
- **Attempt 2: PASS** (exit 0, 1524ms, journal h6k0646z) — exit 0 + 1 output assertion(s) satisfied

```
$ bash knowledge/verification/sandbox/VRUN-000003/c3_pytorch_doc.sh
DOC-SOURCE: https://pytorch.org/docs/2.15/generated/torch.nn.CrossEntropyLoss.html
DOC-VERSION: 2.15
DOC-raw-logits-expected: FOUND
DOC-target-dtype-long: FOUND
DOC-class-indices-context: FOUND
DOC-QUOTE-dtype: The target data type is required to be long when using class indices. If containing class probabilities, the target must be the same shape input, and each value should be between [ 0 , 1 ] [0, 1] [ 0 , 1 ] .
DOC-QUOTE-logits:  The input is expected to contain the unnormalized logits for each class (which do not need to be positive or sum to 1, in general).
DOC-QUOTE-softlabel-nuance:  Consider providing target as class probabilities only when a single class label per minibatch item is too restrictive.
C3-DOC-VERIFIED
exit code: 0
```

## 7. Metrics
- **chance_ce_k2:** 0.693147 nats — measured (verified against cited output)
- **chance_ce_k10:** 2.302585 nats — measured (verified against cited output)
- **healthy_final_loss:** 0.003293 nats — measured (verified against cited output)
- **fd_gradient_max_rel_err:** 2.187e-09 relative — measured (verified against cited output)
- **shuffled_final_loss_after_escalation:** 0.162318 nats — measured (verified against cited output)
- **shuffled_final_accuracy:** 91.7 PCT — measured (verified against cited output)
- **excess_capacity_boundary_loss:** 0.023197 nats — measured (verified against cited output)
- **mse_scale1000_at_noise_floor:** 98.599659 squared_units — measured (verified against cited output)
- **r2_scale1000:** 0.999859 fraction — measured (verified against cited output)
- **zero_grad_weights_in_healthy_pipeline:** 80 of 160 — measured (verified against cited output)
- **pytorch_doc_version_inspected:** 2.15 version — measured (verified against cited output)

## 8. AI INTERPRETATION (submitted by GLM — not measurement)
### Round 2 analysis (by GLM (z.ai web))
All 8 critical cases passed against real executions on the user's machine (round 2; round 1's five failures were infrastructure failures caused by the engine's silent 2000-char command truncation — root cause fixed, mangled attempts preserved as VTA-000013/14/15/17/18). Measured: C1 chance-level CE equals ln(K) exactly for K=2 (0.693147) and K=10 (2.302585), near-one-hot CE approaches 0. C2 a constant predictor scores 100% on a single-class batch but exactly 25%/10% on class-spanning batches (K=4/10) — single-class batches void the test. C4a a finite-difference-certified healthy pure-python MLP (max grad rel-err 2.187e-09) memorizes 12 class-spanning samples in 400 steps (100% batch accuracy, loss 0.003293 vs ln(4)=1.386294 baseline). C4b the same architecture on independently shuffled labels fails the protocol even after 4x steps at raised LR (91.7% accuracy, loss 0.162318 > the 0.138629 pass bar) — mechanical bug correctly flagged. C4c at excess capacity (dh=16) the same budget fully memorizes the misaligned labels (100%, loss 0.023197) — the protocol's failure-to-overfit-implies-mechanical-bug inference requires task-matched capacity, exactly as the record's limitations prescribe. C5 a fixed loss<1e-2 threshold false-fails a fully-fitted MSE problem at target scale 1000 (MSE 98.599659, R2 0.999859) while passing scale 1 — scale-relative criteria required. C6 a healthy memorizing pipeline carries exactly-zero grads on 80 of 160 weights (8 dead ReLU units); the naive all-nonzero assertion fails while the correct no-NaN/Inf + per-layer-nonzero assertion passes. C3 the live-fetched official PyTorch 2.15 documentation states CE input is expected to be unnormalized logits and the target dtype is required to be long when using class indices.

**Expected vs observed:** Every prediction in the hypothesis matched the measured outcome. Expected vs observed: ln(2)=0.693147 vs 0.693147 (exact); ln(10)=2.302585 vs 2.302585 (exact); healthy protocol pass (acc 100%, loss << 0.1*ln4=0.138629) vs measured 100%/0.003293; shuffled-labels protocol fail (acc<100% or loss>0.138629) vs measured 91.7%/0.162318 — note the honest nuance: substantial partial memorization occurs (91.7%), but the protocol's pass bar is not met, and the conclusion (hunt the mechanical bug) is correct since the labels ARE misaligned; capacity boundary at dh=16 vs measured full memorization (100%/0.023197); scale-1000 MSE floor ~100 vs measured 98.599659 with R2 0.999859 (fully fitted); zero-grad fraction ~half the weights vs measured 80/160 with training still reaching 100% accuracy.
**Alternative explanations:** (1) The shuffled-label run reaches 91.7% accuracy — with extreme budgets or excess capacity, misaligned labels CAN be fully memorized (Zhang et al. 2017); the protocol's discriminating power was demonstrated at task-matched capacity and its documented budget, and the capacity boundary is recorded as case C4c rather than hidden. (2) The initial C4 design (dh=16 for both healthy and shuffled cases) FAILED local dry-run validation — the shuffled copy passed the protocol at 400 steps — this design iteration is reported rather than suppressed and became the C4c boundary case. (3) The C3 documentation check reveals a nuance the record hedges correctly: PyTorch >=1.10 also accepts class-probability (soft-label) float targets; the record's phrase 'doc-verifiable per framework version' is accurate, and the inspected version is 2.15. (4) Round-1 failures were pure infrastructure (command truncation), evidenced by the SyntaxError outputs, not by experiment results.
**Recommended modifications:** For the owner's review of EXP-000008 v3: the verified evidence supports the record's core claims. Two refinements worth considering in a future revision: (a) the limitations could cite the measured capacity boundary (excess-capacity nets memorize misaligned labels, dh=16 memorized at 400 steps) as concrete evidence for the existing 'reduce width' guidance; (b) the CrossEntropyLoss parenthetical could note that current PyTorch (2.15) also accepts class-probability float targets — the doc quote is preserved in attempt VTA-000023. Neither changes the protocol itself.

**Proposed conclusion:** VERIFIED — All 8 critical test cases passed on real executions on the user's machine: analytic baselines exact; single-class batches void the tiny-batch test; a gradient-verified healthy pipeline passes the protocol while a label-misaligned copy fails it at task-matched capacity; the capacity boundary is documented; fixed loss thresholds are scale-dependent; zero grads are normal in healthy pipelines; and the live-fetched PyTorch 2.15 documentation confirms the logits/dtype expectations. The pure-python substitute for the DL-framework variant (original plan item C4) remains the one framework-level gap: torch is not installed on the workspace machine.
**Engine decision:** ACCEPTED → VERIFIED. GLM's proposal matches the evidence: all 8 critical test(s) passed against real executions

## 9. Limitations
- Commands executed on the user's machine through the VS Code extension as the local user — no CPU/memory sandbox isolation is enforceable through this transport.
- Network access for non-flagged tests could not be technically blocked; tests that declared network needs required explicit owner confirmation instead.
- Attempt outputs are redacted for secrets and capped at 20,000 characters per attempt.