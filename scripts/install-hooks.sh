#!/usr/bin/env bash
#
# install-hooks.sh: wire the /pr-this enforcement hooks into this clone.
#
# Run once per fresh clone. The hooks themselves are version-controlled
# under scripts/, so CI + every contributor sees the same gates.
#
# What this installs:
#   - .git/hooks/pre-push       → execs scripts/pre-push-gate.sh
#   - .git/hooks/post-commit    → invalidates .git/.pr-this-ran on any commit
#   - .git/hooks/post-rewrite   → same invalidation on amend / rebase
#
# Idempotent. Re-running is safe.

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

chmod +x scripts/pre-push-gate.sh scripts/mark-pr-this-ran.sh 2>/dev/null || true

# pre-push: refuse the push unless /pr-this has been run + leak scan + private-URL + gitleaks
cat > .git/hooks/pre-push <<'EOF'
#!/usr/bin/env bash
exec "$(git rev-parse --show-toplevel)/scripts/pre-push-gate.sh" "$@"
EOF
chmod +x .git/hooks/pre-push

# post-commit: invalidate the /pr-this marker on every commit
# (a new commit changes HEAD, so the previous /pr-this run no longer covers the tree)
cat > .git/hooks/post-commit <<'EOF'
#!/usr/bin/env bash
# --absolute-git-dir gives the per-worktree git dir, where the marker lives.
# "$(git rev-parse --show-toplevel)/.git" is a plain FILE inside a worktree,
# so the old path could never reach the marker to invalidate it there.
MARK="$(git rev-parse --absolute-git-dir)/.pr-this-ran"
if [ -f "$MARK" ]; then
  rm -f "$MARK"
  echo "ℹ /pr-this marker invalidated (commit changed HEAD)."
  echo "  Run /pr-this again before next push."
fi
EOF
chmod +x .git/hooks/post-commit

# post-rewrite: amend, rebase, etc. (same logic)
cat > .git/hooks/post-rewrite <<'EOF'
#!/usr/bin/env bash
# --absolute-git-dir gives the per-worktree git dir, where the marker lives.
# "$(git rev-parse --show-toplevel)/.git" is a plain FILE inside a worktree,
# so the old path could never reach the marker to invalidate it there.
MARK="$(git rev-parse --absolute-git-dir)/.pr-this-ran"
if [ -f "$MARK" ]; then
  rm -f "$MARK"
  echo "ℹ /pr-this marker invalidated (HEAD was rewritten: $1)."
  echo "  Run /pr-this again before next push."
fi
EOF
chmod +x .git/hooks/post-rewrite

echo "✓ Installed git hooks:"
echo "    pre-push      → scripts/pre-push-gate.sh"
echo "    post-commit   → invalidate .pr-this-ran on new commits"
echo "    post-rewrite  → invalidate .pr-this-ran on amend / rebase"
echo
echo "Next push will refuse unless /pr-this has been recorded against HEAD."
echo "Emergency override (loud warning): PR_THIS_BYPASS=1 git push"
