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
# WHAT SHAPES THIS SCAN MATCHES
# The scan is statement-oriented, not line-oriented: every line the pull
# request ADDS to a migration is joined into one buffer, line comments are
# dropped, and the buffer is split on ';'. So a statement wrapped across
# several lines, which is normal formatting for a long argument list, is still
# seen whole. These forms are all matched, in any case and any spacing:
#   GRANT EXECUTE ON FUNCTION f(args) TO anon      also PROCEDURE and ROUTINE
#   GRANT EXECUTE ON FUNCTION f(a), g(b) TO anon   comma list, each checked
#   GRANT EXECUTE ON FUNCTION f TO anon            no signature written
#   GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA s TO anon
#   ALTER DEFAULT PRIVILEGES ... GRANT EXECUTE ON FUNCTIONS TO anon
# and the same five statements written with ALL or ALL PRIVILEGES instead of
# EXECUTE, for example:
#   GRANT ALL ON FUNCTION f(args) TO anon
#   GRANT ALL PRIVILEGES ON FUNCTION f(args) TO PUBLIC
#   GRANT ALL ON ALL FUNCTIONS IN SCHEMA s TO anon
#   ALTER DEFAULT PRIVILEGES ... GRANT ALL ON FUNCTIONS TO anon
# EXECUTE is the only privilege a function has in PostgreSQL, so ALL is the
# same grant written differently and is treated identically here. The object
# type is checked before anything is refused, so a grant on a TABLE written
# with ALL is left alone: that object is not this scan's remit.
# The last three can never be allowlisted. The allowlist is per function
# signature, and a blanket grant is not a signature, so it is always refused.
#
# WHAT THIS CANNOT CATCH, AND WHY THE LIVE CHECK STILL HAS TO RUN
# 1. CREATE FUNCTION defaults EXECUTE to PUBLIC, and CREATE OR REPLACE resets
#    it to PUBLIC even after a clean revoke, with no GRANT line anywhere in
#    the migration that changed it. A text scan of the diff cannot see that:
#    there is nothing to find.
# 2. A grant built at run time, inside a DO block or by EXECUTE format(...),
#    where the grantee is not literal text in the migration.
# 3. A grant that already sits in a file this pull request does not touch.
#    The scan reads ADDED lines only, on purpose.
# 4. A privilege spelled as neither EXECUTE nor ALL / ALL PRIVILEGES. Those
#    two are the only spellings that can confer EXECUTE on a function today,
#    so the list is exhaustive as PostgreSQL stands, but it is a keyword list
#    and not a parser: if a future version adds another way to write it, this
#    scan will not see it until the keyword is added on the line below marked
#    ENTRY FILTER.
# Every one of those does show up in check-definer-grants.sh, which reads the
# live catalog through aclexplode. Keep both.
#
# USAGE
#   check-definer-grant-migrations.sh <base-ref> <head-ref>
# Diffs <base-ref>...<head-ref> for files under supabase/migrations, and scans
# every line added by the PR (not the whole file, so an untouched grant in a
# migration that already existed is not re-flagged by an unrelated edit to the
# same file) for a GRANT ... EXECUTE ... TO naming anon or PUBLIC.
#
# OUTCOMES
#   exit 0  PASS or NOTHING TO CHECK  no migration files changed, or none of
#           the changed lines grant EXECUTE to anon or PUBLIC outside the
#           allowlist
#   exit 1  VIOLATION                 a changed migration line grants EXECUTE
#           to anon or PUBLIC on a function not on the allowlist
#
# The allowlist below MUST be kept identical to the one in
# check-definer-grants.sh. It is duplicated rather than sourced because this
# script runs from an untrusted PR checkout with no live credential in scope,
# and the two scripts are reviewed together whenever either changes.
#   is_invite_code_valid(text)        called from the join page before sign in
#   is_email_in_beta_allowlist(text)  called from the auth screen before sign in
#
# SIGNATURE FORM, and why an added grant is compared twice
# check-definer-grants.sh derives its signature from oid::regprocedure, which
# prints TYPES ONLY: is_invite_code_valid(text). A migration is normally
# written with parameter NAMES, and production declares both of these
# functions that way: is_invite_code_valid(p_code text). Comparing only the
# literal migration text would refuse a legitimate re-grant written the
# natural way, fail-closed but for a reason no reader could see. So each added
# grant is checked against the allowlist twice, once as literally written and
# once with argument modes and parameter names stripped, and a hit on either
# is allowed.
# PUBLIC is deliberately NOT allowlisted for either of them: PUBLIC is broader
# than anon, and a migration that grants PUBLIC on either is a violation.

set -uo pipefail

if [ "$#" -lt 2 ]; then
  echo "::error::usage: check-definer-grant-migrations.sh <base-ref> <head-ref>" >&2
  exit 2
fi

BASE_REF="$1"
HEAD_REF="$2"

ALLOWLIST=$'is_invite_code_valid(text)\tanon\nis_email_in_beta_allowlist(text)\tanon'

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

# Words that begin a TYPE rather than a parameter name. Used to decide whether
# the first token of an argument is a name to drop or part of the type itself,
# so "p_code text" reduces to "text" while "timestamp with time zone" does not.
TYPE_WORDS='^(text|varchar|character|char|name|uuid|json|jsonb|xml|bytea|boolean|bool|smallint|int|int2|int4|int8|integer|bigint|numeric|decimal|real|float|float4|float8|double|money|date|time|timestamp|timestamptz|interval|inet|cidr|macaddr|citext|tsvector|oid|regclass|record|void|anyelement|anyarray|anynonarray|trigger)$'

# is_invite_code_valid(p_code text) -> is_invite_code_valid(text)
strip_param_names() {
  local sig="$1" fname args arg tok rest out="" old_ifs
  fname="${sig%%(*}"
  args="${sig#*(}"
  args="${args%)}"
  old_ifs="$IFS"
  IFS=','
  read -ra ARG_PARTS <<< "$args"
  IFS="$old_ifs"
  for arg in ${ARG_PARTS[@]+"${ARG_PARTS[@]}"}; do
    arg=$(printf '%s' "$arg" | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//; s/^(in|out|inout|variadic)[[:space:]]+//')
    [ -n "$arg" ] || continue
    tok="${arg%% *}"
    rest="${arg#* }"
    if [ "$rest" != "$arg" ] && ! printf '%s' "$tok" | grep -Eq "$TYPE_WORDS"; then
      arg="$rest"
    fi
    arg=$(printf '%s' "$arg" | tr -s ' ')
    if [ -z "$out" ]; then out="$arg"; else out="${out},${arg}"; fi
  done
  printf '%s(%s)' "$fname" "$out"
}

while IFS= read -r FILE; do
  [ -n "$FILE" ] || continue
  # Only lines this PR ADDS, so an untouched GRANT already sitting in a file
  # this PR merely edits elsewhere is not re-flagged as new.
  ADDED_LINES=$(git diff "${BASE_REF}...${HEAD_REF}" -- "$FILE" | grep -E '^\+[^+]' | sed 's/^\+//') || true
  [ -n "$ADDED_LINES" ] || continue

  # Statement-oriented, not line-oriented. A GRANT wrapped across several lines
  # never shows its keywords together on any single input line, so a
  # line-at-a-time scan reports PASS on it and says nothing at all. Join the
  # added lines, drop line comments, collapse whitespace, split on ';'.
  BUFFER=$(printf '%s\n' "$ADDED_LINES" | sed 's/--.*$//' | tr '\n' ' ' | tr -s '[:space:]' ' ')

  while IFS= read -r STMT; do
    [ -n "$STMT" ] || continue
    LOWER=$(printf '%s' "$STMT" | tr '[:upper:]' '[:lower:]' | tr -s ' ')
    # ENTRY FILTER. ALL and ALL PRIVILEGES confer EXECUTE on a function
    # exactly as EXECUTE does, so both spellings come in here. What keeps a
    # table grant written with ALL out of the results is the object-type
    # classification below, not this line.
    printf '%s' "$LOWER" | grep -Eq 'grant[[:space:]]+(execute|all)[[:space:]]' || continue
    printf '%s' "$LOWER" | grep -Eq '[[:space:]]to[[:space:]]' || continue

    # Everything after the LAST " to ", minus a trailing WITH GRANT OPTION.
    GRANTEES=$(printf '%s' "$LOWER" | sed -E 's/.*[[:space:]]to[[:space:]]+//; s/[[:space:]]+with[[:space:]]+grant[[:space:]]+option.*//')

    # Classify the target. BLANKET forms carry no signature, so no allowlist
    # entry can ever cover them and they are always refused.
    TARGETS=""
    BLANKET=""
    if printf '%s' "$LOWER" | grep -Eq 'alter[[:space:]]+default[[:space:]]+privileges'; then
      # The object type MUST be checked here. This branch used to fire on the
      # phrase alone, which was safe only while EXECUTE was the only way in,
      # because GRANT EXECUTE ON TABLES is not valid SQL and so could never
      # reach it. ALL can, and defaulting privileges on TABLES is legal SQL
      # this scan has no opinion about.
      if printf '%s' "$LOWER" | grep -Eq 'on[[:space:]]+(functions|procedures|routines)[[:space:]]'; then
        BLANKET="ALTER DEFAULT PRIVILEGES ... GRANT ON FUNCTIONS"
      else
        continue
      fi
    elif printf '%s' "$LOWER" | grep -Eq 'on[[:space:]]+all[[:space:]]+(functions|procedures|routines)[[:space:]]+in[[:space:]]+schema'; then
      BLANKET="GRANT ON ALL FUNCTIONS IN SCHEMA"
    elif printf '%s' "$LOWER" | grep -Eq 'on[[:space:]]+(function|procedure|routine)[[:space:]]'; then
      TARGETS=$(printf '%s' "$LOWER" \
        | sed -E 's/.*[[:space:]]on[[:space:]]+(function|procedure|routine)[[:space:]]+//' \
        | grep -Eo '[a-z0-9_."]+\([^)]*\)' || true)
      if [ -z "$TARGETS" ]; then
        BLANKET="GRANT EXECUTE ON FUNCTION (no signature written)"
      fi
    else
      continue
    fi

    IFS=',' read -ra GRANTEE_LIST <<< "$GRANTEES"
    for RAW in ${GRANTEE_LIST[@]+"${GRANTEE_LIST[@]}"}; do
      G=$(printf '%s' "$RAW" | tr -d '[:space:]' | tr -d '"')
      [ -n "$G" ] || continue
      if [ "$G" = "public" ]; then
        GRANTEE_NORM="PUBLIC"
      elif [ "$G" = "anon" ]; then
        GRANTEE_NORM="anon"
      else
        continue
      fi

      if [ -n "$BLANKET" ]; then
        ROW="${BLANKET}"$'\t'"${GRANTEE_NORM}"
        VIOLATIONS+=("${FILE}"$'\t'"${ROW}")
        echo "REFUSED: ${FILE}: ${ROW}"
        continue
      fi

      while IFS= read -r RAWSIG; do
        [ -n "$RAWSIG" ] || continue
        SIG=$(printf '%s' "$RAWSIG" | sed -E 's/^public\.//; s/"//g' | tr -s ' ')
        SIG_STRIPPED=$(strip_param_names "$SIG")
        ROW="${SIG}"$'\t'"${GRANTEE_NORM}"
        ROW_STRIPPED="${SIG_STRIPPED}"$'\t'"${GRANTEE_NORM}"
        if printf '%s\n' "$ALLOWLIST" | grep -Fxq -- "$ROW" \
          || printf '%s\n' "$ALLOWLIST" | grep -Fxq -- "$ROW_STRIPPED"; then
          ALLOWED_HITS=$((ALLOWED_HITS + 1))
          echo "allowed: ${FILE}: ${ROW}"
        else
          VIOLATIONS+=("${FILE}"$'\t'"${ROW}")
          echo "REFUSED: ${FILE}: ${ROW}"
        fi
      done <<< "$TARGETS"
    done
  done <<< "$(printf '%s' "$BUFFER" | tr ';' '\n')"
done <<< "$CHANGED_FILES"

{
  echo "## SECURITY DEFINER EXECUTE grants, migration diff scan"
  echo
  echo "Migration files changed: $(printf '%s\n' "$CHANGED_FILES" | grep -c .)."
  echo "Allowlisted grants added: ${ALLOWED_HITS}. Refused grants added: ${#VIOLATIONS[@]}."
  if [ "${#VIOLATIONS[@]}" -gt 0 ]; then
    echo
    echo "| file | function | grantee |"
    echo "| --- | --- | --- |"
    for V in "${VIOLATIONS[@]}"; do
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
} >> "${GITHUB_STEP_SUMMARY:-/dev/stdout}"

if [ "${#VIOLATIONS[@]}" -gt 0 ]; then
  echo "::error::VIOLATION: ${#VIOLATIONS[@]} unallowlisted anon or PUBLIC EXECUTE grant(s) added on SECURITY DEFINER functions in this pull request's migrations."
  exit 1
fi

echo "PASS: scanned $(printf '%s\n' "$CHANGED_FILES" | grep -c .) changed migration file(s); ${ALLOWED_HITS} allowlisted grant(s) added; no unallowlisted anon or PUBLIC EXECUTE."
exit 0
