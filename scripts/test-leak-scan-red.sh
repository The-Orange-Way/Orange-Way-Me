#!/usr/bin/env bash
# test-leak-scan-red.sh: proves scripts/pre-publish-scan.sh can still FAIL.
#
# Run locally:  bash scripts/test-leak-scan-red.sh
# Runs in CI as a step of .github/workflows/leak-check.yml.
#
# Why this exists. The reserved-term category prints file and line only when
# it runs in CI, because a job log on a public repository is public and those
# matches are internal strings by definition. Withholding output is the
# easiest possible way to turn a working scanner into a silent one, and a
# silent scanner produces output indistinguishable from a clean tree. Every
# defect this gate has had has been an absence that read as green: a term
# list that resolved to nothing, an exemption that swallowed a whole file, a
# pattern that compiled and matched nowhere. So a green leak check is not
# evidence that the leak check works. A run that goes RED on a planted match,
# and green once the plant is removed, is.
#
# What it does. It builds a throwaway tree in a temporary directory holding a
# copy of the scanner, a copy of the canonicalizer, one ordinary source file
# and one file carrying an invented term, then runs the real scanner against
# that tree. The scanner resolves its own repository root from the location
# of the script file, so the copy is what points it at the fixture instead of
# at this repository.
#
# This harness never reads the real reserved-term list and never scans the
# real tree. It supplies its own invented list, so nothing internal can reach
# the log even when a case fails and the output is printed.
#
# Every fixture term here is invented (zz prefix).

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCAN="$HERE/pre-publish-scan.sh"
CANON="$HERE/canon-terms.sh"

for required in "$SCAN" "$CANON"; do
  if [ ! -f "$required" ]; then
    printf 'FAIL: %s is missing, so the leak scan cannot be exercised.\n' \
      "$required" >&2
    exit 1
  fi
done

# Invented. Present in no real list and in no real file.
TERM='zzleaktoken'
TERM_OTHER_CASE='ZZLEAKTOKEN'

PASSED=0
FAILED=0

WORK="$(mktemp -d)"
if [ -z "$WORK" ] || [ ! -d "$WORK" ]; then
  printf 'FAIL: could not create a temporary directory, so the fixture tree cannot be built.\n' >&2
  exit 1
fi
trap 'rm -rf "$WORK"' EXIT

check() {
  local name="$1" want="$2" got="$3"
  if [ "$want" = "$got" ]; then
    printf '  ok    %s\n' "$name"
    PASSED=$((PASSED + 1))
  else
    printf '  FAIL  %s\n          want: [%s]\n          got:  [%s]\n' \
      "$name" "$want" "$got"
    FAILED=$((FAILED + 1))
  fi
}

# new_fixture <name> [planted term]
#
# Prints the path of a fixture tree. With no planted term the tree is clean,
# which is what the negative control needs.
#
# The fixture carries a copy of the canonicalizer because the scanner refuses
# to run without one. That copy is scanned along with everything else, so an
# unrelated edit to canon-terms.sh that introduced a structurally forbidden
# string would turn the clean control red. That is the safe direction: this
# harness would fail loudly rather than quietly stop measuring.
new_fixture() {
  local name="$1"
  local planted="${2:-}"
  local dir="$WORK/$name"

  mkdir -p "$dir/scripts" "$dir/src"
  cp "$SCAN" "$dir/scripts/pre-publish-scan.sh"
  cp "$CANON" "$dir/scripts/canon-terms.sh"
  printf 'export const label = "ordinary";\n' > "$dir/src/clean.ts"
  if [ -n "$planted" ]; then
    printf 'export const owner = "%s";\n' "$planted" > "$dir/src/planted.ts"
  fi
  printf '%s' "$dir"
}

LAST_OUT=""
LAST_RC=0

# run_scan <fixture dir> <ci|local> <term list, empty for unconfigured>
#
# The scanner keys its redaction off the CI variable, which GitHub Actions
# sets for every step, so the local case has to remove it explicitly rather
# than assume it is absent.
run_scan() {
  local dir="$1" mode="$2" list="${3:-}"
  local rc=0
  if [ "$mode" = ci ]; then
    LAST_OUT="$(CI=true OW_RESERVED_TERMS="$list" \
      bash "$dir/scripts/pre-publish-scan.sh" 2>&1)" || rc=$?
  else
    LAST_OUT="$(env -u CI OW_RESERVED_TERMS="$list" \
      bash "$dir/scripts/pre-publish-scan.sh" 2>&1)" || rc=$?
  fi
  LAST_RC="$rc"
}

# Reports present or absent rather than an exit status, so a case that asks
# for ABSENT reads the same way as one that asks for present.
has() {
  if printf '%s\n' "$LAST_OUT" | grep -qF -- "$1"; then
    printf 'present'
  else
    printf 'absent'
  fi
}

printf '\nleak scan red run self test\n\n'

# ----------------------------------------------------------------------
# The planted term, as a CI job sees it
# ----------------------------------------------------------------------

PLANTED="$(new_fixture planted "$TERM")"
run_scan "$PLANTED" ci "$TERM"
PLANTED_CI_OUT="$LAST_OUT"

check 'a planted term makes the scan exit non-zero' \
  '1' "$LAST_RC"

check 'the reserved-term category is reported failing, with a count' \
  'present' "$(has 'Reserved terms (internal list) (1 findings)')"

check 'the finding still names the file and the line' \
  'present' "$(has './src/planted.ts:1')"

check 'the matched text never reaches the log' \
  'absent' "$(has "$TERM")"

check 'the withholding is announced rather than left silent' \
  'present' "$(has 'matched text withheld')"

check 'the run ends by refusing the tree, not by calling it clean' \
  'present' "$(has 'Leaks found')"

# ----------------------------------------------------------------------
# The same tree on a workstation
# ----------------------------------------------------------------------
#
# Withholding the line is right for a log that may be public and wrong for
# the person fixing the finding. Printing the fixture term here is safe: it
# is invented, and this harness never loads the real list.

run_scan "$PLANTED" local "$TERM"

check 'a local run still refuses the tree' \
  '1' "$LAST_RC"

check 'a local run prints the matched line, so the finding stays fixable' \
  'present' "$(has "$TERM")"

# ----------------------------------------------------------------------
# Negative controls. These carry the weight.
# ----------------------------------------------------------------------
#
# Without them every case above would also pass against a scanner that
# reports red no matter what it is given.

CLEAN="$(new_fixture clean)"
run_scan "$CLEAN" ci "$TERM"

check 'negative control: the same list on a tree with no plant exits 0' \
  '0' "$LAST_RC"

check 'negative control: and that tree is reported clean' \
  'present' "$(has 'Tree is clean')"

# The second control separates "the scanner found the plant" from "the
# scanner always goes red". With no list configured the same planted tree
# must come back green, and it must SAY the category was skipped: an
# unconfigured list is not a clean tree, and a run that cannot tell you
# which one it saw is worth nothing.

run_scan "$PLANTED" ci ""

check 'negative control: with no list configured the plant is not caught' \
  '0' "$LAST_RC"

check 'negative control: and the skip is stated, not implied by a green tick' \
  'present' "$(has 'Reserved-term scan skipped')"

# ----------------------------------------------------------------------
# Ticket-id exemption is id-level, not line-level (OWM-T0406)
# ----------------------------------------------------------------------
#
# The exemption for a delivery-board ticket id (category 2, the structural
# checks) strips the id out of a copy of the matched text and re-tests
# that copy, rather than dropping any line that merely contains an id.
# Neither fixture here configures a reserved-term list, so these prove
# the id-level scope on its own, independent of category 1's coverage.

TICKET_ONLY_DIR="$WORK/ticket-only"
mkdir -p "$TICKET_ONLY_DIR/scripts" "$TICKET_ONLY_DIR/src"
cp "$SCAN" "$TICKET_ONLY_DIR/scripts/pre-publish-scan.sh"
cp "$CANON" "$TICKET_ONLY_DIR/scripts/canon-terms.sh"
printf 'export const label = "ordinary";\n' > "$TICKET_ONLY_DIR/src/clean.ts"
printf '// follow-up from OWM-T0406\nexport const label = "ordinary";\n' \
  > "$TICKET_ONLY_DIR/src/ticket-only.ts"
run_scan "$TICKET_ONLY_DIR" ci ""

check 'a file whose only match is a ticket id: scan exits 0' \
  '0' "$LAST_RC"
check 'a file whose only match is a ticket id: tree reported clean' \
  'present' "$(has 'Tree is clean')"

TICKET_AND_LEAK_DIR="$WORK/ticket-and-leak"
mkdir -p "$TICKET_AND_LEAK_DIR/scripts" "$TICKET_AND_LEAK_DIR/src"
cp "$SCAN" "$TICKET_AND_LEAK_DIR/scripts/pre-publish-scan.sh"
cp "$CANON" "$TICKET_AND_LEAK_DIR/scripts/canon-terms.sh"
printf 'export const label = "ordinary";\n' > "$TICKET_AND_LEAK_DIR/src/clean.ts"
printf '// OWM-T0406: fixes an OWM bug\nexport const label = "ordinary";\n' \
  > "$TICKET_AND_LEAK_DIR/src/mixed.ts"
run_scan "$TICKET_AND_LEAK_DIR" ci ""

check 'ticket id plus a separate OWM match: scan exits non-zero' \
  '1' "$LAST_RC"
check 'ticket id plus a separate OWM match: category 2 reports the finding' \
  'present' "$(has 'Internal codename: MB / OWM as acronym')"
check 'ticket id plus a separate OWM match: the file and line are named' \
  'present' "$(has './src/mixed.ts:1')"

# ----------------------------------------------------------------------
# Case folding
# ----------------------------------------------------------------------
#
# The post-merge identity scan compares case-insensitively. This gate runs
# first, so it has to be at least as strict, or a term in another case
# passes here and is only caught after the merge.

OTHER_CASE="$(new_fixture othercase "$TERM_OTHER_CASE")"
run_scan "$OTHER_CASE" ci "$TERM"

check 'a term in another case is caught here, not first seen after the merge' \
  '1' "$LAST_RC"

check 'the other-case finding withholds its matched text too' \
  'absent' "$(has "$TERM_OTHER_CASE")"

# ----------------------------------------------------------------------
# Evidence, for whoever reads this job log
# ----------------------------------------------------------------------
#
# The pass and fail lines above say the assertions held. This prints what
# the scanner actually produced for the planted tree under CI, so the log
# itself carries the quotable artifact rather than a claim about one. It is
# fixture output: an invented term in a temporary directory.

printf '\nobserved output, planted fixture, CI mode:\n'
printf '%s\n' "$PLANTED_CI_OUT" | sed 's/^/    | /'

printf '\n%d passed, %d failed\n\n' "$PASSED" "$FAILED"

if [ "$FAILED" -ne 0 ]; then
  printf 'leak scan red run self test FAILED\n\n'
  exit 1
fi

printf 'leak scan red run self test passed\n\n'
exit 0
