#!/usr/bin/env bash
#
# Pull-request-level SECURITY DEFINER scan over the migration files a pull
# request CHANGES. A COMPLEMENT to check-definer-grants.sh, which reads a live
# database, not a replacement for it.
#
# TWO RULES, one invariant read two ways: EXECUTE on a SECURITY DEFINER
# function must never reach anon or PUBLIC unless a verified pre-auth callsite
# needs it.
#
#   RULE 1  NO NEW anon OR PUBLIC EXECUTE GRANT
#           Refuses an added GRANT ... EXECUTE ... TO anon or PUBLIC on a
#           function the policy table below does not permit it for.
#
#   RULE 2  A RE-CREATED HARDENED FUNCTION MUST RE-APPLY ITS REVOKE
#           Refuses an added CREATE FUNCTION or CREATE OR REPLACE FUNCTION
#           naming a function marked hardened in the policy table, unless the
#           same file also adds a REVOKE EXECUTE on that function FROM both
#           PUBLIC and anon.
#
# WHY RULE 2 EXISTS. The four hardened functions are protected today by two
# forward-revoke migrations. Both are now stamped as applied, so the migration
# runner will never replay them. A later migration that re-creates one of those
# functions therefore has nothing behind it that puts the revoke back.
#
# WHAT ACTUALLY RESETS THE ACL. Measured on the OWM dev database on 2026-09-03
# against a scratch SECURITY DEFINER function, not taken from a comment:
#
#   CREATE OR REPLACE FUNCTION, SAME signature      ACL PRESERVED
#     proacl stayed postgres=X/postgres across the replace, so an earlier
#     REVOKE survives. Several migration headers in this repo claim the
#     opposite; they are wrong, and this is the corrected statement.
#
#   DROP FUNCTION then CREATE FUNCTION              ACL RESET
#     proacl went null. A null proacl is the default ACL, and the default for
#     a function is EXECUTE to PUBLIC. PUBLIC includes anon.
#
#   CREATE OR REPLACE with a DIFFERENT argument list is not a replace at all.
#     It creates a new overload, so it is the reset case again.
#
# A DROP plus CREATE pair contains a CREATE, so matching CREATE covers both
# real reset paths. The same-signature replace is caught too. That costs one
# redundant REVOKE line in a migration, which is cheap, and a text scan cannot
# tell a replace from an overload reliably enough to be worth the risk.
#
# WHAT NEITHER RULE CAN CATCH, and why the live jobs still have to run: a grant
# that arrives with no commit behind it at all, from a console click, a
# restore, or a hand-run statement. That only shows up by reading the live
# catalog, which is what check-definer-grants.sh is for. Keep both.
#
# ONE MORE HONEST LIMIT: both rules read added lines one line at a time, so a
# GRANT or a REVOKE split across several lines is not matched. Every grant and
# revoke in this repo's migrations is written on one line, and the self-test
# pins that shape.
#
# USAGE
#   check-definer-grant-migrations.sh <base-ref> <head-ref>
# Diffs <base-ref>...<head-ref> for files under supabase/migrations and scans
# every line the pull request ADDS (not the whole file, so an untouched grant
# in a migration that already existed is not re-flagged by an unrelated edit
# to the same file).
#
# OUTCOMES
#   exit 0  PASS or NOTHING TO CHECK  no migration files changed, or nothing
#           the two rules refuse
#   exit 1  VIOLATION                 rule 1 or rule 2 refused something
#   exit 2  CANNOT CHECK              bad arguments, or the base ref is not in
#           this checkout. Loud on purpose: a check that cannot run must never
#           report itself as a pass.

set -uo pipefail

# ---------------------------------------------------------------------------
# THE POLICY TABLE. One row per SECURITY DEFINER function this repo has a rule
# about, and the ONLY place any of these function names appears in this script.
# Both rules read it.
#
#   name|arg-list|policy
#
#   policy = anon      EXECUTE may be granted to anon, because a verified
#                      pre-auth callsite needs it. PUBLIC is NEVER permitted,
#                      even here, because PUBLIC is broader than anon.
#   policy = hardened  EXECUTE must reach neither anon nor PUBLIC, and any
#                      migration that CREATEs the function must re-apply the
#                      REVOKE in the same file.
#
# The anon rows MUST stay identical to the allowlist in
# check-definer-grants.sh. They are duplicated rather than sourced because that
# script runs against a live database with a credential in scope and this one
# runs from an untrusted pull-request checkout; the two are reviewed together
# whenever either changes.
#   is_invite_code_valid(text)        called from the join page before sign in
#   is_email_in_beta_allowlist(text)  called from the auth screen before sign in
#
# The hardened rows are the four functions the forward-revoke migrations
# 20260821000000_household_secdef_forward_revoke and
# 20260824230000_has_role_forward_revoke hardened. Their arg lists are recorded
# for the reader; rule 2 matches on the function NAME, because a CREATE
# statement spells its arguments with parameter names and a REVOKE does not.
# ---------------------------------------------------------------------------
POLICY=$'is_invite_code_valid|(text)|anon\nis_email_in_beta_allowlist|(text)|anon\nhas_role|(uuid, app_role)|hardened\nadvance_household_rotation_job|(uuid, text)|hardened\nexpire_time_boxed_household_roles|()|hardened\npurge_expired_old_household_key_wraps|()|hardened'

# RULE 1's view of the policy table: the "<signature>|<grantee>" rows a pull
# request is allowed to add.
allowlisted_grant_rows() {
  printf '%s\n' "$POLICY" | awk -F'|' '$3 == "anon" { print $1 $2 "|anon" }'
}

# RULE 2's view of the policy table: the names that must never be re-created
# without their revoke.
hardened_function_names() {
  printf '%s\n' "$POLICY" | awk -F'|' '$3 == "hardened" { print $1 }'
}

if [ "$#" -lt 2 ]; then
  echo "::error::usage: check-definer-grant-migrations.sh <base-ref> <head-ref>" >&2
  exit 2
fi

BASE_REF="$1"
HEAD_REF="$2"

ALLOWED_ROWS=$(allowlisted_grant_rows)
VIOLATIONS=()
ALLOWED_HITS=0

# ---------------------------------------------------------------------------
# RULE 1: refuse an added EXECUTE grant to anon or PUBLIC that the policy table
# does not permit.
#   $1 the file the lines came from, for the report
#   $2 the lines this pull request added to it
# Appends to VIOLATIONS and ALLOWED_HITS.
# ---------------------------------------------------------------------------
rule_no_new_anon_or_public_grant() {
  local FILE="$1" ADDED_LINES="$2"
  local LINE NORMALISED MATCH SIG GRANTEES RAW G G_LOWER GRANTEE_NORM ROW

  while IFS= read -r LINE; do
    [ -n "$LINE" ] || continue
    NORMALISED=$(printf '%s' "$LINE" | tr -s '[:space:]' ' ')
    printf '%s' "$NORMALISED" | grep -Eqio 'grant[[:space:]]+execute[[:space:]]+on[[:space:]]+function[[:space:]]+[a-z0-9_."]+\([^)]*\)[[:space:]]+to[[:space:]]+[a-z0-9_, ]+' || continue

    MATCH=$(printf '%s' "$NORMALISED" | grep -Eio 'grant[[:space:]]+execute[[:space:]]+on[[:space:]]+function[[:space:]]+[a-z0-9_."]+\([^)]*\)[[:space:]]+to[[:space:]]+[a-z0-9_, ]+' | head -n1)
    SIG=$(printf '%s' "$MATCH" | grep -Eio '[a-z0-9_."]+\([^)]*\)' | head -n1 | sed 's/^public\.//i' | tr -s ' ')
    GRANTEES=$(printf '%s' "$MATCH" | grep -Eio 'to[[:space:]]+[a-z0-9_, ]+' | sed -E 's/^to[[:space:]]+//i')

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
      ROW="${SIG}|${GRANTEE_NORM}"
      if printf '%s\n' "$ALLOWED_ROWS" | grep -Fxq -- "$ROW"; then
        ALLOWED_HITS=$((ALLOWED_HITS + 1))
        echo "allowed: ${FILE}: ${SIG} grants EXECUTE to ${GRANTEE_NORM}"
      else
        VIOLATIONS+=("${FILE}|${SIG}|adds EXECUTE for ${GRANTEE_NORM}, which the policy table does not permit")
        echo "REFUSED: ${FILE}: ${SIG} adds EXECUTE for ${GRANTEE_NORM}"
      fi
    done
  done <<< "$ADDED_LINES"
}

# ---------------------------------------------------------------------------
# RULE 2: refuse a re-created hardened function that does not re-apply its
# revoke in the same file.
#   $1 the file the lines came from, for the report
#   $2 the lines this pull request added to it
# Appends to VIOLATIONS and ALLOWED_HITS.
# ---------------------------------------------------------------------------
rule_hardened_recreate_must_revoke() {
  local FILE="$1" ADDED_LINES="$2"
  local NAME CREATES REVOKES_PUBLIC REVOKES_ANON

  while IFS= read -r NAME; do
    [ -n "$NAME" ] || continue

    printf '%s\n' "$ADDED_LINES" \
      | grep -Eqi "create[[:space:]]+(or[[:space:]]+replace[[:space:]]+)?function[[:space:]]+(public\.)?${NAME}[[:space:]]*\(" \
      && CREATES=yes || CREATES=no
    [ "$CREATES" = yes ] || continue

    printf '%s\n' "$ADDED_LINES" \
      | grep -Eqi "revoke[[:space:]]+execute[[:space:]]+on[[:space:]]+function[[:space:]]+(public\.)?${NAME}[[:space:]]*\([^)]*\)[[:space:]]+from[[:space:]]+[^;]*public" \
      && REVOKES_PUBLIC=yes || REVOKES_PUBLIC=no

    printf '%s\n' "$ADDED_LINES" \
      | grep -Eqi "revoke[[:space:]]+execute[[:space:]]+on[[:space:]]+function[[:space:]]+(public\.)?${NAME}[[:space:]]*\([^)]*\)[[:space:]]+from[[:space:]]+[^;]*anon" \
      && REVOKES_ANON=yes || REVOKES_ANON=no

    if [ "$REVOKES_PUBLIC" = yes ] && [ "$REVOKES_ANON" = yes ]; then
      ALLOWED_HITS=$((ALLOWED_HITS + 1))
      echo "allowed: ${FILE}: re-creates ${NAME} and re-applies REVOKE EXECUTE FROM PUBLIC and anon"
    else
      VIOLATIONS+=("${FILE}|${NAME}|re-created without a REVOKE EXECUTE ... FROM PUBLIC, anon in the same file (PUBLIC revoked: ${REVOKES_PUBLIC}, anon revoked: ${REVOKES_ANON})")
      echo "REFUSED: ${FILE}: re-creates hardened function ${NAME} without re-applying its REVOKE (PUBLIC: ${REVOKES_PUBLIC}, anon: ${REVOKES_ANON})"
    fi
  done < <(hardened_function_names)
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

while IFS= read -r FILE; do
  [ -n "$FILE" ] || continue
  # Only lines this pull request ADDS, so an untouched statement already
  # sitting in a file the PR merely edits elsewhere is not re-flagged.
  ADDED_LINES=$(git diff "${BASE_REF}...${HEAD_REF}" -- "$FILE" | grep -E '^\+[^+]' | sed 's/^\+//') || true
  [ -n "$ADDED_LINES" ] || continue

  rule_no_new_anon_or_public_grant "$FILE" "$ADDED_LINES"
  rule_hardened_recreate_must_revoke "$FILE" "$ADDED_LINES"
done <<< "$CHANGED_FILES"

{
  echo "## SECURITY DEFINER migration scan"
  echo
  echo "Rule 1: no new EXECUTE grant to anon or PUBLIC outside the policy table."
  echo "Rule 2: a re-created hardened function must re-apply its REVOKE in the same file."
  echo
  echo "Migration files changed: $(printf '%s\n' "$CHANGED_FILES" | grep -c .)."
  echo "Permitted findings: ${ALLOWED_HITS}. Refused: ${#VIOLATIONS[@]}."
  if [ "${#VIOLATIONS[@]}" -gt 0 ]; then
    echo
    echo "| file | function | why it was refused |"
    echo "| --- | --- | --- |"
    for V in "${VIOLATIONS[@]}"; do
      F="${V%%|*}"
      REST="${V#*|}"
      SUBJECT="${REST%%|*}"
      REASON="${REST#*|}"
      printf '| `%s` | `%s` | %s |\n' "$F" "$SUBJECT" "$REASON"
    done
    echo
    echo "A rule 1 refusal needs either a verified pre-auth callsite added to the policy"
    echo "table in \`scripts/check-definer-grant-migrations.sh\` AND the allowlist in"
    echo "\`scripts/check-definer-grants.sh\`, or the grant taken out of the migration."
    echo
    echo "A rule 2 refusal needs the revoke put back in the same migration, on one line:"
    echo "\`REVOKE EXECUTE ON FUNCTION public.<name>(<types>) FROM PUBLIC, anon;\`"
  fi
} >> "${GITHUB_STEP_SUMMARY:-/dev/stdout}"

if [ "${#VIOLATIONS[@]}" -gt 0 ]; then
  echo "::error::VIOLATION: ${#VIOLATIONS[@]} refused finding(s) in this pull request's migrations. See the job summary."
  exit 1
fi

echo "PASS: scanned $(printf '%s\n' "$CHANGED_FILES" | grep -c .) changed migration file(s); ${ALLOWED_HITS} permitted finding(s); nothing refused."
exit 0
