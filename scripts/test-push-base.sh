#!/usr/bin/env bash
# test-push-base.sh: proves scripts/push-base.sh picks the right base for a
# push, and proves this test is able to report a failure.
#
# Run locally:  bash scripts/test-push-base.sh
# Runs in CI as a step of .github/workflows/leak-check.yml.
#
# Why this file exists. push_base decides the range every scan in the pre-push
# gate measures. Get it wrong in the narrow direction and the gate scans
# nothing while printing that it found nothing, which is the same sentence.
# Get it wrong in the wide direction, which is what actually happened on
# 2026-09-15, and the gate refuses honest work over commits already merged on
# dev: a rebased head does not descend from the old remote tip, so the range
# old_tip..new_head silently became "the whole mainline this branch just
# caught up to", 103 commits instead of 1.
#
# So the cases below run against real throwaway repositories with a real
# remote, not against string fixtures. A rebase that is not really a rebase
# would not reproduce the bug, and a test that cannot reproduce the bug cannot
# show it is fixed. The last case deliberately runs the pre-fix logic so a real
# failure is visible rather than assumed.

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ ! -f "$HERE/push-base.sh" ]; then
  printf 'FAIL: scripts/push-base.sh is missing, so the base rule cannot be tested.\n' >&2
  exit 1
fi

# shellcheck source=scripts/push-base.sh
. "$HERE/push-base.sh"

if ! declare -f push_base >/dev/null 2>&1; then
  printf 'FAIL: scripts/push-base.sh was sourced but does not define push_base.\n' >&2
  exit 1
fi
if ! declare -f push_base_is_absent_sha >/dev/null 2>&1; then
  printf 'FAIL: scripts/push-base.sh was sourced but does not define push_base_is_absent_sha.\n' >&2
  exit 1
fi

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

ZEROS40="0000000000000000000000000000000000000000"
ZEROS64="0000000000000000000000000000000000000000000000000000000000000000"

# ---- push_base_is_absent_sha ----
# git writes an all-zeroes sha on pre-push stdin when the remote has no such
# ref yet. Length is not assumed anywhere, so a SHA-256 repository works too.
if push_base_is_absent_sha ""; then ok 'absent-sha: empty string is absent' yes yes
  else ok 'absent-sha: empty string is absent' yes no; fi
if push_base_is_absent_sha "$ZEROS40"; then ok 'absent-sha: 40 zeroes is absent' yes yes
  else ok 'absent-sha: 40 zeroes is absent' yes no; fi
if push_base_is_absent_sha "$ZEROS64"; then ok 'absent-sha: 64 zeroes is absent' yes yes
  else ok 'absent-sha: 64 zeroes is absent' yes no; fi
if push_base_is_absent_sha "0000000000000000000000000000000000000001"; then
  ok 'absent-sha: a real sha is NOT absent' no yes
  else ok 'absent-sha: a real sha is NOT absent' no no; fi

# ---- Fixture: a real remote with a real dev branch, and a real clone ----
TMP="$(mktemp -d)"
cleanup() { cd /; rm -rf "$TMP"; }
trap cleanup EXIT

git init --quiet --bare "$TMP/remote.git"

git init --quiet "$TMP/seed"
(
  cd "$TMP/seed"
  git config user.email seed@example.invalid
  git config user.name seed
  git checkout --quiet -b dev
  for n in 1 2 3; do
    printf 'dev line %s\n' "$n" >> dev.txt
    git add dev.txt
    git commit --quiet -m "dev commit $n"
  done
  git remote add origin "$TMP/remote.git"
  git push --quiet origin dev
) >/dev/null 2>&1

git clone --quiet "$TMP/remote.git" "$TMP/work" >/dev/null 2>&1
cd "$TMP/work"
git config user.email work@example.invalid
git config user.name work

DEV_OLD="$(git rev-parse origin/dev)"

# A feature branch off that dev tip, with two commits of its own. This is the
# branch as it was first pushed.
git checkout --quiet -b feature "$DEV_OLD"
for n in 1 2; do
  printf 'feature line %s\n' "$n" >> feature.txt
  git add feature.txt
  git commit --quiet -m "feature commit $n"
done
FEATURE_OLD_TIP="$(git rev-parse HEAD)"
git push --quiet origin feature >/dev/null 2>&1

# CASE: a brand new remote ref. git reports all zeroes, so the base is the
# mainline merge-base and the range is exactly the branch's own commits.
ok 'new remote ref falls back to the merge-base with origin/dev' \
  "$DEV_OLD" "$(push_base "$FEATURE_OLD_TIP" "$ZEROS40")"

# CASE: an ordinary incremental push. The remote tip IS an ancestor of the new
# head, so it is the precise base and must be preferred: using the mainline
# merge-base here would re-scan commits already pushed on this branch.
printf 'feature line 3\n' >> feature.txt
git add feature.txt
git commit --quiet -m "feature commit 3"
FEATURE_INCREMENTAL="$(git rev-parse HEAD)"
ok 'incremental push prefers the remote tip' \
  "$FEATURE_OLD_TIP" "$(push_base "$FEATURE_INCREMENTAL" "$FEATURE_OLD_TIP")"
ok 'incremental push measures only the new commit' \
  "1" "$(git rev-list --count "$(push_base "$FEATURE_INCREMENTAL" "$FEATURE_OLD_TIP")..$FEATURE_INCREMENTAL")"

# Now move dev on, the way a busy mainline does, and rebase the branch onto it.
# This is the shape that refused a real push: the old remote tip still exists
# in the object store, so the pre-fix rule kept using it, but the rebased head
# does not descend from it.
(
  cd "$TMP/seed"
  for n in 4 5 6 7; do
    printf 'dev line %s\n' "$n" >> dev.txt
    git add dev.txt
    git commit --quiet -m "dev commit $n"
  done
  git push --quiet origin dev
) >/dev/null 2>&1
git fetch --quiet origin >/dev/null 2>&1
DEV_NEW="$(git rev-parse origin/dev)"
git rebase --quiet origin/dev >/dev/null 2>&1
FEATURE_REBASED="$(git rev-parse HEAD)"

# Sanity on the fixture itself. A test that quietly failed to rebase would
# assert nothing, and would pass.
if git merge-base --is-ancestor "$FEATURE_OLD_TIP" "$FEATURE_REBASED" 2>/dev/null; then
  ok 'fixture: the rebased head does NOT descend from the old remote tip' \
    'not-ancestor' 'ancestor'
else
  ok 'fixture: the rebased head does NOT descend from the old remote tip' \
    'not-ancestor' 'not-ancestor'
fi
if git cat-file -e "${FEATURE_OLD_TIP}^{commit}" 2>/dev/null; then
  ok 'fixture: the old remote tip is still present locally' present present
else
  ok 'fixture: the old remote tip is still present locally' present absent
fi

# CASE: the fix. A force-push over rewritten history falls through to the
# merge-base, which after a rebase onto dev is the dev tip itself.
ok 'force-push after rebase falls back to the merge-base with origin/dev' \
  "$DEV_NEW" "$(push_base "$FEATURE_REBASED" "$FEATURE_OLD_TIP")"

# CASE: and the range that follows from it is the branch's own commits only.
# Three, not the mainline it just caught up to.
ok 'force-push after rebase measures only the rebased commits' \
  "3" "$(git rev-list --count "$(push_base "$FEATURE_REBASED" "$FEATURE_OLD_TIP")..$FEATURE_REBASED")"

# CASE: dev merged INTO the branch, rather than the branch rebased onto dev.
# The old remote tip stays an ancestor here, so preference 1 still applies and
# the range is the merge plus the mainline commits it brings in. That is not a
# bug: those commits genuinely are being added to this ref. The case is pinned
# so nobody "fixes" it into scanning less.
git checkout --quiet -B merged "$FEATURE_OLD_TIP" >/dev/null 2>&1
git merge --quiet --no-edit origin/dev >/dev/null 2>&1
MERGED_TIP="$(git rev-parse HEAD)"
ok 'dev merged in keeps the remote tip as the base' \
  "$FEATURE_OLD_TIP" "$(push_base "$MERGED_TIP" "$FEATURE_OLD_TIP")"

# CASE: a remote sha the local object store has never heard of, which is what a
# stale or pruned reflog looks like. Falls back rather than failing.
ok 'an unknown remote sha falls back to the merge-base' \
  "$DEV_NEW" "$(push_base "$FEATURE_REBASED" "0123456789012345678901234567890123456789")"

# CASE: an orphan with no shared history and no origin/main. Nothing to
# subtract, so nothing is printed and callers scan from the root.
git checkout --quiet --orphan lonely >/dev/null 2>&1
git rm --quiet -rf . >/dev/null 2>&1 || true
printf 'orphan\n' > orphan.txt
git add orphan.txt
git commit --quiet -m "orphan commit"
ORPHAN_TIP="$(git rev-parse HEAD)"
ok 'an orphan branch yields no base at all' \
  "" "$(push_base "$ORPHAN_TIP" "$ZEROS40")"

# ---- Red run: show a real failure is visible ----
# The pre-fix rule, verbatim apart from the ancestor test, against the rebase
# fixture. It must return the stale tip and a range far wider than the branch.
# If this case ever "passes" with the narrow answer, the test has stopped
# exercising anything and the cases above prove nothing.
push_base_prefix() {
  local sha="$1" remote="${2:-}"
  if ! push_base_is_absent_sha "$remote" && git cat-file -e "${remote}^{commit}" 2>/dev/null; then
    printf '%s' "$remote"
    return
  fi
  git merge-base "$sha" origin/dev 2>/dev/null || true
}
ok 'red run: the pre-fix rule returns the stale tip' \
  "$FEATURE_OLD_TIP" "$(push_base_prefix "$FEATURE_REBASED" "$FEATURE_OLD_TIP")"
PREFIX_RANGE_COUNT="$(git rev-list --count "$(push_base_prefix "$FEATURE_REBASED" "$FEATURE_OLD_TIP")..$FEATURE_REBASED")"
if [ "$PREFIX_RANGE_COUNT" -gt 3 ]; then
  ok 'red run: the pre-fix range is wider than the branch itself' wider wider
else
  ok 'red run: the pre-fix range is wider than the branch itself' \
    wider "not-wider ($PREFIX_RANGE_COUNT commits)"
fi

# How many cases this file must actually RUN.
#
# Deciding the exit status on the failure counter alone means a file truncated
# to nothing reports "0 passed, 0 failed", prints that the self test passed,
# and exits 0. That is the absence-reads-as-green shape every defect in this
# gate has had. Raising this number when a case is added is the point: it makes
# deleting a case a deliberate act instead of a silent one.
EXPECTED_CASES=16
TOTAL=$((PASSED + FAILED))

printf '\n%d passed, %d failed, %d ran of %d expected\n\n' \
  "$PASSED" "$FAILED" "$TOTAL" "$EXPECTED_CASES"

if [ "$TOTAL" -lt "$EXPECTED_CASES" ]; then
  printf 'push-base self test FAILED: only %d case(s) ran, %d were expected.\n' \
    "$TOTAL" "$EXPECTED_CASES"
  printf 'Cases have been removed, or this file did not run to the end.\n\n'
  exit 1
fi

if [ "$FAILED" -ne 0 ]; then
  printf 'push-base self test FAILED\n\n'
  exit 1
fi

printf 'push-base self test passed\n\n'
exit 0
