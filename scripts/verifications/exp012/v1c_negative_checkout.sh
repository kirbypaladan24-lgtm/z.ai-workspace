#!/usr/bin/env bash
# V1c (record plan V1, negative control): the BANNED repo-wide rollback.
# `git checkout -- .` reverts EVERYTHING — the user's pre-existing
# uncommitted work is destroyed along with the agent's edit. This is the
# demonstration of WHY the record bans blanket restores.
set -u
T=$(mktemp -d /tmp/vrun7c-XXXXXX)
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

# USER pre-existing uncommitted work
printf 'feature A\nuser WIP line\n' > app.js
# AGENT failed fix attempt
printf 'function lib() { return "BROKEN"; }\n// agent attempted fix\n' > lib.js

# THE BANNED COMMAND: repo-wide blanket restore
git checkout -- .

if grep -q 'user WIP line' app.js; then
  echo "V1c-FAILED: user work unexpectedly survived a repo-wide checkout"
  exit 1
else
  echo "V1c-user-wip-after-banned-command: DESTROYED (user work lost)"
fi
if grep -q 'agent attempted fix' lib.js; then
  echo "V1c-FAILED: agent edit unexpectedly survived"
  exit 1
else
  echo "V1c-agent-edit-after-banned-command: gone"
fi
echo "V1c conclusion: the repo-wide rollback destroyed the USER's unrelated uncommitted work — the reason the record bans it"
echo "V1c-BLANKET-RESTORE-DAMAGE-CONFIRMED"
exit 0
