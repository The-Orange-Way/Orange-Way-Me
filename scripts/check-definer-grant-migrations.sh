#!/usr/bin/env bash
#
# Pull-request-level SECURITY DEFINER migration scan. A COMPLEMENT to
# check-definer-grants.sh, not a replacement for it.
#
# TWO RULES, ONE JOB. They are one invariant read two ways: EXECUTE on a
# SECURITY DEFINER function in the public schema must never reach anon or
# PUBLIC.
#
#   RULE 1  rule_grant_to_anon_or_public
#           Refuses a line this pull request ADDS that grants EXECUTE on a
#           function to anon or to PUBLIC, unless the (signature, grantee)
#           pair is on GRANT_ALLOWLIST below.
#
#   RULE 2  rule_definer_replace_without_revoke
#           Refuses a migration file this pull request adds to that CREATEs
#           or CREATE OR REPLACEs one of the functions in
#           HARDENED_DEFINER_FUNCTIONS below, unless the same file also
#           re-applies REVOKE EXECUTE on that function FROM PUBLIC and FROM
#           anon.
#
# WHY RULE 2 EXISTS. Postgres resets EXECUTE on a replaced function to
# PUBLIC, and PUBLIC includes anon. It does that with no GRANT line anywhere
# in the migration, so there is nothing for rule 1 to find. The revoke-only
# migrations that hardened these four functions are stamped as applied in
# production, so the migration runner will never replay them, and their own
# headers say they must run after any such change. has_role is SECURITY
# DEFINER and returns boolean, so once EXECUTE is back with PUBLIC an
# unauthenticated caller can ask over RPC whether an arbitrary user id holds
# an arbitrary role.
#
# WHY IT IS A TEXT SCAN AND NOT A LIVE PROBE. A probe of live ACLs needs
# database credentials and cannot run on a pull request before the migration
# lands. This runs on the pull request's own added lines, needs no database
# access, and refuses the change before it can reach any database. The
# live-database jobs in .github/workflows/definer-grant-gate.yml still find
# a reset after it lands, on the push to that branch and on the daily
# schedule; this refuses it first.
#
# WHAT NEITHER RULE CAN CATCH, AND WHY THE LIVE JOBS STILL HAVE TO RUN.
# Rule 2 covers a fixed list of functions BY NAME. A CREATE OR REPLACE of any
# OTHER SECURITY DEFINER function still resets EXECUTE to PUBLIC with nothing
# in the diff to find, and a grant that arrives with no commit behind it at
# all is invisible to any text scan. Only reading the live catalog finds
# those. Keep both.
#
# USAGE
#   check-definer-grant-migrations.sh <base-ref> <head-ref>
#       Diffs <base-ref>...<head-ref> for files under supabase/migrations and
#       runs both rules over the lines the pull request ADDS (not the whole
#       file, so an untouched grant in a migration that this pull request
#       merely edits elsewhere is not re-flagged).
#
#   check-definer-grant-migrations.sh --self-test
#       Runs both rules against fixtures and asserts each one goes red on the
#       thing it is for and stays green on the thing it is not. Needs no git
#       history and no credentials. CI runs this before the real scan, so a
#       rule that has been broken into always passing is caught.
#
# OUTCOMES
#   exit 0  PASS or NOTHING TO CHECK
#   exit 1  VIOLATION, from either rule
#   exit 2  CANNOT CHECK (bad usage, unresolvable base ref, failed diff).
#           Deliberately distinct from PASS: a scan that could not run must
#           not read as a scan that found nothing.

set -uo pipefail

# ---------------------------------------------------------------------------
# THE TWO LISTS. Each is defined once, here, and nowhere else in this file.
#
# They are lists of DIFFERENT things and cannot be collapsed into one:
# GRANT_ALLOWLIST is (function signature, grantee) pairs that are PERMITTED to
# hold EXECUTE, and HARDENED_DEFINER_FUNCTIONS is function names that must
# have EXECUTE revoked again whenever they are replaced. A name on the second
# list must never appear on the first.
#
# GRANT_ALLOWLIST MUST be kept identical to the allowlist in
# check-definer-grants.sh. It is duplicated across those two files rather
# than sourced because this script runs from an untrusted pull request
# checkout with no live credential in scope, and the two are reviewed
# together whenever either changes.
#   is_invite_code_valid(text)        called from the join page before sign in
#   is_email_in_beta_allowlist(text)  called from the auth screen before sign in
# PUBLIC is deliberately NOT allowlisted for either of them: PUBLIC is broader
# than anon, and a migration that grants PUBLIC on either is a violation.
# ---------------------------------------------------------------------------

GRANT_ALLOWLIST=$'is_invite_code_valid(text)\tanon\nis_email_in_beta_allowlist(text)\tanon'

HARDENED_DEFINER_FUNCTIONS=$'has_role\nadvance_household_rotation_job\nexpire_time_boxed_household_roles\npurge_expired_old_household_key_wraps'

GRANT_VIOLATIONS=()
REPLACE_VIOLATIONS=()
ALLOWED_HITS=0

# ---------------------------------------------------------------------------
# RULE 1
# rule_grant_to_anon_or_public <file> <added-lines>
# Appends to GRANT_VIOLATIONS and increments ALLOWED_HITS.
# ---------------------------------------------------------------------------
rule_grant_to_anon_or_public() {
  local FILE="$1"
  local ADDED_LINES="$2"
  local LINE NORMALISED MATCH SIG GRANTEES RAW G G_LOWER GRANTEE_NORM ROW
  local -a GRANTEE_LIST

  [ -n "$ADDED_LINES" ] || return 0

  while IFS= read -r LINE; do
    [ -n "$LINE" ] || continue
    NORMALISED=$(printf '%s' "$LINE" | tr -s '[:space:]' ' ')
    if grep -Eqio 'grant[[:space:]]+execute[[:space:]]+on[[:space:]]+function[[:space:]]+[a-z0-9_."]+\([^)]*\)[[:space:]]+to[[:space:]]+[a-z0-9_, ]+' <<< "$NORMALISED"; then
      MATCH=$(grep -Eio 'grant[[:space:]]+execute[[:space:]]+on[[:space:]]+function[[:space:]]+[a-z0-9_."]+\([^)]*\)[[:space:]]+to[[:space:]]+[a-z0-9_, ]+' <<< "$NORMALISED" | head -n1)
      SIG=$(grep -Eio '[a-z0-9_."]+\([^)]*\)' <<< "$MATCH" | head -n1 | sed 's/^public\.//i' | tr -s ' ')
      GRANTEES=$(grep -Eio 'to[[:space:]]+[a-z0-9_, ]+' <<< "$MATCH" | sed -E 's/^to[[:space:]]+//i')
      IFS=',' read -ra GRANTEE_LIST <<< "$GRANTEES"
      for RAW in "${GRANTEE_LIST[@]}"; do
        G=$(printf '%s' "$RAW" | tr -d '[:space:]')
        [ -n "$G" ] || continue
        G_LOWER=$(printf '%s' "$G" | tr '[:upper:]' '[:lower:]')
        if [ "$G_LOWER" = "public" ]; then
          GRANTEE_NORM="PUBLIC"
        elif [ "$G_LOWER" = "anon" ]; then
          GRANTEE_NORM="anon"
        else
          continue
        fi
        ROW="${SIG}"$'\t'"${GRANTEE_NORM}"
        if grep -Fxq -- "$ROW" <<< "$GRANT_ALLOWLIST"; then
          ALLOWED_HITS=$((ALLOWED_HITS + 1))
          echo "allowed: ${FILE}: ${ROW}"
        else
          GRANT_VIOLATIONS+=("${FILE}"$'\t'"${ROW}")
          echo "REFUSED: ${FILE}: ${ROW}"
        fi
      done
    fi
  done <<< "$ADDED_LINES"
}

# ---------------------------------------------------------------------------
# RULE 2
# rule_definer_replace_without_revoke <file> <added-lines>
# Appends to REPLACE_VIOLATIONS.
#
# The added lines are stripped of -- comments and joined into one whitespace
# collapsed blob before matching, so a statement written across several lines
# is still seen, and a function name mentioned only in a comment does not
# demand a revoke. The FROM clause is matched with [^;]* so it cannot run
# past the end of its own statement.
# ---------------------------------------------------------------------------
rule_definer_replace_without_revoke() {
  local FILE="$1"
  local ADDED_LINES="$2"
  local BLOB NAME MISSING

  [ -n "$ADDED_LINES" ] || return 0

  BLOB=$(printf '%s\n' "$ADDED_LINES" | sed 's/--.*$//' | tr '\n' ' ' | tr -s '[:space:]' ' ')

  while IFS= read -r NAME; do
    [ -n "$NAME" ] || continue

    grep -Eqi "create[[:space:]]+(or[[:space:]]+replace[[:space:]]+)?function[[:space:]]+(public\.)?\"?${NAME}\"?[[:space:]]*\(" <<< "$BLOB" || continue

    MISSING=""
    grep -Eqi "revoke[[:space:]]+execute[[:space:]]+on[[:space:]]+function[[:space:]]+(public\.)?\"?${NAME}\"?[[:space:]]*\([^)]*\)[[:space:]]+from[[:space:]]+[^;]*public" <<< "$BLOB" \
      || MISSING="PUBLIC"
    grep -Eqi "revoke[[:space:]]+execute[[:space:]]+on[[:space:]]+function[[:space:]]+(public\.)?\"?${NAME}\"?[[:space:]]*\([^)]*\)[[:space:]]+from[[:space:]]+[^;]*anon" <<< "$BLOB" \
      || MISSING="${MISSING:+${MISSING} and }anon"

    if [ -n "$MISSING" ]; then
      REPLACE_VIOLATIONS+=("${FILE}"$'\t'"${NAME}"$'\t'"${MISSING}")
      echo "REFUSED: ${FILE}: creates or replaces ${NAME} without re-revoking EXECUTE from ${MISSING}"
    else
      echo "ok: ${FILE}: ${NAME} replaced, EXECUTE re-revoked from PUBLIC and anon"
    fi
  done <<< "$HARDENED_DEFINER_FUNCTIONS"
}

# ---------------------------------------------------------------------------
# SELF-TEST
# ---------------------------------------------------------------------------
SELF_TEST_FAILURES=0

assert_rule() {
  local FN="$1" EXPECT="$2" NAME="$3" TEXT="$4"
  local GOT

  GRANT_VIOLATIONS=()
  REPLACE_VIOLATIONS=()
  ALLOWED_HITS=0

  "$FN" "fixture.sql" "$TEXT" >/dev/null

  if [ "$FN" = "rule_grant_to_anon_or_public" ]; then
    GOT=${#GRANT_VIOLATIONS[@]}
  else
    GOT=${#REPLACE_VIOLATIONS[@]}
  fi

  if [ "$GOT" -eq "$EXPECT" ]; then
    echo "  PASS  ${NAME}"
  else
    echo "  FAIL  ${NAME}: expected ${EXPECT} violation(s), got ${GOT}"
    SELF_TEST_FAILURES=$((SELF_TEST_FAILURES + 1))
  fi
}

run_self_test() {
  echo "RULE 1: no new EXECUTE grant to anon or PUBLIC outside the allowlist"
  assert_rule rule_grant_to_anon_or_public 1 \
    "grant to anon on a function that is not allowlisted is refused" \
    'GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO anon;'
  assert_rule rule_grant_to_anon_or_public 1 \
    "grant to PUBLIC on an allowlisted function is still refused" \
    'GRANT EXECUTE ON FUNCTION public.is_invite_code_valid(text) TO PUBLIC;'
  assert_rule rule_grant_to_anon_or_public 0 \
    "allowlisted anon grant passes" \
    'GRANT EXECUTE ON FUNCTION public.is_invite_code_valid(text) TO anon;'
  assert_rule rule_grant_to_anon_or_public 0 \
    "grant to authenticated is not this rule's business" \
    'GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;'

  echo "RULE 2: no CREATE OR REPLACE of a hardened definer function without its revoke"
  assert_rule rule_definer_replace_without_revoke 1 \
    "bare CREATE OR REPLACE of has_role is refused" \
    'CREATE OR REPLACE FUNCTION public.has_role(uuid, public.app_role) RETURNS boolean LANGUAGE sql SECURITY DEFINER AS $$ SELECT true $$;'
  assert_rule rule_definer_replace_without_revoke 0 \
    "CREATE OR REPLACE with FROM PUBLIC, anon passes" \
    'CREATE OR REPLACE FUNCTION public.has_role(uuid, public.app_role) RETURNS boolean LANGUAGE sql SECURITY DEFINER AS $$ SELECT true $$;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;'
  assert_rule rule_definer_replace_without_revoke 0 \
    "CREATE OR REPLACE with two separate REVOKE statements passes" \
    'CREATE OR REPLACE FUNCTION public.has_role(uuid, public.app_role) RETURNS boolean LANGUAGE sql SECURITY DEFINER AS $$ SELECT true $$;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM anon;'
  assert_rule rule_definer_replace_without_revoke 1 \
    "revoking only FROM PUBLIC is refused, anon is still missing" \
    'CREATE OR REPLACE FUNCTION public.has_role(uuid, public.app_role) RETURNS boolean LANGUAGE sql SECURITY DEFINER AS $$ SELECT true $$;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC;'
  assert_rule rule_definer_replace_without_revoke 1 \
    "plain CREATE FUNCTION, not just OR REPLACE, is refused" \
    'CREATE FUNCTION public.purge_expired_old_household_key_wraps() RETURNS void LANGUAGE sql SECURITY DEFINER AS $$ SELECT 1 $$;'
  assert_rule rule_definer_replace_without_revoke 1 \
    "unqualified function name is still matched" \
    'CREATE OR REPLACE FUNCTION expire_time_boxed_household_roles() RETURNS void LANGUAGE sql AS $$ SELECT 1 $$;'
  assert_rule rule_definer_replace_without_revoke 1 \
    "a statement split across lines is still matched" \
    'CREATE OR REPLACE FUNCTION
   public.advance_household_rotation_job(uuid)
   RETURNS void LANGUAGE sql SECURITY DEFINER AS $$ SELECT 1 $$;'
  assert_rule rule_definer_replace_without_revoke 0 \
    "a function that is not on the hardened list is not this rule's business" \
    'CREATE OR REPLACE FUNCTION public.some_other_helper(uuid) RETURNS void LANGUAGE sql AS $$ SELECT 1 $$;'
  assert_rule rule_definer_replace_without_revoke 0 \
    "a mention inside a comment does not demand a revoke" \
    '-- CREATE OR REPLACE FUNCTION public.has_role(uuid, public.app_role) would need a revoke
SELECT 1;'
  assert_rule rule_definer_replace_without_revoke 0 \
    "a REVOKE with no CREATE is not a violation" \
    'REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;'

  if [ "$SELF_TEST_FAILURES" -gt 0 ]; then
    echo "::error::SELF-TEST FAILED: ${SELF_TEST_FAILURES} case(s). The rules in this script do not behave as documented."
    return 1
  fi
  echo "SELF-TEST PASSED: both rules go red on what they are for and stay green on what they are not."
  return 0
}

# ---------------------------------------------------------------------------
# ENTRY POINT
# ---------------------------------------------------------------------------

if [ "${1:-}" = "--self-test" ]; then
  run_self_test
  exit $?
fi

if [ "$#" -lt 2 ]; then
  echo "::error::usage: check-definer-grant-migrations.sh <base-ref> <head-ref> | --self-test" >&2
  exit 2
fi

BASE_REF="$1"
HEAD_REF="$2"

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

while IFS= read -r FILE; do
  [ -n "$FILE" ] || continue
  ADDED_LINES=$(git diff "${BASE_REF}...${HEAD_REF}" -- "$FILE" | grep -E '^\+[^+]' | sed 's/^\+//') || true
  [ -n "$ADDED_LINES" ] || continue

  rule_grant_to_anon_or_public "$FILE" "$ADDED_LINES"
  rule_definer_replace_without_revoke "$FILE" "$ADDED_LINES"
done <<< "$CHANGED_FILES"

FILE_COUNT=$(grep -c . <<< "$CHANGED_FILES")
TOTAL_VIOLATIONS=$(( ${#GRANT_VIOLATIONS[@]} + ${#REPLACE_VIOLATIONS[@]} ))

{
  echo "## SECURITY DEFINER migration scan (two rules)"
  echo
  echo "Migration files changed: ${FILE_COUNT}."
  echo "Rule 1, EXECUTE grants to anon or PUBLIC: ${ALLOWED_HITS} allowlisted, ${#GRANT_VIOLATIONS[@]} refused."
  echo "Rule 2, hardened definer function replaced without its revoke: ${#REPLACE_VIOLATIONS[@]} refused."

  if [ "${#GRANT_VIOLATIONS[@]}" -gt 0 ]; then
    echo
    echo "### Rule 1 violations"
    echo
    echo "| file | function | grantee |"
    echo "| --- | --- | --- |"
    for V in "${GRANT_VIOLATIONS[@]}"; do
      F="${V%%$'\t'*}"
      REST="${V#*$'\t'}"
      SIG="${REST%%$'\t'*}"
      GR="${REST##*$'\t'}"
      printf '| `%s` | `%s` | `%s` |\n' "$F" "$SIG" "$GR"
    done
    echo
    echo "Each one needs a verified pre-auth callsite added to the allowlist in both"
    echo "\`scripts/check-definer-grants.sh\` and \`scripts/check-definer-grant-migrations.sh\`,"
    echo "or the grant must come out of the migration."
  fi

  if [ "${#REPLACE_VIOLATIONS[@]}" -gt 0 ]; then
    echo
    echo "### Rule 2 violations"
    echo
    echo "| file | function | revoke missing for |"
    echo "| --- | --- | --- |"
    for V in "${REPLACE_VIOLATIONS[@]}"; do
      F="${V%%$'\t'*}"
      REST="${V#*$'\t'}"
      SIG="${REST%%$'\t'*}"
      MISS="${REST##*$'\t'}"
      printf '| `%s` | `%s` | `%s` |\n' "$F" "$SIG" "$MISS"
    done
    echo
    echo "Postgres resets EXECUTE to PUBLIC on a replaced function, and PUBLIC includes"
    echo "anon. Add the matching revoke to the same migration file:"
    echo
    echo '```sql'
    echo "REVOKE EXECUTE ON FUNCTION public.<function>(<args>) FROM PUBLIC, anon;"
    echo '```'
  fi
} >> "${GITHUB_STEP_SUMMARY:-/dev/stdout}"

if [ "$TOTAL_VIOLATIONS" -gt 0 ]; then
  echo "::error::VIOLATION: ${#GRANT_VIOLATIONS[@]} unallowlisted anon or PUBLIC EXECUTE grant(s) and ${#REPLACE_VIOLATIONS[@]} hardened definer function replacement(s) with no re-revoke in this pull request's migrations."
  exit 1
fi

echo "PASS: scanned ${FILE_COUNT} changed migration file(s); ${ALLOWED_HITS} allowlisted grant(s) added; no unallowlisted anon or PUBLIC EXECUTE and no hardened definer function replaced without its revoke."
exit 0
