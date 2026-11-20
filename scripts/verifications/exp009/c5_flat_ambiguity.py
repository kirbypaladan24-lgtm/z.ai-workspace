import math, random, sys

# C5 (rootCause core claim): a FLAT loss curve is a CLUE, not a diagnosis.
# Three distinct causes produce a flat curve; the loss VALUE relative to the
# analytic baseline separates the value-classes, and the cheapest checks
# (gradient norms, parameter drift, majority-class baseline) separate
# candidates that share the same value.
# Pure-python binary softmax regression: z_k = W[k][0]*x0 + W[k][1]*x1 + b[k].

def softmax2(z0, z1):
    m = max(z0, z1)
    e0 = math.exp(z0 - m); e1 = math.exp(z1 - m)
    s = e0 + e1
    return e0 / s, e1 / s

def loss_grads(X, Y, W, b):
    n = len(Y)
    dW = [[0.0, 0.0], [0.0, 0.0]]; db = [0.0, 0.0]; tot = 0.0
    for x, y in zip(X, Y):
        z0 = W[0][0] * x[0] + W[0][1] * x[1] + b[0]
        z1 = W[1][0] * x[0] + W[1][1] * x[1] + b[1]
        p0, p1 = softmax2(z0, z1)
        py = p0 if y == 0 else p1
        tot += -math.log(py)
        d0 = p0 - (1.0 if y == 0 else 0.0)
        d1 = p1 - (1.0 if y == 1 else 0.0)
        dW[0][0] += d0 * x[0] / n; dW[0][1] += d0 * x[1] / n
        dW[1][0] += d1 * x[0] / n; dW[1][1] += d1 * x[1] / n
        db[0] += d0 / n; db[1] += d1 / n
    return tot / n, dW, db

def train(X, Y, W, b, steps, lr, use_grads=True):
    W = [row[:] for row in W]; b = b[:]
    for _ in range(steps):
        _, dW, db = loss_grads(X, Y, W, b)
        if use_grads:  # use_grads=False simulates a broken graph: nothing flows
            for k in (0, 1):
                for j in (0, 1): W[k][j] -= lr * dW[k][j]
                b[k] -= lr * db[k]
    return W, b

def make_informative(n=20, seed=5):
    rng = random.Random(seed)
    X, Y = [], []
    for i in range(n):
        c = i % 2
        X.append([rng.uniform(-1, 1) + (1.5 if c == 0 else -1.5), rng.uniform(-1, 1)])
        Y.append(c)
    return X, Y

def make_uninformative_imbalanced(n=200, seed=6, p0=0.9):
    rng = random.Random(seed)
    X, Y = [], []
    for i in range(n):
        X.append([rng.uniform(-1, 1), rng.uniform(-1, 1)])  # pure noise: no signal
        Y.append(0 if rng.random() < p0 else 1)
    return X, Y

ok = True
Z = [[0.0, 0.0], [0.0, 0.0]]; zb = [0.0, 0.0]  # zero init -> exactly uniform predictions

# --- Config A: optimizer not stepping (lr = 0) — flat AT the ln(2) baseline
Xa, Ya = make_informative()
lA0, gA, _ = loss_grads(Xa, Ya, Z, zb)
Wa2, ba2 = train(Xa, Ya, Z, zb, 200, 0.0)
lA1, _, _ = loss_grads(Xa, Ya, Wa2, ba2)
gn = math.sqrt(sum(g * g for row in gA for g in row))
params_unchanged_A = (Wa2 == Z and ba2 == zb)
print(f"C5-A not-stepping: step0={lA0:.6f} after-200-lr0-steps={lA1:.6f} (ln2={math.log(2):.6f})")
print(f"C5-A checks: grad-norm={gn:.6f} (nonzero={gn > 1e-9}), params-unchanged={params_unchanged_A} -> gradients exist, optimizer never applies them")
ok = ok and abs(lA0 - math.log(2)) < 1e-9 and abs(lA1 - lA0) < 1e-12 and gn > 1e-9 and params_unchanged_A

# --- Config B: broken graph (detached loss) — SAME flat value, different cause
Wb2, bb2 = train(Xa, Ya, Z, zb, 200, 0.5, use_grads=False)
lB1, _, _ = loss_grads(Xa, Ya, Wb2, bb2)
print(f"C5-B broken-graph: after-200-steps={lB1:.6f} (identical VALUE to A: {abs(lB1 - lA1) < 1e-12})")
print("C5-B checks: loss identical to A, but the cause differs — A has flowing grads and lr=0; B has NO gradient path at all (update receives zeros)")
ok = ok and abs(lB1 - lA1) < 1e-12

# --- Config C: near-constant labels + uninformative inputs — flat AT the prior floor
Xc, Yc = make_uninformative_imbalanced()
p0 = Yc.count(0) / len(Yc)
H = -(p0 * math.log(p0) + (1 - p0) * math.log(1 - p0))
Wc, bc = train(Xc, Yc, Z, zb, 3000, 0.5)
lC, _, _ = loss_grads(Xc, Yc, Wc, bc)
at_prior = abs(lC - H) < 0.05
print(f"C5-C prior-flat: converged loss={lC:.6f} class-prior-entropy H={H:.6f} majority-share={p0:.3f}")
print(f"C5-C checks: loss-at-prior-floor={at_prior} -> the model learned only the class prior (labels near-constant AND inputs uninformative)")
ok = ok and at_prior and abs(H - math.log(2)) > 0.2

print(f"C5 value-classes: chance-level ln2={math.log(2):.6f} (A,B) vs prior-floor {H:.6f} (C) — the VALUE splits the candidate space before any check runs")
print("C5-FLAT-AMBIGUOUS")
print("C5-VALUE-AND-CHECKS-DISAMBIGUATE" if ok else "C5-FAILED")
sys.exit(0 if ok else 1)
