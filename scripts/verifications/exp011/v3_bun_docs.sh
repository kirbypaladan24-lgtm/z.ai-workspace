#!/usr/bin/env bash
# V3 (record plan, doc-based): inspect the ACTUAL official Bun documentation
# for lockfile semantics — the record's three-layer chain depends on the
# lockfile recording exact resolutions, being distinct from node_modules, and
# being committed to the repository.
set -u
TMPF=$(mktemp)
URL='https://bun.sh/docs/install/lockfile'
curl -sL --max-time 30 "$URL" -o "$TMPF" 2>/dev/null || { echo "V3-DOC-FETCH-FAILED: $URL"; rm -f "$TMPF"; exit 1; }
python3 - "$TMPF" "$URL" <<'PYEOF'
import sys, re, html
path, url = sys.argv[1], sys.argv[2]
raw = open(path, encoding='utf-8', errors='replace').read()
text = html.unescape(re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', ' ', raw)))
checks = {
    'lockfile-created': 'bun install creates a lockfile called bun.lock',
    'text-based-format': 'text-based bun.lock',
    'distinct-from-node-modules': '--lockfile-only',
    'committed-to-git': 'committed to git',
}
print('DOC-SOURCE:', url)
ok = True
for name, needle in checks.items():
    found = needle in text
    print(f'DOC-{name}:', 'FOUND' if found else 'MISSING')
    ok = ok and found
m = re.search(r'To generate a lockfile without installing to node_modules[^.]*\.', text)
if m: print('DOC-QUOTE-layer-distinction:', m.group(0)[:260])
m2 = re.search(r'Bun v1\.2 changed the default lockfile format[^.]*\.', text)
if m2: print('DOC-QUOTE-text-based:', m2.group(0)[:260])
m3 = re.search(r'Should it be committed to git\?[^#]*#? ?Yes', text)
if m3: print('DOC-QUOTE-commit:', m3.group(0)[:160])
print('V3-DOC-VERIFIED' if ok else 'V3-DOC-NOT-VERIFIED')
sys.exit(0 if ok else 1)
PYEOF
rc=$?
rm -f "$TMPF"
exit $rc
