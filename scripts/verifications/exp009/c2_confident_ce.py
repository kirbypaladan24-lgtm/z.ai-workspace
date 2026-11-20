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
