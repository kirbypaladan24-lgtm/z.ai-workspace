#!/usr/bin/env bash
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
PYEOF
rc=$?
rm -f "$TMPF"
exit $rc
