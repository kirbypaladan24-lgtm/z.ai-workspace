#!/usr/bin/env bash
# V1a (record plan V1): path-limited `git restore` — the selective rollback.
# Scratch repo in a temp dir: pre-existing USER uncommitted work in app.js,
# a failed AGENT edit in lib.js + an agent scratch file. Selective rollback
# must remove exactly the agent's changes, preserve the user's WIP, and the
# ORIGINAL failing check must reproduce afterwards (the known-green marker).
set -u
T=$(mktemp -d /tmp/vrun7a-XXXXXX)
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

# baseline: the exact failing check
if ./check.sh > base.out 2>&1; then echo "V1a-FAILED: baseline unexpectedly passes"; exit 1; fi
grep -q "ORIGINAL-ERROR" base.out || { echo "V1a-FAILED: unexpected baseline error"; exit 1; }

# USER pre-existing uncommitted work (unrelated file — must SURVIVE)
printf 'feature A\nuser WIP line\n' > app.js

# AGENT failed fix attempt: edits lib.js (does not remove BROKEN) + scratch file
printf 'function lib() { return "BROKEN"; }\n// agent attempted fix\n' > lib.js
printf 'agent scratch\n' > agent_scratch.js
if ./check.sh > during.out 2>&1; then echo "V1a-FAILED: broken edit unexpectedly fixes"; exit 1; fi

# SELECTIVE ROLLBACK: restore ONLY the touched path; remove own scratch file
git restore -- lib.js
rm -f agent_scratch.js

# CONFIRM the rollback: the ORIGINAL error must reproduce
if ./check.sh > after.out 2>&1; then
  echo "V1a-FAILED: check passes after rollback"
  exit 1
fi
grep -q "ORIGINAL-ERROR" after.out || { echo "V1a-FAILED: different error after rollback"; exit 1; }
echo "V1a confirm: original error reproduced after rollback (known-green marker)"

if grep -q 'user WIP line' app.js; then
  echo "V1a-user-wip-survived: YES"
else
  echo "V1a-user-wip-survived: NO"
  exit 1
fi
if grep -q 'agent attempted fix' lib.js; then
  echo "V1a-agent-edit-gone: NO"
  exit 1
else
  echo "V1a-agent-edit-gone: YES"
fi
echo "V1a-SELECTIVE-RESTORE-VERIFIED"
exit 0
