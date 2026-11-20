#!/usr/bin/env bash
# V1 (record plan, doc-based): inspect the ACTUAL official SQLite documentation
# for the rollback-journal lock states (RESERVED / PENDING / EXCLUSIVE), WAL
# reader/writer concurrency, and the busy handler — the corrected locking
# explanation in EXP-000010 v2/v3 must match what the docs actually say.
set -u
TMPF=$(mktemp)
fetch() {
  curl -sL --max-time 30 "$1" -o "$TMPF" 2>/dev/null || return 1
  [ -s "$TMPF" ]
}
norm() {
  python3 - "$TMPF" <<'PYEOF'
import sys, re, html
raw = open(sys.argv[1], encoding='utf-8', errors='replace').read()
text = html.unescape(re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', ' ', raw)))
print(text)
PYEOF
}

echo "DOC-SOURCE-1: https://www.sqlite.org/lockingv3.html"
fetch 'https://www.sqlite.org/lockingv3.html' || { echo "V1-DOC-FETCH-FAILED: lockingv3"; rm -f "$TMPF"; exit 1; }
T1=$(norm)
check() {
  local text="$1" needle="$2" label="$3"
  if printf '%s' "$text" | grep -qF -- "$needle"; then
    echo "DOC-$label: FOUND"
    return 0
  else
    echo "DOC-$label: MISSING"
    return 1
  fi
}
ok=true
check "$T1" "RESERVED lock means that the process is planning on writing to the database file at some point in the future" "reserved-state" || ok=false
check "$T1" "PENDING lock means that the process holding the lock wants to write to the database as soon as possible" "pending-state" || ok=false
printf '%s' "$T1" | grep -oF "An EXCLUSIVE lock is needed in order to write to the database file" | head -1 | sed 's/^/DOC-QUOTE-exclusive: /' || true
printf '%s' "$T1" | grep -oF "RESERVED lock means that the process is planning on writing to the database file at some point in the future but that it is currently just reading from the file." | head -1 | sed 's/^/DOC-QUOTE-reserved: /' || true

echo "DOC-SOURCE-2: https://www.sqlite.org/wal.html"
fetch 'https://www.sqlite.org/wal.html' || { echo "V1-DOC-FETCH-FAILED: wal"; rm -f "$TMPF"; exit 1; }
T2=$(norm)
check "$T2" "one writer at a time" "wal-one-writer" || ok=false
printf '%s' "$T2" | grep -oE "[^.]{0,140}one writer at a time[^.]*\." | head -1 | sed 's/^/DOC-QUOTE-wal: /' || true
printf '%s' "$T2" | grep -oE "[^.]{0,120}(do not block|allows concurrent)[^.]*\." | head -2 | sed 's/^/DOC-QUOTE-wal-concurrency: /' || true

echo "DOC-SOURCE-3: https://www.sqlite.org/c3ref/busy_timeout.html"
fetch 'https://www.sqlite.org/c3ref/busy_timeout.html' || { echo "V1-DOC-FETCH-FAILED: busy_timeout"; rm -f "$TMPF"; exit 1; }
T3=$(norm)
check "$T3" "sleeps for a specified amount of time when a table is locked" "busy-handler" || ok=false
printf '%s' "$T3" | grep -oE "Set a busy handler[^.]*\." | head -1 | sed 's/^/DOC-QUOTE-busy: /' || true

if [ "$ok" = true ]; then
  echo "V1-DOC-VERIFIED"
  rm -f "$TMPF"
  exit 0
else
  echo "V1-DOC-NOT-VERIFIED"
  rm -f "$TMPF"
  exit 1
fi
