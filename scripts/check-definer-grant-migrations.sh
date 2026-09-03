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
# WHAT THIS CANNOT CATCH, AND WHY THE LIVE CHECK STILL HAS TO RUN
# CREATE FUNCTION defaults EXECUTE to PUBLIC, and CREATE OR REPLACE resets it
# to PUBLIC even after a clean revoke, with no GRANT line anywhere in the
# migration that changed it. A text scan of the diff cannot see that: there is
# nothing to find. That drift only shows up by reading the live catalog, which
# is what check-definer-grants.sh is for. Keep both.
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

while IFS= read -r FILE; do
  [ -n "$FILE" ] || continue
  # Only lines this PR ADDS, so an untouched GRANT already sitting in a file
  # this PR merely edits elsewhere is not re-flagged as new.
  ADDED_LINES=$(git diff "${BASE_REF}...${HEAD_REF}" -- "$FILE" | grep -E '^\+[^+]' | sed 's/^\+//') || true
  [ -n "$ADDED_LINES" ] || continue

  while IFS= read -r LINE; do
    [ -n "$LINE" ] || continue
    # Normalise: collapse whitespace, drop a schema qualifier, uppercase the
    # keywords only (grep -io below does the case-insensitive match).
    NORMALISED=$(printf '%s' "$LINE" | tr -s '[:space:]' ' ')
    if printf '%s' "$NORMALISED" | grep -Eqio 'grant[[:space:]]+execute[[:space:]]+on[[:space:]]+function[[:space:]]+[a-z0-9_.\"]+\([^)]*\)[[:space:]]+to[[:space:]]+[a-z0-9_, ]+'; then
      MATCH=$(printf '%s' "$NORMALISED" | grep -Eio 'grant[[:space:]]+execute[[:space:]]+on[[:space:]]+function[[:space:]]+[a-z0-9_.\"]+\([^)]*\)[[:space:]]+to[[:space:]]+[a-z0-9_, ]+' | head -n1)
      SIG=$(printf '%s' "$MATCH" | grep -Eio '[a-z0-9_.\"]+\([^)]*\)' | head -n1 | sed 's/^public\.//i' | tr -s ' ')
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
        ROW="${SIG}"$'\t'"${GRANTEE_NORM}"
        if printf '%s\n' "$ALLOWLIST" | grep -Fxq -- "$ROW"; then
          ALLOWED_HITS=$((ALLOWED_HITS + 1))
          echo "allowed: ${FILE}: ${ROW}"
        else
          VIOLATIONS+=("${FILE}"$'\t'"${ROW}")
          echo "REFUSED: ${FILE}: ${ROW}"
        fi
      done
    fi
  done <<< "$ADDED_LINES"
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
