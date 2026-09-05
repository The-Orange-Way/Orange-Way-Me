#!/usr/bin/env bash
#
# Compensating check for OWM-T0497. Reads a LIVE database and refuses any
# table in schema public that grants a privilege to anon or to PUBLIC unless
# that exact (table, privilege) pair is on the allowlist below.
#
# WHY THIS EXISTS EVEN THOUGH THE TABLE GRANTS ARE ALREADY NARROWED
# OWM-T0491 narrowed the `postgres` default-privilege row for schema public, so
# every table created by a migration in this repo now arrives with no anon
# entry. But there is a second default-privilege row, owned by supabase_admin,
# that this project cannot narrow (verified 2026-09-01: revoking from it
# raises 42501, permission denied to change default privileges; our role has
# no membership in supabase_admin). A table created through any path that
# runs as supabase_admin, the hosted SQL editor being the obvious one, still
# arrives with anon=arwdDxtm. Nothing in this repo creates tables that way
# today, so this is a detective control for a hole that cannot be closed at
# the source, not a redundant check on one that already is.
#
# THE TWO DELIBERATE EXCEPTIONS
#   app_flags          anon SELECT   the runtime flag read (fails closed if
#                                    removed, see OW-T0139: an app_flags row
#                                    absence is read as "flag off", so losing
#                                    this grant silently disables features
#                                    rather than erroring loudly)
#   beta_applications  anon INSERT   the public beta signup form
# Both are read-or-insert only, never anything wider, and both are checked by
# exact privilege, not just presence of a grant on that table.
#
# OUTCOMES, same convention as scripts/check-definer-grants.sh, because a
# check that reports "I could not look" as a pass manufactures confidence:
#   exit 0  PASS          examined N tables, nothing outside the allowlist
#   exit 1  VIOLATION     at least one unallowlisted anon or PUBLIC grant
#   exit 2  CANNOT CHECK  no credential, unreachable API, unreadable answer,
#                         or zero tables examined
#
# The credential is SUPABASE_ACCESS_TOKEN from the calling job's GitHub
# Environment (dev). It is read only here: the only statement sent is the
# SELECT below.

set -uo pipefail

cannot_check() {
  echo "::error::CANNOT CHECK: $1"
  echo "This run did not evaluate the database. That is not a pass; fix the cause and run it again." >&2
  exit 2
}

for BIN in curl jq; do
  command -v "$BIN" >/dev/null 2>&1 || cannot_check "${BIN} is not available on this runner"
done

# The project to inspect, named by the caller. No default, on purpose, for the
# same reason check-definer-grants.sh has none: a default would let a run
# silently inspect the wrong project and report a pass under the wrong
# heading.
PROJECT_REF="${OW_ANON_GRANT_PROJECT_REF:-}"
if [ -z "$PROJECT_REF" ]; then
  cannot_check "no project ref was given. Set OW_ANON_GRANT_PROJECT_REF to the Supabase project this run is meant to inspect."
fi
API_URL="https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query"

# Allowlist, exact table<TAB>privilege<TAB>grantee triples. PUBLIC is never
# allowlisted for anything here: PUBLIC is broader than anon and a PUBLIC
# grant appearing on a table is itself a violation, not a wider version of an
# approved one.
DEV_PROJECT_REF='bogmoovbjpvcvdqrmjgt'
ALLOWLIST=$'app_flags\tSELECT\tanon\nbeta_applications\tINSERT\tanon'

case "$PROJECT_REF" in
  "$DEV_PROJECT_REF") : ;;
  *)
    ALLOWLIST=''
    echo "::notice::Project ${PROJECT_REF} is not the known Orange Way Me dev project, so no allowlist applies and every anon or PUBLIC grant found will be refused."
    ;;
esac

if [ -z "${SUPABASE_ACCESS_TOKEN:-}" ]; then
  cannot_check "SUPABASE_ACCESS_TOKEN is empty. The job binds to the 'dev' GitHub Environment, which holds it. A run with no access to that secret cannot check anything and must not report green."
fi

SQL=$(cat <<'ENDSQL'
with acl as (
  select c.relname,
         coalesce(c.relacl, acldefault('r', c.relowner)) as acl
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r'
),
grants as (
  select a.relname,
         a2.privilege_type,
         case when a2.grantee = 0 then 'PUBLIC'
              else (select r.rolname from pg_roles r where r.oid = a2.grantee) end as grantee
    from acl a
    cross join lateral aclexplode(a.acl) a2
   where a2.grantee = 0
      or exists (select 1 from pg_roles r where r.oid = a2.grantee and r.rolname = 'anon')
)
select json_build_object(
  'table_total', (select count(*) from acl),
  'grants', coalesce((select json_agg(json_build_object('relname', relname, 'privilege', privilege_type, 'grantee', grantee) order by relname, privilege_type) from grants), '[]'::json)
) as report;
ENDSQL
)

PAYLOAD=$(jq -n --arg q "$SQL" '{query: $q}') || cannot_check "could not build the request body with jq"

BODY_FILE=$(mktemp)
trap 'rm -f "$BODY_FILE"' EXIT

HTTP_CODE=$(curl -sS --max-time 60 -o "$BODY_FILE" -w '%{http_code}' \
  -X POST "$API_URL" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  --data-binary "$PAYLOAD")
CURL_RC=$?

if [ "$CURL_RC" -ne 0 ]; then
  cannot_check "curl exited ${CURL_RC} talking to the management API for project ${PROJECT_REF}"
fi

case "$HTTP_CODE" in
  2??) ;;
  *)
  echo "First 400 bytes of the response, for diagnosis:"
  head -c 400 "$BODY_FILE" || true
  echo
  cannot_check "the query returned HTTP ${HTTP_CODE} for project ${PROJECT_REF}"
  ;;
esac

REPORT=$(jq -c '.[0].report // empty' "$BODY_FILE" 2>/dev/null)
[ -n "$REPORT" ] || cannot_check "the response did not contain the expected report object"

TABLE_TOTAL=$(printf '%s' "$REPORT" | jq -r '.table_total // empty')
case "$TABLE_TOTAL" in
  '' | *[!0-9]*) cannot_check "table_total is missing or is not a number in the response" ;;
esac

# Zero is not a clean database, it is a query that examined nothing. This repo
# has tables in public and always will, so zero means the schema filter, the
# project ref or the credential scope is wrong.
if [ "$TABLE_TOTAL" -eq 0 ]; then
  cannot_check "zero tables found in schema public on ${PROJECT_REF}; the query examined nothing rather than finding a clean database"
fi

printf '%s' "$REPORT" | jq -e '.grants | type == "array"' >/dev/null 2>&1 \
  || cannot_check "the response for ${PROJECT_REF} carries no grants array, so this run established nothing about anon or PUBLIC grants"

GRANT_ROWS=$(printf '%s' "$REPORT" | jq -r '.grants[] | "\(.relname)\t\(.privilege)\t\(.grantee)"') \
  || cannot_check "could not read the grants list out of the response for ${PROJECT_REF}"

VIOLATIONS=()
ALLOWED_HITS=0
while IFS= read -r ROW; do
  [ -n "$ROW" ] || continue
  if printf '%s\n' "$ALLOWLIST" | grep -Fxq -- "$ROW"; then
    ALLOWED_HITS=$((ALLOWED_HITS + 1))
    printf 'allowed: %s\n' "$ROW"
  else
    VIOLATIONS+=("$ROW")
    printf 'REFUSED: %s\n' "$ROW"
  fi
done <<< "$GRANT_ROWS"

{
  echo "## anon/PUBLIC table grants, project ${PROJECT_REF}"
  echo
  echo "Examined **${TABLE_TOTAL}** table(s) in schema \`public\`."
  echo "Allowlisted grants: ${ALLOWED_HITS}. Refused grants: ${#VIOLATIONS[@]}."
  if [ "${#VIOLATIONS[@]}" -gt 0 ]; then
    echo
    echo "| table | privilege | grantee |"
    echo "| --- | --- | --- |"
    for V in "${VIOLATIONS[@]}"; do
      IFS=$'\t' read -r T P G <<< "$V"
      printf '| `%s` | `%s` | `%s` |\n' "$T" "$P" "$G"
    done
    echo
    echo "Each one needs a tracked revoke migration, or an allowlist entry in"
    echo "\`scripts/check-anon-table-grants.sh\` naming why anon or PUBLIC must reach it."
  fi
} >> "${GITHUB_STEP_SUMMARY:-/dev/stdout}"

if [ "${#VIOLATIONS[@]}" -gt 0 ]; then
  echo "::error::VIOLATION: ${#VIOLATIONS[@]} unallowlisted anon or PUBLIC grant(s) on tables in public on ${PROJECT_REF}."
  exit 1
fi

echo "PASS: examined ${TABLE_TOTAL} table(s) on ${PROJECT_REF}; ${ALLOWED_HITS} allowlisted grant(s); no unallowlisted anon or PUBLIC grant."
exit 0
