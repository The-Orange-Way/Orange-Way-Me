#!/usr/bin/env bash
#
# Pull-request-level SECURITY DEFINER grant scan. A COMPLEMENT to
# check-definer-grants.sh, not a replacement for it.
#
# WHAT THIS CATCHES THAT THE LIVE CHECK CANNOT
# check-definer-grants.sh reads a live database, so it can only ever report on
# a grant that already landed. At review time, the one moment a human is
# still looking, nothing refused a migration that grants EXECUTE to anon or
# PUBLIC on a SECURITY DEFINER function; it merged with zero friction. This
# script scans the migration files a pull request CHANGES, before merge, for
# exactly that pattern, and fails the PR unless the function is on the same
# allowlist the live gate uses.
#
# WHICH GRANT SHAPES ARE SCANNED. Added lines are joined and split on the
# semicolon, so a statement wrapped over several lines is read whole. That is
# normal formatting for a long argument list and it used to walk straight
# through this gate.
#   1. GRANT EXECUTE ON FUNCTION f(args) TO anon | PUBLIC
#      The ON PROCEDURE and ON ROUTINE spellings count too, and so do
#      GRANT ALL and GRANT ALL PRIVILEGES, which carry EXECUTE with them.
#      Checked against the allowlist, per signature.
#   2. GRANT ... ON ALL FUNCTIONS IN SCHEMA s TO anon | PUBLIC
#      also ALL PROCEDURES and ALL ROUTINES. ALWAYS REFUSED: the allowlist is
#      per signature, so a blanket grant cannot be allowlisted by anything.
#   3. ALTER DEFAULT PRIVILEGES ... GRANT EXECUTE ON FUNCTIONS TO anon | PUBLIC
#      also ON ROUTINES. ALWAYS REFUSED, same reason and worse: it applies to
#      functions that do not exist yet, so nothing in any later diff shows it.
#   4. Anything that looks like one of the above, names anon or PUBLIC, and
#      whose signature this script cannot parse, is REFUSED rather than
#      skipped, so an unforeseen spelling fails loudly instead of quietly.
#
# WHAT THIS CANNOT CATCH, AND WHY THE LIVE CHECK STILL HAS TO RUN. These are
# real holes in THIS script, named so nobody reads the gate as tighter than it
# is:
#   a. CREATE FUNCTION defaults EXECUTE to PUBLIC, and CREATE OR REPLACE
#      resets it to PUBLIC even after a clean revoke, with no GRANT line
#      anywhere in the migration. There is nothing in the text to find.
#   b. Dynamic SQL. A grant built inside EXECUTE format(...) or a DO block is
#      a string here, and the identifiers may not appear in it at all.
#   c. A grant to some other role that anon inherits from. Role membership is
#      not visible in a diff.
#   d. Anything applied outside a migration file, by hand or by another tool.
#   e. Only the lines this pull request ADDS are scanned. If a PR adds just
#      part of a wrapped statement, the added fragment may not carry all of
#      the keywords, and it will not match.
# All of a to e show up in check-definer-grants.sh, which reads the live
# catalog through aclexplode and coalesces a NULL proacl to acldefault, and
# which runs on every push to prod as well as on the daily schedule. Keep
# both. This script is the earlier, cheaper net. That one is the safety net.
#
# TWO DELIBERATE FALSE-ALARM DIRECTIONS. Both fail closed, meaning they cost a
# refusal and never a miss, and both are cleared by rewording the migration:
#   - Line comments starting -- are stripped, but text inside a block comment
#     /* ... */ or inside a dollar-quoted function body is still scanned, so a
#     commented-out grant to anon is refused.
#   - A grantee list built from a psql variable is not matched.
#
# USAGE
#   check-definer-grant-migrations.sh <base-ref> <head-ref>
# Diffs <base-ref>...<head-ref> for files under supabase/migrations, and scans
# every line added by the PR (not the whole file, so an untouched grant in a
# migration that already existed is not re-flagged by an unrelated edit to the
# same file).
#
# OUTCOMES
#   exit 0  PASS or NOTHING TO CHECK  no migration files changed, or none of
#           the changed lines grant EXECUTE to anon or PUBLIC outside the
#           allowlist
#   exit 1  VIOLATION                 a changed migration grants EXECUTE to
#           anon or PUBLIC on a function not on the allowlist, or grants it
#           blanket, or in a shape that cannot be parsed
#   exit 2  CANNOT CHECK              the base ref is unresolvable or the diff
#           failed. Loud on purpose: a check that could not run must never be
#           reported as a pass.
#
# The allowlist below MUST be kept identical to the one in
# check-definer-grants.sh. It is duplicated rather than sourced because this
# script runs from an untrusted PR checkout with no live credential in scope,
# and the two scripts are reviewed together whenever either changes.
#   is_invite_code_valid(text)        called from the join page before sign in
#   is_email_in_beta_allowlist(text)  called from the auth screen before sign in
# PUBLIC is deliberately NOT allowlisted for either of them: PUBLIC is broader
# than anon, and a migration that grants PUBLIC on either is a violation.
#
# SIGNATURE FORM, and why every signature is compared twice. The live gate
# derives its signatures from oid::regprocedure, which prints TYPES ONLY:
# is_invite_code_valid(text). Production declares that function with parameter
# names, is_invite_code_valid(p_code text), which is the same function. A
# legitimate re-grant migration written the natural way would therefore never
# have matched this allowlist. So each signature found in a migration is
# compared as literally written AND with argument modes and parameter names
# stripped, which is the regprocedure form the allowlist is written in.

set -uo pipefail

if [ "$#" -lt 2 ]; then
  echo "::error::usage: check-definer-grant-migrations.sh <base-ref> <head-ref>" >&2
  exit 2
fi

BASE_REF="$1"
HEAD_REF="$2"

ALLOWLIST=$'is_invite_code_valid(text)\tanon\nis_email_in_beta_allowlist(text)\tanon'

# name(args) reduced to one canonical spelling. strip_names=1 also drops the
# argument mode and the parameter name from each argument, which turns
# is_invite_code_valid(p_code text) into is_invite_code_valid(text).
# A first token that is itself the head of a multi word type (character
# varying, double precision, timestamp with time zone) is never dropped.
canon_sig() {
  local sig="$1" strip_names="$2"
  local name args rest arg first tail out

  name="${sig%%(*}"
  args="${sig#*(}"
  args="${args%)}"

  name=$(printf '%s' "$name" | tr '[:upper:]' '[:lower:]' | tr -d '"' | tr -d '[:space:]')
  name="${name#public.}"

  out=""
  rest="$args"
  while [ -n "$rest" ]; do
    case "$rest" in
      *,*) arg="${rest%%,*}"; rest="${rest#*,}" ;;
      *)   arg="$rest";       rest="" ;;
    esac
    arg=$(printf '%s' "$arg" | tr '[:upper:]' '[:lower:]' | tr -s '[:space:]' ' ')
    arg="${arg# }"
    arg="${arg% }"
    [ -n "$arg" ] || continue
    arg=$(printf '%s' "$arg" | sed -E 's/^(in|out|inout|variadic) +//')
    if [ "$strip_names" = "1" ]; then
      first="${arg%% *}"
      tail="${arg#* }"
      if [ "$tail" != "$arg" ] && ! printf '%s' "$first" | grep -Eq '^(character|double|timestamp|time|bit|numeric|decimal|interval|national)$'; then
        arg="$tail"
      fi
    fi
    if [ -z "$out" ]; then out="$arg"; else out="${out}, ${arg}"; fi
  done

  printf '%s(%s)' "$name" "$out"
}

# anon and PUBLIC are the only grantees this gate cares about. Anything else
# prints nothing and is skipped by the caller.
norm_grantee() {
  local g
  g=$(printf '%s' "$1" | tr -d '"' | tr -d '[:space:]' | tr '[:upper:]' '[:lower:]')
  case "$g" in
    public) printf 'PUBLIC' ;;
    anon)   printf 'anon' ;;
  esac
}

if ! git rev-parse --verify "$BASE_REF" >/dev/null 2>&1; then
  echo "::error::CANNOT CHECK: base ref '${BASE_REF}' is not resolvable in this checkout. Was fetch-depth set to 0?" >&2
  exit 2
fi

CHANGED_FILES=$(git diff --name-only --diff-filter=ACMR "${BASE_REF}...${HEAD_REF}" -- 'supabase/migrations/*.sql') || {
  echo "::error::CANNOT CHECK: git diff between ${BASE_REF} and ${HEAD_REF} failed" >&2
  exit 2
}

if [ -z "$CHANGED_FILES" ]; then
  echo "PASS: no migration files changed in this pull request; nothing to scan."
  exit 0
fi

VIOLATIONS=()
ALLOWED_HITS=0

record() {
  # record <file> <signature-or-label> <grantee> <allowed:0|1>
  local file="$1" sig="$2" grantee="$3" allowed="$4"
  local row="${sig}"$'\t'"${grantee}"
  if [ "$allowed" = "1" ]; then
    ALLOWED_HITS=$((ALLOWED_HITS + 1))
    echo "allowed: ${file}: ${row}"
  else
    VIOLATIONS+=("${file}"$'\t'"${row}")
    echo "REFUSED: ${file}: ${row}"
  fi
}

while IFS= read -r FILE; do
  [ -n "$FILE" ] || continue
  # Only lines this PR ADDS, so an untouched GRANT already sitting in a file
  # this PR merely edits elsewhere is not re-flagged as new.
  ADDED_LINES=$(git diff "${BASE_REF}...${HEAD_REF}" -- "$FILE" | grep -E '^\+[^+]' | sed 's/^\+//') || true
  [ -n "$ADDED_LINES" ] || continue

  # Strip line comments, then join everything and cut on the semicolon, so a
  # statement wrapped over several lines is scanned as one statement.
  STATEMENTS=$(printf '%s\n' "$ADDED_LINES" \
    | sed -E 's/--.*$//' \
    | tr '\n' ' ' \
    | tr -s '[:space:]' ' ' \
    | tr ';' '\n')

  while IFS= read -r STMT; do
    [ -n "$STMT" ] || continue
    LOWER=$(printf '%s' "$STMT" | tr '[:upper:]' '[:lower:]')

    # Does this statement grant EXECUTE at all? GRANT ALL and GRANT ALL
    # PRIVILEGES carry EXECUTE with them, so they count.
    printf '%s' "$LOWER" | grep -Eq '(^|[[:space:]])grant[[:space:]]+(execute|all([[:space:]]+privileges)?)([[:space:]]|,)' || continue

    GRANTEES=$(printf '%s' "$LOWER" \
      | sed -E 's/.*[[:space:]]to[[:space:]]+//' \
      | sed -E 's/[[:space:]]+with[[:space:]]+grant[[:space:]]+option.*$//')

    # Which of anon or PUBLIC does it name? Nothing else is this gate's business.
    HITS=()
    GREST="$GRANTEES"
    while [ -n "$GREST" ]; do
      case "$GREST" in
        *,*) RAW="${GREST%%,*}"; GREST="${GREST#*,}" ;;
        *)   RAW="$GREST";       GREST="" ;;
      esac
      G=$(norm_grantee "$RAW")
      [ -n "$G" ] && HITS+=("$G")
    done
    [ "${#HITS[@]}" -gt 0 ] || continue

    # Blanket forms. Always refused: the allowlist is per signature, so there
    # is no spelling of these that could ever be allowlisted.
    if printf '%s' "$LOWER" | grep -Eq 'alter[[:space:]]+default[[:space:]]+privileges'; then
      SCHEMA=$(printf '%s' "$LOWER" | grep -Eio 'in[[:space:]]+schema[[:space:]]+[a-z0-9_."]+' | head -n1 | sed -E 's/^in[[:space:]]+schema[[:space:]]+//')
      for G in "${HITS[@]}"; do
        record "$FILE" "ALTER DEFAULT PRIVILEGES ON FUNCTIONS${SCHEMA:+ IN SCHEMA ${SCHEMA}}" "$G" 0
      done
      continue
    fi
    if printf '%s' "$LOWER" | grep -Eq 'on[[:space:]]+all[[:space:]]+(functions|procedures|routines)[[:space:]]+in[[:space:]]+schema'; then
      SCHEMA=$(printf '%s' "$LOWER" | grep -Eio 'in[[:space:]]+schema[[:space:]]+[a-z0-9_."]+' | head -n1 | sed -E 's/^in[[:space:]]+schema[[:space:]]+//')
      for G in "${HITS[@]}"; do
        record "$FILE" "ALL FUNCTIONS IN SCHEMA ${SCHEMA:-?}" "$G" 0
      done
      continue
    fi

    # Per-function form, including the ON PROCEDURE and ON ROUTINE spellings.
    printf '%s' "$LOWER" | grep -Eq 'on[[:space:]]+(function|procedure|routine)[[:space:]]' || continue

    TARGETS=$(printf '%s' "$LOWER" \
      | sed -E 's/.*[[:space:]]?on[[:space:]]+(function|procedure|routine)[[:space:]]+//' \
      | sed -E 's/[[:space:]]+to[[:space:]]+.*$//')
    SIGS=$(printf '%s' "$TARGETS" | grep -Eo '[a-z0-9_."]+[[:space:]]*\([^)]*\)' || true)

    if [ -z "$SIGS" ]; then
      # It names anon or PUBLIC, it grants EXECUTE, and this script cannot see
      # which function. Refuse it rather than let an unforeseen spelling pass.
      for G in "${HITS[@]}"; do
        record "$FILE" "UNPARSED GRANT: ${TARGETS:0:60}" "$G" 0
      done
      continue
    fi

    while IFS= read -r SIG_RAW; do
      [ -n "$SIG_RAW" ] || continue
      SIG_AS_WRITTEN=$(canon_sig "$SIG_RAW" 0)
      SIG_TYPES_ONLY=$(canon_sig "$SIG_RAW" 1)
      for G in "${HITS[@]}"; do
        if printf '%s\n' "$ALLOWLIST" | grep -Fxq -- "${SIG_AS_WRITTEN}"$'\t'"${G}" \
        || printf '%s\n' "$ALLOWLIST" | grep -Fxq -- "${SIG_TYPES_ONLY}"$'\t'"${G}"; then
          record "$FILE" "$SIG_TYPES_ONLY" "$G" 1
        else
          record "$FILE" "$SIG_TYPES_ONLY" "$G" 0
        fi
      done
    done <<< "$SIGS"
  done <<< "$STATEMENTS"
done <<< "$CHANGED_FILES"

{
  echo "## SECURITY DEFINER EXECUTE grants, migration diff scan"
  echo
  echo "Migration files changed: $(printf '%s\n' "$CHANGED_FILES" | grep -c .)."
  echo "Allowlisted grants added: ${ALLOWED_HITS}. Refused grants added: ${#VIOLATIONS[@]}."
  if [ "${#VIOLATIONS[@]}" -gt 0 ]; then
    echo
    echo "| file | function or form | grantee |"
    echo "| --- | --- | --- |"
    for V in "${VIOLATIONS[@]}"; do
      F="${V%%$'\t'*}"
      REST="${V#*$'\t'}"
      SIG="${REST%%$'\t'*}"
      GR="${REST##*$'\t'}"
      printf '| `%s` | `%s` | `%s` |\n' "$F" "$SIG" "$GR"
    done
    echo
    echo "A named function needs a verified pre-auth callsite added to the allowlist in both"
    echo "\`scripts/check-definer-grants.sh\` and \`scripts/check-definer-grant-migrations.sh\`,"
    echo "or the grant must come out of the migration. A blanket form (ALL FUNCTIONS IN SCHEMA,"
    echo "ALTER DEFAULT PRIVILEGES) cannot be allowlisted at all: grant the one function it needs."
  fi
} >> "${GITHUB_STEP_SUMMARY:-/dev/stdout}"

if [ "${#VIOLATIONS[@]}" -gt 0 ]; then
  echo "::error::VIOLATION: ${#VIOLATIONS[@]} unallowlisted anon or PUBLIC EXECUTE grant(s) added on SECURITY DEFINER functions in this pull request's migrations."
  exit 1
fi

echo "PASS: scanned $(printf '%s\n' "$CHANGED_FILES" | grep -c .) changed migration file(s); ${ALLOWED_HITS} allowlisted grant(s) added; no unallowlisted anon or PUBLIC EXECUTE."
exit 0
