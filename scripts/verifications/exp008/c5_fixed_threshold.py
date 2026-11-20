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
