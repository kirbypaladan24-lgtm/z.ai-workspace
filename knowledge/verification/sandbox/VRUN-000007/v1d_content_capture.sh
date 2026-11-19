#!/usr/bin/env bash
# V1d (record plan V1, mixed-file case): user WIP and the agent edit share
# ONE file. File-level restore would destroy the user's hunk, so the record
# prescribes capturing the pre-edit content BEFORE the first edit and
# re-applying it on failure. Verify: user hunk survives, agent hunk gone.
set -u
T=$(mktemp -d /tmp/vrun7d-XXXXXX)
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

# USER pre-existing uncommitted work in app.js
printf 'feature A\nuser WIP line\n' > app.js

# THE RECORD'S RULE: capture the pre-edit content of ONLY the file(s) you are
# about to touch — BEFORE the first edit
cp app.js app.js.pre-edit

# AGENT edits the SAME file (adds its attempted fix below the user's WIP)
printf 'feature A\nuser WIP line\n// agent attempted fix\n' > app.js
if ./check.sh > during.out 2>&1; then echo "V1d-FAILED: edit unexpectedly fixes"; exit 1; fi

# ROLLBACK by re-applying the captured pre-edit content
cp app.js.pre-edit app.js
rm -f app.js.pre-edit

if ./check.sh > after.out 2>&1; then echo "V1d-FAILED: check passes after rollback"; exit 1; fi
grep -q "ORIGINAL-ERROR" after.out || { echo "V1d-FAILED: different error after rollback"; exit 1; }
echo "V1d confirm: original error reproduced after content-capture rollback"

if grep -q 'user WIP line' app.js; then
  echo "V1d-user-hunk-survived: YES"
else
  echo "V1d-user-hunk-survived: NO"
  exit 1
fi
if grep -q 'agent attempted fix' app.js; then
  echo "V1d-agent-hunk-gone: NO"
  exit 1
else
  echo "V1d-agent-hunk-gone: YES"
fi
# the working tree now contains exactly the user's WIP modification
if git diff --quiet; then
  echo "V1d-FAILED: working tree is clean (user WIP lost!)"
  exit 1
fi
echo "V1d working tree: back to exactly the user's uncommitted WIP (git diff non-empty, no agent content)"
echo "V1d-CONTENT-CAPTURE-ROLLBACK-VERIFIED"
exit 0
