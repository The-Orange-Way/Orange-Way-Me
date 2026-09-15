#!/usr/bin/env bash
# push-base.sh: works out the base commit a push should be measured against,
# so every scan in the pre-push gate sees only the commits the push adds.
#
# Sourced by scripts/pre-push-gate.sh. Kept as its own library, and not inline
# in the gate, for the same reason scripts/canon-terms.sh is: a rule the gate
# depends on has to be testable on its own. See scripts/test-push-base.sh.
#
# Defines: push_base <local_sha> [<remote_sha>]
#
# Preference order:
#   1. The remote ref's current tip (from pre-push stdin), when the remote
#      already has this branch AND that tip is an ancestor of what is being
#      pushed. That is the precise base of an incremental push; using the
#      mainline merge-base instead would re-scan the branch's own earlier
#      commits and could re-trip on a finding already pushed there.
#   2. The merge-base with origin/dev, then origin/main. This covers a new
#      remote ref, and it covers a force-push over rewritten history.
#   3. Nothing (orphan or initial commit): no shared history to subtract, so
#      callers scan from the root instead of excluding a base.
#
# WHY THE ANCESTOR TEST IS THERE, because it was missing and it refused real
# work. Preference 1 used to apply whenever the remote tip merely existed in
# the local object store. After a rebase it still exists, so the gate kept
# using it, but a rebased head does not descend from it. The range
# old_tip..new_head then stops meaning "what this push adds" and starts
# meaning "everything reachable from the new head that the old tip could not
# see", which is the whole of the mainline the branch just caught up to.
#
# Measured on 2026-09-15 rebasing sp-8/owm-t0092-connections-readback-sweep:
# the range expanded from 1 commit to 103, and the gate refused the push over
# three commits that were already merged on dev and had nothing to do with the
# branch. The identical thing happens when dev is MERGED into a branch rather
# than rebased onto, because those dev commits become reachable from the new
# head and not from the old remote tip either way. So before this test, no
# branch in this repo could catch up to dev and then push.
#
# The failure is loud, which is the only good thing about it: it names shas the
# author never touched. Treat "the gate is complaining about somebody else's
# commit" as this bug and not as a reason to reach for PR_THIS_BYPASS=1, which
# would also switch off the five checks that do apply to your own commit.

# True when a sha argument is absent or is git's all-zeroes placeholder for
# "the remote does not have this ref yet". Length is not assumed, so this holds
# for a SHA-256 repository as well as a SHA-1 one.
push_base_is_absent_sha() {
  local sha="${1:-}"
  [ -z "$sha" ] && return 0
  case "$sha" in
    *[!0]*) return 1 ;;
    *) return 0 ;;
  esac
}

push_base() {
  local sha="$1" remote="${2:-}"

  if ! push_base_is_absent_sha "$remote" \
    && git cat-file -e "${remote}^{commit}" 2>/dev/null \
    && git merge-base --is-ancestor "$remote" "$sha" 2>/dev/null; then
    printf '%s' "$remote"
    return
  fi

  git merge-base "$sha" origin/dev 2>/dev/null ||
    git merge-base "$sha" origin/main 2>/dev/null ||
    true
}
