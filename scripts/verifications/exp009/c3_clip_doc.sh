#!/usr/bin/env bash
# C3 (doc-based): inspect the ACTUAL PyTorch documentation for gradient-
# clipping semantics (record plan C3: "clipping and loss-dtype semantics of
# the framework in use"). Tries the stable URL first; pytorch.org sometimes
# serves a bot-protection "Client Challenge" page instead, so a versioned
# fallback (current stable 2.15, resolved earlier today from the official
# redirect) is tried next. The final source actually served is printed and
# every assertion is checked against THAT page.
set -u
TMPF=$(mktemp)
try_fetch() {
  # try_fetch URL -> writes to $TMPF, echoes the URL on success (page must
  # actually document clip_grad_norm_, not a challenge/redirect stub)
  local url="$1"
  curl -sL --max-time 30 "$url" -o "$TMPF" 2>/dev/null || return 1
  if grep -q 'clip_grad_norm_' "$TMPF" && grep -q 'Clip the gradient norm' "$TMPF"; then
    echo "$url"; return 0
  fi
  return 1
}
URL=$(try_fetch 'https://pytorch.org/docs/stable/generated/torch.nn.utils.clip_grad_norm_.html') \
  || URL=$(try_fetch 'https://pytorch.org/docs/2.15/generated/torch.nn.utils.clip_grad_norm_.html') \
  || { echo "C3-DOC-FETCH-FAILED: neither stable nor 2.15 served the documentation page (bot-protection challenge or network)"; rm -f "$TMPF"; exit 1; }
python3 - "$TMPF" "$URL" <<'PYEOF'
import sys, re, html
path, url = sys.argv[1], sys.argv[2]
raw = open(path, encoding='utf-8', errors='replace').read()
text = html.unescape(re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', ' ', raw)))
mver = re.search(r'PyTorch (\d+\.\d+) documentation', raw)
ver = mver.group(1) if mver else 'unknown'
checks = {
    'clips-gradient-norm': 'Clip the gradient norm of an iterable of parameters',
    'norm-over-all-params': 'concatenated into a single vector',
    'modified-in-place': 'Gradients are modified in-place',
}
print('DOC-SOURCE:', url)
print('DOC-VERSION:', ver)
ok = True
for name, needle in checks.items():
    found = needle in text
    print(f'DOC-{name}:', 'FOUND' if found else 'MISSING')
    ok = ok and found
m = re.search(r'Clip the gradient norm[^.]*\.', text)
if m: print('DOC-QUOTE-what:', m.group(0)[:300])
m2 = re.search(r'[^.]{0,160}concatenated into a single vector[^.]*\.', text)
if m2: print('DOC-QUOTE-norm:', m2.group(0)[:340])
m3 = re.search(r'Gradients are modified in-place[^.]*\.', text)
if m3: print('DOC-QUOTE-inplace:', m3.group(0)[:200])
print('C3-DOC-VERIFIED' if ok else 'C3-DOC-NOT-VERIFIED')
sys.exit(0 if ok else 1)
PYEOF
rc=$?
rm -f "$TMPF"
exit $rc
