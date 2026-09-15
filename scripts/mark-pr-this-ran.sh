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

# File-scoped dirty check: refuse only when files THIS agent is pushing are dirty.
# A shared checkout may have another agent's uncommitted edits to unrelated paths;
# those must not block marking /pr-this as run on this agent's own clean work.
# "This agent's files" = paths between HEAD and the merge-base with origin/dev.
# CTO decision 2026-08-23: safety checks must validate only the files the pushing
# agent changed and never require a clean tree for paths it does not own.
MERGE_BASE="$(git merge-base HEAD origin/dev 2>/dev/null \
  || git merge-base HEAD origin/main 2>/dev/null \
  || echo "")"
if [ -n "$MERGE_BASE" ]; then
  AGENT_FILES="$(git diff --name-only "$MERGE_BASE" HEAD 2>/dev/null || true)"
else
  AGENT_FILES="$(git diff --name-only HEAD~ HEAD 2>/dev/null || true)"
fi
DIRTY_STATUS="$(git status --porcelain 2>/dev/null || true)"
if [ -n "$DIRTY_STATUS" ]; then
  DIRTY_FILES="$(printf '%s\n' "$DIRTY_STATUS" | awk '{print $NF}' | sort -u)"
  if [ -n "$AGENT_FILES" ]; then
    OVERLAP="$(comm -12 <(printf '%s\n' "$AGENT_FILES" | sort -u) \
                        <(printf '%s\n' "$DIRTY_FILES") || true)"
  else
    # No agent-owned files identified -- refuse on any dirty tree (safe default).
    OVERLAP="$DIRTY_FILES"
  fi
  if [ -n "$OVERLAP" ]; then
    echo "✗ Working tree is dirty on paths this agent is pushing. Commit (or stash) before marking /pr-this as run." >&2
    echo "  /pr-this's gauntlet must certify the exact code being pushed." >&2
    echo "  Dirty paths in this agent's diff:" >&2
    printf '%s\n' "$OVERLAP" | sed 's/^/    /' >&2
    exit 1
  fi
  # Tree has dirty files outside this agent's diff -- shared-checkout scenario, allowed.
fi

# Resolve the per-worktree git dir. REPO_ROOT/.git is a regular FILE inside a
# linked worktree, so this redirect would fail with "Not a directory" and no
# marker would be written. --absolute-git-dir is per-worktree (not
# --git-common-dir, which is shared and would let one worktree authorise a
# push from another branch).
echo "$HEAD_SHA" > "$(git rev-parse --absolute-git-dir)/.pr-this-ran"
echo "✓ /pr-this marker recorded for HEAD $(echo "$HEAD_SHA" | head -c 8)."
echo "  Next git push is allowed (until the next commit / amend / rebase)."
