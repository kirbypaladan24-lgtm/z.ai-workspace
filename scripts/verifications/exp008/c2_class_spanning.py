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
