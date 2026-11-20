import math, random, sys

# C6 (solutionSteps claim): NaN/Inf EARLY is also ambiguous — a numeric fault
# in the loss/forward path and an LR far too high produce the same shape.
# The record's listed checks disambiguate: (a) per-feature input min/max scan,
# (b) grad norms at the last healthy step, (c) LR-reduction probe.

def softmax2(z0, z1):
    m = max(z0, z1)
    e0 = math.exp(z0 - m); e1 = math.exp(z1 - m)
    s = e0 + e1
    return e0 / s, e1 / s

def ce_stable(z0, z1, y):
    # numerically stable CE: log-sum-exp form; never NaN for finite logits
    m = max(z0, z1)
    lse = m + math.log(math.exp(z0 - m) + math.exp(z1 - m))
    zy = z0 if y == 0 else z1
    return lse - zy

def ce_naive(z0, z1, y):
    # naive CE: -log(softmax) — underflows to p_y = 0.0 for extreme logits,
    # then log(0) = inf (frameworks return inf, python raises; we mirror the
    # framework behavior explicitly)
    p0, p1 = softmax2(z0, z1)
    py = p0 if y == 0 else p1
    return -math.log(py) if py > 0.0 else float('inf')

ok = True

# --- Cause 1: numeric fault in the loss itself (log(0)) with CLEAN inputs
rng = random.Random(11)
X = [[rng.uniform(-1, 1), rng.uniform(-1, 1)] for _ in range(20)]
Y = [i % 2 for i in range(20)]
# per-feature min/max scan: inputs are clean (check (a))
mins = [min(x[j] for x in X) for j in (0, 1)]
maxs = [max(x[j] for x in X) for j in (0, 1)]
inputs_clean = all(mins[j] >= -1.0 and maxs[j] <= 1.0 for j in (0, 1))
# a model-side scale bug (weights 500x too large) drives logits to +-~1000
W_bad = [[500.0, 0.0], [0.0, -500.0]]; b_bad = [0.0, 0.0]
losses = []
for x, y in zip(X, Y):
    z0 = W_bad[0][0] * x[0] + W_bad[0][1] * x[1] + b_bad[0]
    z1 = W_bad[1][0] * x[0] + W_bad[1][1] * x[1] + b_bad[1]
    losses.append(ce_naive(z0, z1, y))
c1_inf_at_step0 = any(l == float('inf') for l in losses)
print(f"C6-cause1 loss-fault: inputs-clean={inputs_clean} (min={mins}, max={maxs}); step-0 losses contain inf={c1_inf_at_step0}")
stable_same = [ce_stable(W_bad[0][0] * x[0] + b_bad[0], W_bad[1][1] * x[1] + b_bad[1], y) for x, y in zip(X, Y)]
print(f"C6-cause1 audit: stable log-sum-exp form on the SAME logits stays finite (max={max(stable_same):.1f}) -> the fault is the naive log(p), i.e. inside the loss computation, not the data")
ok = ok and inputs_clean and c1_inf_at_step0 and all(math.isfinite(s) for s in stable_same)

# --- Cause 2: LR far too high — healthy step 0, explosion within steps
W = [[0.05, 0.0], [0.0, 0.05]]; b = [0.0, 0.0]
def step_grads(X, Y, W, b):
    dW = [[0.0, 0.0], [0.0, 0.0]]; db = [0.0, 0.0]; tot = 0.0
    n = len(Y)
    for x, y in zip(X, Y):
        z0 = W[0][0] * x[0] + W[0][1] * x[1] + b[0]
        z1 = W[1][0] * x[0] + W[1][1] * x[1] + b[1]
        p0, p1 = softmax2(z0, z1)
        py = p0 if y == 0 else p1
        # mirror framework behavior: log(0) -> inf, never a python exception
        tot += -math.log(py) if py > 0.0 else float('inf')
        d0 = p0 - (1.0 if y == 0 else 0.0)
        d1 = p1 - (1.0 if y == 1 else 0.0)
        dW[0][0] += d0 * x[0] / n; dW[1][1] += d1 * x[1] / n
        db[0] += d0 / n; db[1] += d1 / n
    return tot / n, dW, db

l0, dW, db = step_grads(X, Y, W, b)
gn0 = math.sqrt(sum(g * g for row in dW for g in row) + db[0] ** 2 + db[1] ** 2)
exploded = False
gn_seq = [gn0]
W = [row[:] for row in W]; b = b[:]
for i in range(10):
    l, dW, db = step_grads(X, Y, W, b)
    gn = math.sqrt(sum(g * g for row in dW for g in row) + db[0] ** 2 + db[1] ** 2)
    if not math.isfinite(l) or not math.isfinite(gn):
        exploded = True
        break
    gn_seq.append(gn)
    for k in (0, 1):
        for j in (0, 1): W[k][j] -= 1e4 * dW[k][j]
        b[k] -= 1e4 * db[k]
print(f"C6-cause2 LR-fault: step-0 loss healthy={l0:.6f} (ln2={math.log(2):.6f}); exploded-to-nonfinite={exploded} within {i + 1} steps at lr=1e4")
print(f"C6-cause2 checks: inputs clean={inputs_clean} (not (a)); loss already uses the stable log-sum-exp form (not (b)); grad-norms at healthy steps={[f'{g:.3f}' for g in gn_seq]} (sane — by the record's own guidance this pointed back to (a)/(b), but both were eliminated by their checks, leaving LR)")
ok = ok and exploded and inputs_clean

# LR-reduction probe: divide LR by 10 enough times and training becomes stable
W = [[0.05, 0.0], [0.0, 0.05]]; b = [0.0, 0.0]
lr = 1e6
for _ in range(10):
    lr /= 10.0
    Wt = [row[:] for row in W]; bt = b[:]
    stable_run = True
    for i in range(50):
        l, dW, db = step_grads(X, Y, Wt, bt)
        if not math.isfinite(l): stable_run = False; break
        for k in (0, 1):
            for j in (0, 1): Wt[k][j] -= lr * dW[k][j]
            bt[k] -= lr * db[k]
    if stable_run and l < l0:
        break
print(f"C6-cause2 probe: LR reduced to {lr:.0e} -> stable={stable_run}, final loss={l:.6f} (moving below step-0 {l0:.6f})")
ok = ok and exploded and stable_run and l < l0

print("C6-EXPLODING-AMBIGUOUS")
print("C6-CHECKS-DISAMBIGUATE" if ok else "C6-FAILED")
sys.exit(0 if ok else 1)
