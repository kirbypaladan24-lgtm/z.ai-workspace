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
        dl = [P[s][k] - (1.0 if k == Y[s] else 0.0) for k in range(K)]
        for j in range(dh):
            for k in range(K): dW2[j][k] += H[s][j] * dl[k] / n
        for k in range(K): db2[k] += dl[k] / n
        for j in range(dh):
            if H[s][j] <= 0: continue
            g = sum(dl[k] * W2[j][k] for k in range(K))
            for i in range(din): dW1[i][j] += X[s][i] * g / n
            db1[j] += g / n
    return dW1, db1, dW2, db2

def sgd(W1, b1, W2, b2, dW1, db1, dW2, db2, lr):
    for i in range(len(W1)):
        for j in range(len(W1[0])): W1[i][j] -= lr * dW1[i][j]
    for j in range(len(b1)): b1[j] -= lr * db1[j]
    for j in range(len(W2)):
        for k in range(len(W2[0])): W2[j][k] -= lr * dW2[j][k]
    for k in range(len(b2)): b2[k] -= lr * db2[k]

def count_zero(tensors):
    tot = 0; zero = 0
    for t in tensors:
        for row in t:
            for v in row:
                tot += 1
                if v == 0.0: zero += 1
    return tot, zero

X, Y = gen_data()
W1, b1, W2, b2 = init_net()  # half the hidden units are dead by construction

for step in range(600):
    dW1, db1, dW2, db2 = grads(X, Y, W1, b1, W2, b2)
    sgd(W1, b1, W2, b2, dW1, db1, dW2, db2, 0.5)

Lf = forward(X, W1, b1, W2, b2)[1]
lossf, accf = loss_acc(Lf, Y)
tot, zero = count_zero((dW1, dW2))
nan_inf = any((v != v) or math.isinf(v) for t in (dW1, dW2) for row in t for v in row)
per_layer_nonzero = any(abs(v) > 0 for row in dW1 for v in row) and any(abs(v) > 0 for row in dW2 for v in row)

# dead-unit count actually observed in the forward pass
H = forward(X, W1, b1, W2, b2)[0]
dead_units = sum(1 for j in range(len(b1)) if all(h[j] == 0.0 for h in H))

print(f"C6 training with dead-biased init: final loss={lossf:.6f} acc={accf * 100:.1f}PCT")
print(f"C6 dead hidden units on this batch={dead_units} of {len(b1)}")
print(f"C6 zero-grad weights={zero} of {tot}")
naive_assertion_ok = (zero == 0) and not nan_inf
correct_assertion_ok = (not nan_inf) and per_layer_nonzero
print(f"C6 naive all-nonzero-grad assertion: {'PASS' if naive_assertion_ok else 'FAIL (false positive)'}")
print(f"C6 correct assertion (no NaN/Inf + every trainable layer has nonzero grad): {'PASS' if correct_assertion_ok else 'FAIL'}")

healthy = accf == 1.0
ok = healthy and zero > 0 and (not naive_assertion_ok) and correct_assertion_ok
print("C6-ZERO-GRADS-NORMAL-CONFIRMED" if ok else "C6-FAILED")
sys.exit(0 if ok else 1)
