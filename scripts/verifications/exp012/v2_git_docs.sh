#!/usr/bin/env bash
# V2 (record plan, doc-based): inspect the ACTUAL documentation of the
# installed git (local man pages — authoritative for git 2.53.0 on this
# machine, no network needed) for the semantics of selective rollback:
#   git-restore(1): path-scoped working-tree restore + patch (hunk) mode
#   git-stash(1):   push with pathspec
set -u
ok=true

# man pages hard-wrap long sentences; normalize newlines/spacing before matching
R=$(man -P cat git-restore 2>/dev/null | tr -d '\010' | tr '\n' ' ' | tr -s ' ')
if [ -z "$R" ]; then
  echo "V2-DOC-UNAVAILABLE: git-restore man page not found on this machine"
  exit 1
fi
echo "DOC-SOURCE-1: man git-restore (local documentation of the installed git $(git --version | awk '{print $3}'))"
for needle in "git-restore - Restore working tree files" \
              "Restore specified paths in the working tree with some contents from a restore source" \
              "Interactively select hunks"; do
  if printf '%s' "$R" | grep -qF -- "$needle"; then
    echo "DOC-restore: FOUND: $needle"
  else
    echo "DOC-restore: MISSING: $needle"
    ok=false
  fi
done

S=$(man -P cat git-stash 2>/dev/null | tr -d '\010' | tr '\n' ' ' | tr -s ' ')
if [ -z "$S" ]; then
  echo "V2-DOC-UNAVAILABLE: git-stash man page not found on this machine"
  exit 1
fi
echo "DOC-SOURCE-2: man git-stash (local documentation of the installed git)"
for needle in "new stash entry" \
              "pathspec"; do
  if printf '%s' "$S" | grep -qF -- "$needle"; then
    echo "DOC-stash: FOUND: $needle"
  else
    echo "DOC-stash: MISSING: $needle"
    ok=false
  fi
done
# the stash push SYNOPSIS accepts pathspecs (path-limited stashing)
if printf '%s' "$S" | grep -E "stash push.*pathspec" | head -1 | grep -q .; then
  echo "DOC-stash-push-pathspec-synopsis: FOUND"
else
  echo "DOC-stash-push-pathspec-synopsis: MISSING"
  ok=false
fi

if [ "$ok" = true ]; then
  echo "V2-DOC-VERIFIED"
  exit 0
else
  echo "V2-DOC-NOT-VERIFIED"
  exit 1
fi
