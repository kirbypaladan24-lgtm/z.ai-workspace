#!/usr/bin/env bash
# V4 (record plan, doc-based): inspect the ACTUAL official Prisma v6
# documentation (the installed sandbox major version is 6.11.1) for
# (a) query logging configuration and (b) the N+1 problem + relation-loading
# batching semantics. HONEST SCOPE NOTE: the Prisma SQLite connector page
# (https://www.prisma.io/docs/orm/v6/overview/databases/sqlite) was fetched
# and inspected during design — it does NOT document SQLite locking/concurrency
# behavior ('database is locked', WAL, busy timeout: zero occurrences); the
# locking semantics are therefore verified against SQLite's own docs (V1).
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

echo "DOC-SOURCE-1: https://www.prisma.io/docs/orm/v6/prisma-client/observability-and-logging/logging"
fetch 'https://www.prisma.io/docs/orm/v6/prisma-client/observability-and-logging/logging' || { echo "V4-DOC-FETCH-FAILED: logging"; rm -f "$TMPF"; exit 1; }
T1=$(norm)
check "$T1" "new PrismaClient" "logging-constructor" || ok=false
check "$T1" "log: [ " "logging-log-array" || ok=false
check "$T1" "subscribe to events" "logging-events" || ok=false
printf '%s' "$T1" | grep -oE "The simplest way to print all log levels to stdout[^.]*\." | head -1 | sed 's/^/DOC-QUOTE-logging: /' || true

echo "DOC-SOURCE-2: https://www.prisma.io/docs/orm/v6/prisma-client/queries/query-optimization-performance"
fetch 'https://www.prisma.io/docs/orm/v6/prisma-client/queries/query-optimization-performance' || { echo "V4-DOC-FETCH-FAILED: query-optimization"; rm -f "$TMPF"; exit 1; }
T2=$(norm)
check "$T2" "one additional query per result" "nplus1-definition" || ok=false
check "$T2" "does not currently batch findMany() queries" "dataloader-batching-nuance" || ok=false
printf '%s' "$T2" | grep -oE "The n\+1 problem occurs when[^.]*\." | head -1 | sed 's/^/DOC-QUOTE-nplus1: /' || true
printf '%s' "$T2" | grep -oE "[^.]{0,160}does not currently batch findMany\(\) queries[^.]*\." | head -1 | sed 's/^/DOC-QUOTE-batching: /' || true

if [ "$ok" = true ]; then
  echo "V4-DOC-VERIFIED"
  rm -f "$TMPF"
  exit 0
else
  echo "V4-DOC-NOT-VERIFIED"
  rm -f "$TMPF"
  exit 1
fi
