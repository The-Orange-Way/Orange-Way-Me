#!/usr/bin/env bash
#
# mark-pr-this-ran.sh: record that /pr-this has finished against current HEAD.
#
# Called as the LAST step of the /pr-this skill, after the gauntlet reports
# PASS. Writes the current HEAD SHA to .git/.pr-this-ran. The pre-push gate
# (scripts/pre-push-gate.sh) refuses to push if this marker is missing or
# doesn't match HEAD. That is how we know /pr-this was actually run on the
# code being shipped.
#
# Why a separate script: the marker lifecycle becomes a single, version-
# controlled file rather than a sentence in a skill prompt that drifts.
# When you change WHAT counts as "/pr-this is done" you change this script
# and the gate together, atomically.

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || {
  echo "✗ Not inside a git repo, refusing to write a marker." >&2
  exit 1
}

HEAD_SHA="$(git rev-parse HEAD 2>/dev/null)" || {
  echo "✗ Could not resolve HEAD, refusing to write a marker." >&2
  exit 1
}

if [ -n "$(git status --porcelain)" ]; then
  echo "✗ Working tree is dirty. Commit (or stash) before marking /pr-this as run."
  echo "  /pr-this's gauntlet is supposed to be run against the exact commits"
  echo "  you intend to push. A dirty tree means the marker would be a lie."
  exit 1
fi

# Resolve the per-worktree git dir. REPO_ROOT/.git is a regular FILE inside a
# linked worktree, so this redirect would fail with "Not a directory" and no
# marker would be written. --absolute-git-dir is per-worktree (not
# --git-common-dir, which is shared and would let one worktree authorise a
# push from another branch).
echo "$HEAD_SHA" > "$(git rev-parse --absolute-git-dir)/.pr-this-ran"
echo "✓ /pr-this marker recorded for HEAD $(echo "$HEAD_SHA" | head -c 8)."
echo "  Next git push is allowed (until the next commit / amend / rebase)."
