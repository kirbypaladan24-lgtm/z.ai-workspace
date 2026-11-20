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
