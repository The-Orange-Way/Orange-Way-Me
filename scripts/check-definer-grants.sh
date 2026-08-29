#!/usr/bin/env bash
#
# SECURITY DEFINER EXECUTE grant gate, read from a LIVE database. Which project
# it reads is named by the caller through OW_DEFINER_PROJECT_REF. The workflow
# runs it twice, as two separate jobs bound to two separate GitHub Environments:
# once against dev and once against production.
#
# WHAT IT REFUSES
# Any SECURITY DEFINER function in the `public` schema of the named Orange Way Me
# project that carries EXECUTE for `anon` or for `PUBLIC` and is not on that
# project's allowlist below. A SECURITY DEFINER function runs with its owner's rights, so
# such a grant is a hole through row level security.
#
# WHY IT READS A LIVE DATABASE AND NOT THE MIGRATION FILES
# CREATE FUNCTION defaults EXECUTE to PUBLIC, and a later CREATE OR REPLACE
# resets it to PUBLIC even after a clean revoke. So the grant arrives with no
# migration file anywhere asking for it, and a scan of the files reads green
# over a wide open database even when every migration looks correct. That is
# why this gate reads the live grants instead of trusting the files.
#
# TWO SUBTLETIES THIS QUERY HANDLES, AND A NAIVE ONE DOES NOT
# 1. `pg_proc.proacl` is NULL when nobody has touched the grants, and NULL means
#    the DEFAULT acl, which for a function is EXECUTE to PUBLIC. aclexplode(NULL)
#    returns no rows, so reading proacl directly misses the commonest case of
#    all. We coalesce to acldefault('f', proowner) first.
# 2. `anon` is resolved through pg_roles rather than cast with 'anon'::regrole,
#    because the cast raises on a database where that role does not exist, and a
#    gate that dies on an unrelated cast is a gate that stopped checking.
#
# OUTCOMES, deliberately worded differently, because a check that reports
# "I could not look" as a pass manufactures confidence:
#   exit 0  PASS          examined N functions, nothing outside the allowlist
#   exit 1  VIOLATION     at least one unallowlisted anon or PUBLIC EXECUTE
#   exit 2  CANNOT CHECK  no credential, unreachable API, unreadable answer, or
#                         zero functions examined
#
# The credential is SUPABASE_ACCESS_TOKEN from the calling job's GitHub
# Environment, `dev` or `prod`, the same per environment secret the edge function
# deploy already uses (.github/workflows/deploy-supabase-functions.yml). Each
# environment holds its own token, so a dev run never has the production
# credential in scope and a production run never has dev's. It is read only
# here: the only statement sent is the SELECT below.

set -uo pipefail

cannot_check() {
  echo "::error::CANNOT CHECK: $1"
  echo "This run did not evaluate the database. That is not a pass; fix the cause and run it again." >&2
  exit 2
}

for BIN in curl jq; do
  command -v "$BIN" >/dev/null 2>&1 || cannot_check "${BIN} is not available on this runner"
done

# The project to inspect, named by the caller. There is deliberately NO default.
# A default would mean a production job whose ref never reached it would quietly
# inspect dev and report a pass under a production heading, which is exactly the
# silent success shape this gate exists to refuse. OW_DEV_PROJECT_REF is still
# read so an older manual invocation keeps working.
PROJECT_REF="${OW_DEFINER_PROJECT_REF:-${OW_DEV_PROJECT_REF:-}}"
if [ -z "$PROJECT_REF" ]; then
  cannot_check "no project ref was given. Set OW_DEFINER_PROJECT_REF to the Supabase project this run is meant to inspect. This script has no default on purpose: a default would inspect dev while reporting under whatever heading the caller intended."
fi
API_URL="https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query"

# Allowlist, exact `signature<TAB>grantee` pairs, and it is PER PROJECT rather
# than shared. A pre-auth callsite that justifies anon EXECUTE on dev does not
# automatically justify it on production, and one shared list would let a dev
# exemption silently cover production drift. Both projects allow the same two
# functions today; if that ever stops being true, give them separate lists here
# rather than widening one list for both.
#
# Both entries have a verified pre-auth callsite, which is the only thing that
# can justify anon reaching a definer function at all:
#   is_invite_code_valid(text)        called from the join page before sign in
#   is_email_in_beta_allowlist(text)  called from the auth screen before sign in
#
# PUBLIC is deliberately NOT allowlisted for either of them, on either project.
# PUBLIC is broader than anon, and a PUBLIC grant reappearing on one of these is
# exactly the CREATE OR REPLACE drift described above.
#
# To add an entry you must name the pre-auth callsite in the same change. If you
# cannot name one, the answer is a revoke, not an allowlist entry.
DEV_PROJECT_REF='bogmoovbjpvcvdqrmjgt'
PROD_PROJECT_REF='tmqjusxxjjcsdgyiqbcg'
PRE_AUTH_ALLOWLIST=$'is_invite_code_valid(text)\tanon\nis_email_in_beta_allowlist(text)\tanon'

case "$PROJECT_REF" in
  "$DEV_PROJECT_REF")  ALLOWLIST="$PRE_AUTH_ALLOWLIST" ;;
  "$PROD_PROJECT_REF") ALLOWLIST="$PRE_AUTH_ALLOWLIST" ;;
  *)
    # An unrecognised ref is a deliberate manual run. It gets NO exemptions:
    # refusing everything it finds is the safe direction, and the run says so
    # rather than leaving the reader to assume the usual list applied.
    ALLOWLIST=''
    echo "::notice::Project ${PROJECT_REF} is not one of the two known Orange Way Me projects, so no allowlist applies and every anon or PUBLIC EXECUTE found will be refused."
    ;;
esac

if [ -z "${SUPABASE_ACCESS_TOKEN:-}" ]; then
  cannot_check "SUPABASE_ACCESS_TOKEN is empty. Each job binds to its own GitHub Environment, 'dev' or 'prod', which holds it. A run with no access to that secret cannot check anything and must not report green."
fi

SQL=$(cat <<'ENDSQL'
with defs as (
  select p.oid,
         p.oid::regprocedure::text as sig,
         coalesce(p.proacl, acldefault('f', p.proowner)) as acl
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.prosecdef
),
offenders as (
  select d.sig,
         case when a.grantee = 0 then 'PUBLIC'
              else (select r.rolname from pg_roles r where r.oid = a.grantee) end as grantee
    from defs d
    cross join lateral aclexplode(d.acl) a
   where a.privilege_type = 'EXECUTE'
     and (a.grantee = 0
          or exists (select 1 from pg_roles r where r.oid = a.grantee and r.rolname = 'anon'))
)
select json_build_object(
  'definer_total', (select count(*) from defs),
  'definer_sigs',  coalesce((select json_agg(sig order by sig) from defs), '[]'::json),
  'offenders',     coalesce((select json_agg(json_build_object('sig', sig, 'grantee', grantee) order by sig, grantee) from offenders), '[]'::json)
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

# The management API answers 201 Created, not 200, for a successful POST to
# database/query. Insisting on exactly 200 sent every single run down the
# CANNOT CHECK path, so the gate never read the database at all. Accept any
# 2xx; everything else still refuses loudly rather than reading as a pass.
case "$HTTP_CODE" in
  2??) ;;
  *)
  # The response body carries an API error message, never the token, so it is
  # safe to print and it is the only way to tell a scope problem from an outage.
  echo "First 400 bytes of the response, for diagnosis:"
  head -c 400 "$BODY_FILE" || true
  echo
  cannot_check "the query returned HTTP ${HTTP_CODE} for project ${PROJECT_REF}"
  ;;
esac

REPORT=$(jq -c '.[0].report // empty' "$BODY_FILE" 2>/dev/null)
[ -n "$REPORT" ] || cannot_check "the response did not contain the expected report object"

DEFINER_TOTAL=$(printf '%s' "$REPORT" | jq -r '.definer_total // empty')
case "$DEFINER_TOTAL" in
  '' | *[!0-9]*) cannot_check "definer_total is missing or is not a number in the response" ;;
esac

# Zero is not a clean database, it is a query that examined nothing. This repo
# has SECURITY DEFINER functions in public and always will, so zero means the
# schema filter, the project ref or the credential scope is wrong.
if [ "$DEFINER_TOTAL" -eq 0 ]; then
  cannot_check "zero SECURITY DEFINER functions found in schema public on ${PROJECT_REF}; the query examined nothing rather than finding a clean database"
fi

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
done < <(printf '%s' "$REPORT" | jq -r '.offenders[] | "\(.sig)\t\(.grantee)"')

# An allowlist entry that matches no function on the database is a stale
# exemption: it protects nothing today and it will silently cover a future
# function that happens to take the same signature. Reported, not fatal.
while IFS= read -r ENTRY; do
  [ -n "$ENTRY" ] || continue
  SIG="${ENTRY%%$'\t'*}"
  if ! printf '%s' "$REPORT" | jq -e --arg s "$SIG" '.definer_sigs | index($s) != null' >/dev/null; then
    echo "::notice::Allowlist entry '${SIG}' matches no SECURITY DEFINER function on ${PROJECT_REF}. Remove the stale exemption."
  fi
done <<< "$ALLOWLIST"

{
  echo "## SECURITY DEFINER EXECUTE grants, project ${PROJECT_REF}"
  echo
  echo "Examined **${DEFINER_TOTAL}** SECURITY DEFINER function(s) in schema \`public\`."
  echo "Allowlisted grants: ${ALLOWED_HITS}. Refused grants: ${#VIOLATIONS[@]}."
  if [ "${#VIOLATIONS[@]}" -gt 0 ]; then
    echo
    echo "| function | grantee |"
    echo "| --- | --- |"
    for V in "${VIOLATIONS[@]}"; do
      printf '| `%s` | `%s` |\n' "${V%%$'\t'*}" "${V##*$'\t'}"
    done
    echo
    echo "Each one needs a tracked revoke migration, or an allowlist entry in"
    echo "\`scripts/check-definer-grants.sh\` naming the pre-auth callsite that justifies it."
  fi
} >> "${GITHUB_STEP_SUMMARY:-/dev/stdout}"

if [ "${#VIOLATIONS[@]}" -gt 0 ]; then
  echo "::error::VIOLATION: ${#VIOLATIONS[@]} unallowlisted anon or PUBLIC EXECUTE grant(s) on SECURITY DEFINER functions in public on ${PROJECT_REF}."
  exit 1
fi

echo "PASS: examined ${DEFINER_TOTAL} SECURITY DEFINER function(s) on ${PROJECT_REF}; ${ALLOWED_HITS} allowlisted grant(s); no unallowlisted anon or PUBLIC EXECUTE."
exit 0
