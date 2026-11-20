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

def train(X, Y, W1, b1, W2, b2, steps, lr):
    for _ in range(steps):
        dW1, db1, dW2, db2 = grads(X, Y, W1, b1, W2, b2)
        sgd(W1, b1, W2, b2, dW1, db1, dW2, db2, lr)
    return loss_acc(forward(X, W1, b1, W2, b2)[1], Y)

lnK = math.log(4)
mode = sys.argv[1] if len(sys.argv) > 1 else 'healthy'
dh = int(sys.argv[2]) if len(sys.argv) > 2 else 4
X, Y = gen_data()
if mode in ('shuffled', 'boundary'):
    s = random.Random(99)
    Y = Y[:]
    s.shuffle(Y)
W1, b1, W2, b2 = init_net(dh=dh)

if mode == 'healthy':
    # FD gradient check certifies the implementation is mechanically correct
    eps = 1e-6
    rng = random.Random(123)
    worst = 0.0
    for (mat, i, j) in [(W1, rng.randrange(6), rng.randrange(dh)) for _ in range(3)] + \
                        [(W2, rng.randrange(dh), rng.randrange(4)) for _ in range(2)]:
        orig = mat[i][j]
        mat[i][j] = orig + eps
        lp, _ = loss_acc(forward(X, W1, b1, W2, b2)[1], Y)
        mat[i][j] = orig - eps
        lm, _ = loss_acc(forward(X, W1, b1, W2, b2)[1], Y)
        mat[i][j] = orig
        num = (lp - lm) / (2 * eps)
        dW1, db1, dW2, db2 = grads(X, Y, W1, b1, W2, b2)
        ana = dW1[i][j] if mat is W1 else dW2[i][j]
        worst = max(worst, abs(num - ana) / max(abs(num), abs(ana), 1e-12))
    print(f"C4a FD-gradient-check max-rel-err={worst:.3e} (dh={dh})")
    if worst >= 1e-4:
        print("C4a-FAILED-FDCHECK"); sys.exit(1)
    loss0, acc0 = loss_acc(forward(X, W1, b1, W2, b2)[1], Y)
    lossf, accf = train(X, Y, W1, b1, W2, b2, 400, 0.5)
    print(f"C4a step0 loss={loss0:.6f} (~ln4={lnK:.6f}) acc={acc0 * 100:.1f}PCT")
    print(f"C4a final loss={lossf:.6f} acc={accf * 100:.1f}PCT steps=400 lr=0.5 dh={dh}")
    passed = (accf == 1.0) and (lossf < 0.1 * lnK)
    print("C4a-PROTOCOL-PASS" if passed else "C4a-PROTOCOL-NOT-PASSED")
    print("C4a-HEALTHY-PIPELINE-VERIFIED" if passed else "C4a-FAILED")
    sys.exit(0 if passed else 1)

if mode == 'shuffled':
    print("C4b mechanical bug: labels shuffled independently of inputs (dh=4, task-matched)")
    loss1, acc1 = train(X, Y, W1, b1, W2, b2, 400, 0.5)
    # protocol escalation: train LONGER (4x total) at RAISED lr (2x)
    loss2, acc2 = train(X, Y, W1, b1, W2, b2, 1200, 1.0)
    print(f"C4b phase1 (400 steps, lr 0.5): loss={loss1:.6f} acc={acc1 * 100:.1f}PCT")
    print(f"C4b phase2 (1600 total steps, lr 1.0): loss={loss2:.6f} acc={acc2 * 100:.1f}PCT")
    print(f"C4b chance floor ln(4)={lnK:.6f}; protocol pass bar: acc=100PCT and loss<0.1*lnK={0.1 * lnK:.6f}")
    protocol_fails = (acc2 < 1.0) or (loss2 > 0.1 * lnK)
    print("C4b-PROTOCOL-FAIL-DETECTED" if protocol_fails else "C4b-PROTOCOL-PASS-UNEXPECTED")
    print("C4b-MECHANICAL-BUG-CORRECTLY-FLAGGED" if protocol_fails else "C4b-DISCRIMINATION-BROKE")
    sys.exit(0 if protocol_fails else 1)

if mode == 'boundary':
    print("C4c excess capacity: SAME budget as healthy (400 steps, lr 0.5) but dh=16 on misaligned labels")
    lossf, accf = train(X, Y, W1, b1, W2, b2, 400, 0.5)
    print(f"C4c final loss={lossf:.6f} acc={accf * 100:.1f}PCT steps=400 lr=0.5 dh=16")
    memorized = (accf == 1.0) and (lossf < 0.1)
    print("C4c-EXCESS-CAPACITY-MEMORIZES-SHUFFLED" if memorized else "C4c-EXCESS-CAPACITY-DID-NOT-MEMORIZE")
    print("C4c-CAPACITY-BOUNDARY-DOCUMENTED" if memorized else "C4c-OBSERVATION-DIFFERS")
    sys.exit(0 if memorized else 1)
