#!/usr/bin/env bash
# V1b (record plan V1): path-limited stash — `git stash push -- <paths>`.
# Same scenario as V1a; the rollback mechanism is the path-limited stash.
# The user's WIP must survive, the agent's edit must be gone (and recoverable
# in the stash), and the original failing check must reproduce.
set -u
T=$(mktemp -d /tmp/vrun7b-XXXXXX)
cleanup() { rm -rf "$T"; }
trap cleanup EXIT
cd "$T" || exit 1
git init -q repo || exit 1
cd repo || exit 1
git config user.email t@t.local
git config user.name tester

printf 'feature A\n' > app.js
printf 'function lib() { return "BROKEN"; }\n' > lib.js
git add -A
git commit -qm baseline

cat > check.sh <<'CHK'
#!/usr/bin/env bash
if grep -q BROKEN lib.js; then
  echo "ORIGINAL-ERROR: lib.js is BROKEN"
  exit 1
fi
echo "FIXED"
exit 0
CHK
chmod +x check.sh

if ./check.sh > base.out 2>&1; then echo "V1b-FAILED: baseline unexpectedly passes"; exit 1; fi

# USER pre-existing uncommitted work
printf 'feature A\nuser WIP line\n' > app.js
# AGENT failed fix attempt in lib.js
printf 'function lib() { return "BROKEN"; }\n// agent attempted fix\n' > lib.js

# PATH-LIMITED STASH: stash ONLY lib.js
git stash push -q -m "agent rollback" -- lib.js

if ./check.sh > after.out 2>&1; then echo "V1b-FAILED: check passes after stash rollback"; exit 1; fi
grep -q "ORIGINAL-ERROR" after.out || { echo "V1b-FAILED: different error after stash"; exit 1; }
echo "V1b confirm: original error reproduced after path-limited stash"

if grep -q 'user WIP line' app.js; then
  echo "V1b-user-wip-survived: YES"
else
  echo "V1b-user-wip-survived: NO"
  exit 1
fi
if grep -q 'agent attempted fix' lib.js; then
  echo "V1b-agent-edit-gone: NO"
  exit 1
else
  echo "V1b-agent-edit-gone: YES"
fi
# the stashed change is recoverable (not destroyed)
if git stash list | grep -q "agent rollback"; then
  echo "V1b-stashed-change-recoverable: YES"
else
  echo "V1b-stashed-change-recoverable: NO"
  exit 1
fi
echo "V1b-PATH-LIMITED-STASH-VERIFIED"
exit 0
