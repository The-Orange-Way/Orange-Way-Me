#!/usr/bin/env bash
#
# Self test for scripts/check-definer-grants.sh.
#
# WHY IT EXISTS. The gate's whole argument is that it refuses to report "I could
# not look" as a pass. That property was never observed firing. This drives the
# real script, unmodified, through synthetic API responses and asserts the exit
# code each one must produce.
#
# HOW IT INTERCEPTS THE API. A stub `curl` is placed first on PATH. It writes the
# synthetic body to the file named by -o and prints the HTTP code, which is
# exactly the contract the gate relies on. There is deliberately NO test hook
# inside the gate itself: an env var that let a caller supply the response body
# would be a way to fabricate a PASS on a database nobody read.
#
# WIDENED 2026-09-05 (OWM-T0366). Two refusal paths had no case: a curl
# transport failure (the stub always exited 0, so CURL_RC was always 0), and
# a non-2xx HTTP status (the stub already honoured OW_TEST_HTTP_CODE, but no
# case ever set it). Both are covered now. The suite also asserted nothing
# about the request itself: nothing checked the URL carried the right
# project ref, or that the SQL body still filtered on the public schema and
# on security-definer functions. The stub now asserts both against
# OW_TEST_ASSERT_REF on every case (default: the real dev ref, so the gate's
# own request is proven correct on every run), and one case deliberately
# supplies a wrong expected ref to prove the assertion can actually fire.
#
# Exit 0 means every case behaved as required. Exit 1 names the ones that did not.

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GATE="${HERE}/check-definer-grants.sh"
[ -f "$GATE" ] || { echo "cannot find ${GATE}"; exit 1; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

mkdir -p "${WORK}/bin"
cat > "${WORK}/bin/curl" <<'STUB'
#!/usr/bin/env bash
# Stub curl. Writes $OW_TEST_BODY to the path given by -o and prints the
# HTTP code, exactly the contract the gate relies on. Two more env hooks:
#   OW_TEST_CURL_RC    if set and non-zero, exit with that code BEFORE
#                      writing anything, simulating a transport failure
#                      (timeout, DNS, connection refused) rather than an
#                      HTTP-level response.
#   OW_TEST_ASSERT_REF if set, the request actually made is checked: the
#                      URL must contain this value, and the POSTed body
#                      must still carry the gate's public-schema filter and
#                      its security-definer filter. A mismatch is a stub
#                      failure (exit 8), never a silent pass.
OUT=""
URL=""
PAYLOAD=""
PREV=""
for ARG in "$@"; do
  case "$PREV" in
    -o) OUT="$ARG" ;;
    --data-binary) PAYLOAD="$ARG" ;;
  esac
  case "$ARG" in
    https://*) URL="$ARG" ;;
  esac
  PREV="$ARG"
done
[ -n "$OUT" ] || { echo "stub curl: no -o argument" >&2; exit 9; }

if [ -n "${OW_TEST_ASSERT_REF:-}" ]; then
  case "$URL" in
    *"$OW_TEST_ASSERT_REF"*) ;;
    *) echo "stub curl: request URL does not carry the expected ref '${OW_TEST_ASSERT_REF}': ${URL}" >&2; exit 8 ;;
  esac
  case "$PAYLOAD" in
    *"nspname = 'public'"*) ;;
    *) echo "stub curl: request body is missing the public-schema filter" >&2; exit 8 ;;
  esac
  case "$PAYLOAD" in
    *"prosecdef"*) ;;
    *) echo "stub curl: request body is missing the security-definer filter" >&2; exit 8 ;;
  esac
fi

if [ -n "${OW_TEST_CURL_RC:-}" ] && [ "${OW_TEST_CURL_RC}" != "0" ]; then
  exit "${OW_TEST_CURL_RC}"
fi

printf '%s' "$OW_TEST_BODY" > "$OUT"
printf '%s' "${OW_TEST_HTTP_CODE:-201}"
STUB
chmod +x "${WORK}/bin/curl"

DEV_REF='bogmoovbjpvcvdqrmjgt'

# Every body is the shape the gate parses: a one element array whose element
# carries a `report` object.
body() { printf '[{"report":%s}]' "$1"; }

FAILURES=0
run_case() {
  local NAME="$1" WANT="$2" BODY="$3"
  local CURLRC="${4:-0}" HTTPCODE="${5:-}" ASSERTREF="${6:-$DEV_REF}"
  local OUT RC
  OUT=$(
    PATH="${WORK}/bin:${PATH}" \
    SUPABASE_ACCESS_TOKEN='stub-token-not-a-real-credential' \
    OW_DEFINER_PROJECT_REF="$DEV_REF" \
    OW_TEST_BODY="$BODY" \
    OW_TEST_CURL_RC="$CURLRC" \
    OW_TEST_HTTP_CODE="$HTTPCODE" \
    OW_TEST_ASSERT_REF="$ASSERTREF" \
    GITHUB_STEP_SUMMARY="${WORK}/summary.md" \
    bash "$GATE" 2>&1
  )
  RC=$?
  if [ "$RC" -eq "$WANT" ]; then
    printf 'ok    %-46s exit %s\n' "$NAME" "$RC"
  else
    FAILURES=$((FAILURES + 1))
    printf 'FAIL  %-46s exit %s, expected %s\n' "$NAME" "$RC" "$WANT"
    printf '%s\n' "$OUT" | sed 's/^/        /'
  fi
}

SIGS='["is_invite_code_valid(text)","is_email_in_beta_allowlist(text)","some_other_fn()"]'

# 1. Clean database: functions examined, no anon or PUBLIC EXECUTE anywhere.
run_case 'clean database passes' 0 \
  "$(body "{\"definer_total\":3,\"definer_sigs\":${SIGS},\"offenders\":[]}")"

# 2. Only allowlisted pre-auth grants. Still a pass, and this is what stops a
#    script that refused everything from faking a green suite.
run_case 'allowlisted anon grants pass' 0 \
  "$(body "{\"definer_total\":3,\"definer_sigs\":${SIGS},\"offenders\":[{\"sig\":\"is_invite_code_valid(text)\",\"grantee\":\"anon\"}]}")"

# 3. A real violation must be refused with exit 1, not merely reported.
run_case 'unallowlisted anon grant is refused' 1 \
  "$(body "{\"definer_total\":3,\"definer_sigs\":${SIGS},\"offenders\":[{\"sig\":\"some_other_fn()\",\"grantee\":\"anon\"}]}")"

# 4. PUBLIC is never allowlisted, not even on an otherwise allowlisted function.
run_case 'PUBLIC on an allowlisted fn is refused' 1 \
  "$(body "{\"definer_total\":3,\"definer_sigs\":${SIGS},\"offenders\":[{\"sig\":\"is_invite_code_valid(text)\",\"grantee\":\"PUBLIC\"}]}")"

# 5. THE REGRESSION THIS FILE WAS WRITTEN FOR. A 2xx whose report carries a
#    valid numeric definer_total but no offenders key at all: an API schema
#    change, a truncated body, or a future rename of the field. Before the fix
#    this exited 0 PASS, having examined nothing for offenders.
run_case 'offenders key missing is CANNOT CHECK' 2 \
  "$(body "{\"definer_total\":3,\"definer_sigs\":${SIGS}}")"

# 6. Same class, one step subtler: the key is present but is not an array, so
#    iterating it yields plausible looking rubbish rather than an error.
run_case 'offenders not an array is CANNOT CHECK' 2 \
  "$(body "{\"definer_total\":3,\"definer_sigs\":${SIGS},\"offenders\":{\"sig\":\"x\"}}")"

# 7. definer_sigs missing would make every allowlist entry look stale. That is
#    an unreadable answer dressed as a finding, so it refuses too.
run_case 'definer_sigs missing is CANNOT CHECK' 2 \
  "$(body '{"definer_total":3,"offenders":[]}')"

# 8 and 9. The pre-existing guards, asserted here so a later edit cannot
#          quietly remove them.
run_case 'zero functions is CANNOT CHECK' 2 \
  "$(body "{\"definer_total\":0,\"definer_sigs\":[],\"offenders\":[]}")"

run_case 'no report object is CANNOT CHECK' 2 '[{"not_a_report":1}]'

# 10. A curl transport failure (timeout, DNS failure, connection refused) never
#     reaches the point of returning an HTTP code at all, so HTTP_CODE stays
#     empty and it is CURL_RC the gate must catch. Before this case, the stub
#     always exited 0 and this branch had never been observed firing.
run_case 'curl transport failure is CANNOT CHECK' 2 \
  "$(body "{\"definer_total\":3,\"definer_sigs\":${SIGS},\"offenders\":[]}")" 7

# 11. A non-2xx HTTP status (expired token, wrong scope, revoked access) must
#     also be CANNOT CHECK. The stub already honoured OW_TEST_HTTP_CODE, but
#     no case ever set it, so the 2xx-widening added for PR #489 had never
#     been driven down its own refusal path.
run_case 'non-2xx HTTP status is CANNOT CHECK' 2 \
  "$(body "{\"definer_total\":3,\"definer_sigs\":${SIGS},\"offenders\":[]}")" 0 401

# 12. Every case above passes OW_TEST_ASSERT_REF defaulted to the real dev
#     ref, so cases 1-11 already prove the gate's own request is correct on
#     every run. This case proves the assertion is not a no-op: it supplies a
#     WRONG expected ref while the gate still talks to the real dev ref, so
#     the stub must catch the mismatch and refuse rather than pass quietly.
run_case 'stub request assertion can itself fail' 2 \
  "$(body "{\"definer_total\":3,\"definer_sigs\":${SIGS},\"offenders\":[]}")" 0 '' 'a-ref-the-request-does-not-carry'

echo
if [ "$FAILURES" -gt 0 ]; then
  echo "${FAILURES} case(s) failed."
  exit 1
fi
echo "All cases behaved as required."
exit 0
