#!/usr/bin/env bash
#
# pre-push-gate.sh — enforce that /pr-this ran before any push to a public branch.
#
# Wire as a git pre-push hook (see scripts/install-hooks.sh).
#
# What it checks (refuses the push if any FAIL):
#   1. /pr-this marker (`.git/.pr-this-ran`) is newer than HEAD on the branch
#      being pushed. If absent or stale, the push is refused.
#   2. The repo's pre-publish leak scanner (`scripts/pre-publish-scan.sh`)
#      reports clean.
#   3. No private-host / private-wiki URL leaks in the commits being pushed
#      (commit messages + diff).
#   4. No secret-shaped strings in the commits being pushed, per gitleaks. A
#      scanner that cannot be found REFUSES the push: an absent scan is not a
#      clean scan.
#   5. Every non-merge commit body ends with a Seat: <name> trailer.
#
# Override (escape hatch — emits a loud warning, do not use casually):
#   PR_THIS_BYPASS=1 git push
#
# Check 4 knobs:
#   GITLEAKS_BIN=/path/to/gitleaks  use a gitleaks that is not on PATH
#   GITLEAKS_OPTIONAL=1             push with NO secret scan, loud warning, no refusal
#
# Install on a fresh clone:
#   bash scripts/install-hooks.sh

set -euo pipefail

red()    { printf '\033[31m%s\033[0m\n' "$*"; }
yellow() { printf '\033[33m%s\033[0m\n' "$*"; }
green()  { printf '\033[32m%s\033[0m\n' "$*"; }

if [ "${PR_THIS_BYPASS:-}" = "1" ]; then
  yellow "⚠ pre-push gate BYPASSED via PR_THIS_BYPASS=1."
  yellow "  This emits a loud warning. Skipping the gate is for true emergencies only."
  yellow "  If this becomes a habit, fix the underlying gauntlet step instead."
  exit 0
fi

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

# Read pre-push args from stdin: <local-ref> <local-sha> <remote-ref> <remote-sha>
# We keep both sides. The local-sha is the tip being pushed; the remote-sha is
# what the remote already holds for that ref (all-zeros for a brand-new ref),
# which is the exact base of "what this push adds" for an incremental update.
ZERO_SHA="0000000000000000000000000000000000000000"
# git's canonical empty tree. Diffing a commit against it yields the commit's
# entire content as additions, which lets the reserved-term scan include an
# orphan root commit that a base..sha range would exclude.
EMPTY_TREE="$(git hash-object -t tree /dev/null)"
LOCAL_SHAS=()
REMOTE_SHAS=()
while read -r local_ref local_sha remote_ref remote_sha; do
  [ "$local_sha" = "$ZERO_SHA" ] && continue
  LOCAL_SHAS+=("$local_sha")
  REMOTE_SHAS+=("$remote_sha")
done

if [ ${#LOCAL_SHAS[@]} -eq 0 ]; then
  green "✓ Nothing to push (branch deletion or no commits)."
  exit 0
fi

FAIL=0

# ---- Check 1: /pr-this marker fresh ----
# --absolute-git-dir resolves the per-worktree git dir, where mark-pr-this-ran.sh
# writes the marker. "$REPO_ROOT/.git" would be a plain FILE inside a linked
# worktree, so the marker could never be found and every push from a worktree
# would be refused. Not --git-common-dir: that is shared across worktrees and
# would let one worktree's marker authorise a push from a different branch.
MARKER="$(git rev-parse --absolute-git-dir)/.pr-this-ran"
HEAD_SHA=$(git rev-parse HEAD)
if [ ! -f "$MARKER" ]; then
  red "✗ /pr-this has NEVER been recorded for this clone."
  red "  Invoke /pr-this via the Skill tool before pushing."
  FAIL=1
elif [ "$(cat "$MARKER")" != "$HEAD_SHA" ]; then
  red "✗ /pr-this marker is stale (recorded $(head -c 8 "$MARKER"), HEAD is $(echo "$HEAD_SHA" | head -c 8))."
  red "  Invoke /pr-this on the current HEAD before pushing."
  FAIL=1
else
  green "✓ /pr-this marker matches HEAD."
fi

# ---- Check 2: pre-publish leak scan ----
# Fail closed. A check that cannot run is not a check that passed, and with
# no else branch here a cleared executable bit made this check disappear:
# nothing ran, nothing printed, FAIL stayed untouched and the gate went on to
# report PASSED. Every other unrunnable-check path below now refuses with a
# reason; this was the one left answering "I could not check" with silence.
#
# The bit is tested and the scanner is then invoked with bash, which does not
# need it. That looks redundant and is deliberate: the post-merge
# identity-scan workflow tests the same bit and hard errors on it, so
# accepting a non-executable scanner here would pass a push the server
# refuses after the merge. Same rule in both places, same wording.
if [ -x "$REPO_ROOT/scripts/pre-publish-scan.sh" ]; then
  if bash "$REPO_ROOT/scripts/pre-publish-scan.sh" >/tmp/.pps.out 2>&1; then
    green "✓ pre-publish-scan clean."
  else
    red "✗ pre-publish-scan FAILED:"
    tail -20 /tmp/.pps.out
    FAIL=1
  fi
else
  red "✗ scripts/pre-publish-scan.sh is missing or not executable; the tree scan cannot run."
  red "  Restore the file, or run: chmod +x scripts/pre-publish-scan.sh"
  FAIL=1
fi

# ---- Shared helper: the base a push is measured against ----
# The base commit a push is measured against, so a scan sees only the commits
# this push adds and not history already on the remote. Prints the base sha, or
# nothing when the pushed tip shares no history with the remote (an orphan or
# the very first commit) -- callers scan from the root in that case instead of
# excluding a base. Both the reserved-term scan and the gitleaks scan use this
# so they cannot drift on what "the base" means.
#
# Preference order:
#   1. The remote ref's current tip (from pre-push stdin), when the remote
#      already has this branch. That is the precise base of an incremental
#      push; using the mainline merge-base instead would re-scan the branch's
#      own earlier commits and could re-trip on a finding already pushed there.
#   2. The merge-base with origin/dev, then origin/main, for a new remote ref.
#   3. Nothing (orphan / initial commit): no shared history to subtract.
push_base() {
  local sha="$1" remote="${2:-$ZERO_SHA}"
  if [ "$remote" != "$ZERO_SHA" ] && git cat-file -e "${remote}^{commit}" 2>/dev/null; then
    printf '%s' "$remote"
    return
  fi
  git merge-base "$sha" origin/dev 2>/dev/null ||
    git merge-base "$sha" origin/main 2>/dev/null ||
    true
}

# ---- Check 3: reserved-term leaks ----
# The reserved-term list is NOT hardcoded here: committing the list would
# publish the very strings it exists to keep out of the public tree. It is
# sourced at runtime from the OW_RESERVED_TERMS environment variable or a
# gitignored .reserved-terms file (one regex fragment per line; see
# .reserved-terms.example). The post-merge identity-scan workflow reads the
# same list from the repository secret.
#
# BOTH sources are canonicalized, and by the SAME code the leak scan and
# the post-merge identity scan use: scripts/canon-terms.sh. The environment
# value used to be taken raw here, which is not a small omission. grep -E
# treats each line of a multi-line pattern as a separate pattern, so a
# blank line in the value matched every input and refused every push, a
# comment line became a live fragment matching its own text, and a
# carriage return made every branch match nothing while the gate reported
# no reserved terms found.
CANON_TERMS_LIB="$REPO_ROOT/scripts/canon-terms.sh"
PRIVATE_PATTERN=""
# Set when a list WAS supplied and could not be turned into a usable
# pattern. That is a refusal with a reason already printed, not a skip, and
# the two must not print the same line.
RESERVED_UNUSABLE=0
if [ ! -f "$CANON_TERMS_LIB" ]; then
  # Fail closed. A check that cannot run is not a check that passed.
  red "✗ scripts/canon-terms.sh is missing; the reserved-term check cannot run."
  FAIL=1
else
  # shellcheck source=scripts/canon-terms.sh
  . "$CANON_TERMS_LIB"
  # Present is not the same as usable: a file that exists and fails to
  # source leaves its functions undefined. Ask for them.
  #
  # ALL THREE are named, not only the first. A partial source that defines
  # canon_terms and stops leaves canon_terms_usable undefined; bash returns
  # 127 for it, the "! canon_terms_usable" test below reads that as
  # unusable, and the push is refused with a line telling the developer to
  # fix a fragment in a list that is perfectly fine. Fail closed either
  # way, so this is the message and not a hole: it sends someone hunting a
  # typo in a value nobody can read back, for a fault in a script sitting
  # in front of them.
  if ! declare -f canon_terms >/dev/null 2>&1 \
    || ! declare -f canon_terms_usable >/dev/null 2>&1 \
    || ! declare -f canon_terms_reason_text >/dev/null 2>&1; then
    red "✗ scripts/canon-terms.sh was sourced but does not define all of canon_terms, canon_terms_usable and canon_terms_reason_text. The library is broken, not the reserved-term list, and the reserved-term check cannot run."
    FAIL=1
  else
    if [ -n "${OW_RESERVED_TERMS:-}" ]; then
      PRIVATE_PATTERN="$(printf '%s\n' "$OW_RESERVED_TERMS" | canon_terms)"
    fi
    if [ -z "$PRIVATE_PATTERN" ] && [ -f "$REPO_ROOT/.reserved-terms" ]; then
      PRIVATE_PATTERN="$(canon_terms < "$REPO_ROOT/.reserved-terms")"
    fi
    # A pattern this check cannot scan with fails in three different ways:
    # grep refuses it (one typo in a fragment, an unbalanced parenthesis
    # say, and grep exits 2 on every use below), it compiles and matches
    # the empty string so it hits every line of every file, or it is empty.
    # Both scans read all three as "no match" and the gate prints that no
    # reserved terms were found. Refuse instead, with the reason that
    # actually applies, and without printing any part of the list.
    if [ -n "$PRIVATE_PATTERN" ] && ! canon_terms_usable "$PRIVATE_PATTERN"; then
      red "✗ $(canon_terms_reason_text)"
      red "  Fix the offending fragment in OW_RESERVED_TERMS or .reserved-terms (one regex fragment per line)."
      red "  No part of the list is printed here."
      FAIL=1
      RESERVED_UNUSABLE=1
      PRIVATE_PATTERN=""
    fi
  fi
fi

if [ "$RESERVED_UNUSABLE" != "0" ]; then
  # Already refused above, with the reason. Do not also claim it was skipped.
  :
elif [ -z "$PRIVATE_PATTERN" ]; then
  # Says which of the two real causes this is. "Not configured" and
  # "configured, but every line is a comment or blank" look identical from
  # here and send a contributor looking in different places.
  yellow "– Reserved-term scan skipped: no usable terms found."
  yellow "  OW_RESERVED_TERMS and .reserved-terms are unset, or hold only comments and blank lines."
  yellow "  The server-side post-merge identity scan still enforces the list."
else
  # Scan commits being pushed: messages + diff
  for i in "${!LOCAL_SHAS[@]}"; do
    sha="${LOCAL_SHAS[$i]}"
    base="$(push_base "$sha" "${REMOTE_SHAS[$i]}")"
    if [ -n "$base" ]; then
      LOG_RANGE="$base..$sha"
      DIFF_ARGS=("$base..$sha")
    else
      # Orphan / initial commit: no shared history, so scan the whole thing,
      # root included. git log takes the bare sha (every reachable commit);
      # git diff needs two endpoints, so diff against the empty tree. A
      # base..sha range would exclude the root and let a reserved term in the
      # very first commit escape, the same way it did for gitleaks before.
      LOG_RANGE="$sha"
      DIFF_ARGS=("$EMPTY_TREE" "$sha")
    fi
    # Commit messages. The Claude co-author trailer with the
    # noreply@anthropic.com email is filtered out first: that email is
    # Anthropic's public GitHub integration address and the model name is a
    # public identifier, so the line carries no Orange Way internal string.
    # GitHub injects it on squash/rebase merges, so it cannot be prevented at
    # commit time. This mirrors the server post-merge identity scan so the two
    # cannot drift. Only this exact trailer line is dropped.
    COAUTHOR_EXEMPT='^[[:space:]]*Co-authored-by:[[:space:]]*Claude[[:space:]]+[A-Za-z]+[[:space:]]+[0-9.]+[[:space:]]*<noreply@anthropic\.com>[[:space:]]*$'
    if git log --format='%H%n%s%n%b' "$LOG_RANGE" 2>/dev/null | grep -viE "$COAUTHOR_EXEMPT" | grep -nEi "$PRIVATE_PATTERN" >/dev/null; then
      red "✗ Reserved-term leak in commit messages:"
      git log --format='%H%n%s%n%b' "$LOG_RANGE" | grep -viE "$COAUTHOR_EXEMPT" | grep -nEi --color=always "$PRIVATE_PATTERN"
      FAIL=1
    fi
    # Diff content: ADDED lines only. Deletions are how leaks get removed;
    # blocking a push because its diff deletes a reserved term would make
    # cleanups impossible.
    if git diff "${DIFF_ARGS[@]}" 2>/dev/null | grep -E '^\+' | grep -nEi "$PRIVATE_PATTERN" >/dev/null; then
      red "✗ Reserved-term leak in added diff lines:"
      git diff "${DIFF_ARGS[@]}" | grep -E '^\+' | grep -nEi --color=always "$PRIVATE_PATTERN" | head -20
      FAIL=1
    fi
  done
  # Not a short-circuit AND: under set -e, an AND-list whose final status is
  # non-zero ends the script. So when a leak WAS found this line used to be
  # the last thing that ran, and the gitleaks check, the Seat trailer check
  # and the PUSH REFUSED summary were all skipped.
  if [ "$FAIL" = "0" ]; then
    green "✓ No reserved terms in commits being pushed."
  fi
fi

# ---- Check 4: gitleaks on the prepared commits (REQUIRED) ----
# Scans only what this push adds, using the same base as check 3. Passing a
# bare sha to --log-opts scanned every commit reachable from HEAD, so any
# finding anywhere in history refused every push from every branch, no matter
# what the push contained. Re-reporting a commit that is already on the remote
# cannot prevent anything: if it is a real leak it is public already and needs
# rotation, not a blocked push. Only the first sha was scanned, too, so a
# multi-branch push checked one branch and waved the rest through.
#
# Finding the binary is a separate problem from running it. `command -v
# gitleaks` answers "is gitleaks on THIS shell's PATH", which is not the same
# question as "is a secret scanner available on this machine". A git hook runs
# with a non-login PATH, and gitleaks lives under ~/.local/bin on our push
# hosts, so the old probe answered "missing" where the scanner is present and
# working, and the fail-open branch below became permanent: nothing was ever
# scanned. Resolve the binary explicitly instead, then fail closed.
GITLEAKS_BIN="${GITLEAKS_BIN:-}"
if [ -z "$GITLEAKS_BIN" ]; then
  if command -v gitleaks >/dev/null 2>&1; then
    GITLEAKS_BIN="$(command -v gitleaks)"
  else
    for candidate in \
      "${HOME:-}/.local/bin/gitleaks" \
      /usr/local/bin/gitleaks \
      /opt/homebrew/bin/gitleaks \
      /usr/bin/gitleaks \
      /snap/bin/gitleaks; do
      if [ -x "$candidate" ]; then GITLEAKS_BIN="$candidate"; break; fi
    done
  fi
fi
# On disk is not the same as runnable: a wrong-architecture or truncated binary
# resolves fine and then fails on exec. Prove it runs before trusting it, and
# treat a binary that will not run exactly like one that is not there.
GITLEAKS_VERSION=""
if [ -n "$GITLEAKS_BIN" ]; then
  if ! GITLEAKS_VERSION="$("$GITLEAKS_BIN" version 2>&1 | head -1)"; then
    yellow "- $GITLEAKS_BIN is present but did not run: $GITLEAKS_VERSION"
    GITLEAKS_BIN=""
  fi
fi

if [ -n "$GITLEAKS_BIN" ]; then
  green "✓ gitleaks: $GITLEAKS_BIN (${GITLEAKS_VERSION:-version unknown})"
  CFG=""
  [ -f .gitleaks.toml ] && CFG="--config .gitleaks.toml"
  GITLEAKS_FAIL=0
  for i in "${!LOCAL_SHAS[@]}"; do
    sha="${LOCAL_SHAS[$i]}"
    base="$(push_base "$sha" "${REMOTE_SHAS[$i]}")"
    # With a base, scan base..sha. Orphan / initial commit has no base: scan
    # the bare sha, which for --log-opts means every commit reachable from it
    # (root included). That is exactly this push's new commits when nothing is
    # shared with the remote, and it keeps the root from slipping through the
    # way base..sha would by excluding it.
    if [ -n "$base" ]; then LOGOPTS="$base..$sha"; else LOGOPTS="$sha"; fi
    # shellcheck disable=SC2086 # CFG is a deliberate two-word flag or empty.
    if ! "$GITLEAKS_BIN" detect $CFG --no-banner --log-opts="$LOGOPTS" >/tmp/.gl.out 2>&1; then
      red "✗ gitleaks found secrets in $LOGOPTS:"
      tail -10 /tmp/.gl.out
      GITLEAKS_FAIL=1
    fi
  done
  if [ "$GITLEAKS_FAIL" = "0" ]; then
    green "✓ gitleaks clean."
  else
    FAIL=1
  fi
elif [ "${GITLEAKS_OPTIONAL:-}" = "1" ]; then
  # The escape hatch, taken deliberately. Loud, and it does not pretend the
  # commits were scanned.
  yellow "⚠ GITLEAKS_OPTIONAL=1: NO secret scan ran on the commits being pushed."
  yellow "  Nothing here looked for API keys, tokens or private keys. You own that."
else
  # An absent scanner is not a clean scan, so this refuses. Unlike the old
  # warning, the refusal is now meaningful: the probe above looks past PATH,
  # so "not found" means not installed rather than not exported.
  red "✗ gitleaks not found: NO secret scan can run on the commits being pushed."
  red "  The other checks look for reserved terms and seat trailers. None of them"
  red "  looks for secret-shaped strings such as API keys, tokens or private keys."
  red "  Install it: https://github.com/gitleaks/gitleaks"
  red "  Already installed somewhere odd? GITLEAKS_BIN=/path/to/gitleaks git push"
  red "  Push anyway, with nothing scanning for secrets? GITLEAKS_OPTIONAL=1 git push"
  FAIL=1
fi

# ---- Check 5: Seat trailer on every pushed non-merge commit ----
# Every non-merge commit body's last non-empty line must name the seat that
# authored it: "Seat: <seat-name>", matching ^Seat: [a-z0-9-]+$. This keeps
# public authorship legible without publishing anything internal (a seat name
# is a role, not a secret). A missing or malformed trailer refuses the push.
# Same push_base as the scans above, so it measures only the commits this push
# adds. Merge commits are skipped, exactly as the CI seat-line-check job does,
# so local and server enforcement cannot drift.
SEAT_PATTERN='^Seat: [a-z0-9-]+$'
# GitHub injects a Claude co-author trailer on squash/rebase merges; that is a
# public identifier, not a seat, so it is dropped before the last-line check,
# mirroring the reserved-term scan's exemption so the two cannot drift.
SEAT_COAUTHOR_EXEMPT='^[[:space:]]*Co-authored-by:.*<noreply@anthropic\.com>[[:space:]]*$'
SEAT_FAIL=0
for i in "${!LOCAL_SHAS[@]}"; do
  sha="${LOCAL_SHAS[$i]}"
  base="$(push_base "$sha" "${REMOTE_SHAS[$i]}")"
  if [ -n "$base" ]; then RANGE="$base..$sha"; else RANGE="$sha"; fi
  while read -r commit; do
    [ -z "$commit" ] && continue
    # Skip merge commits (2+ parents), mirroring the CI seat-line-check job:
    # merges are automation, not seat work.
    PARENTS=$(git cat-file -p "$commit" | grep -c '^parent ' || true)
    if [ "$PARENTS" -ge 2 ]; then
      continue
    fi
    last_line="$(git log -1 --format='%B' "$commit" \
      | grep -viE "$SEAT_COAUTHOR_EXEMPT" \
      | grep -vE '^[[:space:]]*$' | tail -1 || true)"
    if ! printf '%s\n' "$last_line" | grep -qE "$SEAT_PATTERN"; then
      red "✗ Commit ${commit:0:8} lacks a valid Seat: trailer as its last body line."
      red "  End the commit body with 'Seat: <your-seat>' (matches ^Seat: [a-z0-9-]+\$)."
      FAIL=1
      SEAT_FAIL=1
    fi
  done < <(git rev-list "$RANGE" 2>/dev/null)
done
if [ "$SEAT_FAIL" = "0" ]; then
  green "✓ Every pushed non-merge commit carries a Seat: trailer."
fi

if [ "$FAIL" != "0" ]; then
  red ""
  red "PUSH REFUSED. Fix the issues above, run /pr-this again, then retry."
  red "Emergency override (loud warning): PR_THIS_BYPASS=1 git push"
  exit 1
fi

green ""
green "/pr-this pre-push gate PASSED — pushing."
exit 0
