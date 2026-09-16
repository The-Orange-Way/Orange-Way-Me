#!/usr/bin/env bash
# test-pre-push-gate-check4.sh: proves check 4 (commit author/committer
# identity) does not false-positive on GitHub's own merge-commit committer
# identity when a branch forward-merges dev, and proves this test can still
# see a real failure.
#
# Run locally:  bash scripts/test-pre-push-gate-check4.sh
# Runs in CI as a step of .github/workflows/leak-check.yml.
#
# Why this exists. OWM-T0413 hit PUSH REFUSED on a branch that had done
# nothing wrong: it forward-merged origin/dev (`git merge`, not a rebase),
# and on 2026-09-16 dev carried real merge commits whose COMMITTER identity
# is GitHub's own automation (`noreply@github.com`, set server-side by the
# "Merge pull request" button/API), not a contributor's noreply address.
# push_base correctly returns the old remote tip as the base for a forward
# merge -- it genuinely is an ancestor -- but that means old_tip..new_head
# still contains every merge commit dev picked up in the meantime, all of
# them already public. Check 4's identity scan had no exemption for merge
# commits, so it re-flagged them as if they were new, non-noreply identities
# leaking through THIS push. Check 6 (Seat trailer) already exempts merge
# commits for the identical reason (merges are automation, not seat work);
# this fix brings check 4 in line with that precedent rather than inventing
# a new one.
#
# This builds a real throwaway repo and a real bare remote and drives the
# actual scripts/pre-push-gate.sh end to end, the same discipline as
# scripts/test-push-base.sh and scripts/test-leak-scan-red.sh: a string
# simulation cannot reproduce a real merge commit's identity fields, and a
# test that cannot reproduce the bug cannot show it is fixed.

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GATE="$HERE/pre-push-gate.sh"
PUBLISH_SCAN="$HERE/pre-publish-scan.sh"
PUSH_BASE="$HERE/push-base.sh"
CANON="$HERE/canon-terms.sh"

for required in "$GATE" "$PUBLISH_SCAN" "$PUSH_BASE" "$CANON"; do
  if [ ! -f "$required" ]; then
    printf 'FAIL: %s is missing, so the gate cannot be exercised.\n' "$required" >&2
    exit 1
  fi
done

PASSED=0
FAILED=0
ok() {
  local label="$1" expected="$2" actual="$3"
  if [ "$expected" = "$actual" ]; then
    PASSED=$((PASSED + 1))
    printf 'pass: %s\n' "$label"
  else
    FAILED=$((FAILED + 1))
    printf 'FAIL: %s\n  expected: %s\n  actual:   %s\n' "$label" "$expected" "$actual"
  fi
}

WORK="$(mktemp -d)"
if [ -z "$WORK" ] || [ ! -d "$WORK" ]; then
  printf 'FAIL: could not create a temporary directory, so the fixture cannot be built.\n' >&2
  exit 1
fi
trap 'rm -rf "$WORK"' EXIT

# A throwaway repo carrying its own copy of the gate and its dependencies.
# pre-push-gate.sh resolves REPO_ROOT from `git rev-parse --show-toplevel`,
# so the copy is what points it at the fixture instead of at this repo.
REPO="$WORK/repo"
mkdir -p "$REPO/scripts"
git init --quiet "$REPO"
cp "$GATE" "$REPO/scripts/pre-push-gate.sh"
cp "$PUBLISH_SCAN" "$REPO/scripts/pre-publish-scan.sh"
cp "$PUSH_BASE" "$REPO/scripts/push-base.sh"
cp "$CANON" "$REPO/scripts/canon-terms.sh"
chmod +x "$REPO/scripts/pre-push-gate.sh" "$REPO/scripts/pre-publish-scan.sh"

# A second copy of the gate with the fix reverted, to prove a real failure
# is still visible (the "red run" discipline test-push-base.sh also uses).
PREFIX_GATE="$WORK/pre-push-gate-prefix.sh"
sed 's/git log --no-merges "\$IDENT_RANGE" --format=/git log "$IDENT_RANGE" --format=/' \
  "$GATE" > "$PREFIX_GATE"
if diff -q "$GATE" "$PREFIX_GATE" >/dev/null 2>&1; then
  printf 'FAIL: the pre-fix reconstruction is byte-identical to the shipped gate.\n' >&2
  printf '  The --no-merges flag this test targets is not where expected; the sed did not match.\n' >&2
  exit 1
fi

REMOTE="$WORK/remote.git"
git init --quiet --bare "$REMOTE"

(
  cd "$REPO"
  git config user.email 'seed+seed@users.noreply.github.com'
  git config user.name seed
  git remote add origin "$REMOTE"
  git checkout --quiet -b dev

  printf 'dev line 1\n' > dev.txt
  git add dev.txt
  git commit --quiet -m "$(printf 'dev commit 1\n\nSeat: developer-owm')"
  git push --quiet origin dev
) >/dev/null 2>&1

DEV_OLD="$(cd "$REPO" && git rev-parse dev)"

# A branch that lands on dev the way a real PR merge does: authored by a
# contributor (valid noreply), committed by GitHub's own automation
# identity (noreply@github.com -- does NOT match @users.noreply.github.com).
(
  cd "$REPO"
  git checkout --quiet -b other-feature dev
  printf 'other line\n' > other.txt
  git add other.txt
  git commit --quiet -m "$(printf 'other feature commit\n\nSeat: developer-owm')"
  git checkout --quiet dev
  GIT_AUTHOR_NAME=admin GIT_AUTHOR_EMAIL='184854173+admin@users.noreply.github.com' \
  GIT_COMMITTER_NAME=GitHub GIT_COMMITTER_EMAIL='noreply@github.com' \
    git merge --no-ff --quiet -m 'Merge pull request #1 from other-feature' other-feature
  git push --quiet origin dev
) >/dev/null 2>&1

# A feature branch cut BEFORE that merge landed, exactly like OWM-T0413's
# branch predating the dev merges it later needed to catch up on.
(
  cd "$REPO"
  git checkout --quiet -b feature "$DEV_OLD"
  printf 'feature line 1\n' > feature.txt
  git add feature.txt
  git commit --quiet -m "$(printf 'feature commit 1\n\nSeat: developer-owm')"
  git push --quiet origin feature
) >/dev/null 2>&1
FEATURE_OLD_TIP="$(cd "$REPO" && git rev-parse feature)"

# Catch up with a forward merge (NOT a rebase) -- this is the exact shape
# check 4 mishandled: the old remote tip really is an ancestor of the new
# head, so push_base correctly prefers it, and the bot-committed merge
# commit from dev becomes reachable in the range for the first time.
(
  cd "$REPO"
  git fetch --quiet origin dev
  git merge --quiet origin/dev --no-edit
) >/dev/null 2>&1
FEATURE_NEW_TIP="$(cd "$REPO" && git rev-parse feature)"

run_gate() {
  # $1 = gate script to run, $2 = local sha, $3 = remote sha
  (
    cd "$REPO"
    git checkout --quiet feature
    printf '%s' "$2" > "$(git rev-parse --absolute-git-dir)/.pr-this-ran"
    printf 'refs/heads/feature %s refs/heads/feature %s\n' "$2" "$3" | bash "$1"
  )
}

# ---- CASE: post-fix, forward-merge from dev passes ----
POST_OUT="$(run_gate "$REPO/scripts/pre-push-gate.sh" "$FEATURE_NEW_TIP" "$FEATURE_OLD_TIP" 2>&1)"
POST_STATUS=$?
ok 'post-fix: forward-merge from dev passes the gate' '0' "$POST_STATUS"
if printf '%s' "$POST_OUT" | grep -q 'Commit author or committer email is not a GitHub noreply'; then
  ok 'post-fix: no false identity flag on the bot-committed merge' 'no-flag' 'flagged'
else
  ok 'post-fix: no false identity flag on the bot-committed merge' 'no-flag' 'no-flag'
fi

# ---- RED RUN: same fixture, pre-fix gate, must fail on the same commit ----
RED_OUT="$(run_gate "$PREFIX_GATE" "$FEATURE_NEW_TIP" "$FEATURE_OLD_TIP" 2>&1)"
RED_STATUS=$?
if [ "$RED_STATUS" -ne 0 ]; then
  ok 'red run: pre-fix gate refuses the same forward merge' 'nonzero' 'nonzero'
else
  ok 'red run: pre-fix gate refuses the same forward merge' 'nonzero' '0'
fi
if printf '%s' "$RED_OUT" | grep -q 'Commit author or committer email is not a GitHub noreply'; then
  ok 'red run: refusal names the identity check' 'named' 'named'
else
  ok 'red run: refusal names the identity check' 'named' 'not-found'
fi

# ---- CONTROL: a genuine bad identity on a NON-merge commit is still caught
# with the fix applied. --no-merges must narrow the exemption to merges
# only, not weaken the check itself. ----
(
  cd "$REPO"
  git checkout --quiet -b leaky "$DEV_OLD"
  GIT_AUTHOR_NAME=dev GIT_AUTHOR_EMAIL='dev@internal.example.invalid' \
  GIT_COMMITTER_NAME=dev GIT_COMMITTER_EMAIL='dev@internal.example.invalid' \
    git commit --quiet --allow-empty -m "$(printf 'leaky commit\n\nSeat: developer-owm')"
  git push --quiet origin leaky
) >/dev/null 2>&1
LEAKY_TIP="$(cd "$REPO" && git rev-parse leaky)"
(
  cd "$REPO"
  git checkout --quiet leaky
  printf '%s' "$LEAKY_TIP" > "$(git rev-parse --absolute-git-dir)/.pr-this-ran"
)
LEAKY_OUT="$(cd "$REPO" && printf 'refs/heads/leaky %s refs/heads/leaky %s\n' "$LEAKY_TIP" "$DEV_OLD" \
  | bash "$REPO/scripts/pre-push-gate.sh" 2>&1)"
LEAKY_STATUS=$?
if [ "$LEAKY_STATUS" -ne 0 ]; then
  ok 'control: a real non-noreply identity is still refused' 'nonzero' 'nonzero'
else
  ok 'control: a real non-noreply identity is still refused' 'nonzero' '0'
fi
if printf '%s' "$LEAKY_OUT" | grep -q 'Commit author or committer email is not a GitHub noreply'; then
  ok 'control: refusal names the identity check' 'named' 'named'
else
  ok 'control: refusal names the identity check' 'named' 'not-found'
fi

EXPECTED_CASES=6
TOTAL=$((PASSED + FAILED))

printf '\n%d passed, %d failed, %d ran of %d expected\n\n' \
  "$PASSED" "$FAILED" "$TOTAL" "$EXPECTED_CASES"

if [ "$TOTAL" -lt "$EXPECTED_CASES" ]; then
  printf 'pre-push-gate check4 self test FAILED: only %d case(s) ran, %d were expected.\n' \
    "$TOTAL" "$EXPECTED_CASES"
  exit 1
fi

if [ "$FAILED" -ne 0 ]; then
  printf 'pre-push-gate check4 self test FAILED\n\n'
  exit 1
fi

printf 'pre-push-gate check4 self test passed\n\n'
exit 0
