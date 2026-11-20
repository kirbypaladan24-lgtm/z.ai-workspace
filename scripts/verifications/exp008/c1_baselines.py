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
