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
# Stub curl. Writes $OW_TEST_BODY to the path given by -o and prints the code.
#
# It also asserts the request itself, not only the response: the URL must
# target OW_TEST_EXPECT_REF (defaulting to OW_DEFINER_PROJECT_REF, the ref the
# gate was actually given), and the request body must carry the public-schema
# filter and the security-definer filter the gate's SQL is supposed to send.
# Without this, all cases would stay green even if the gate started asking a
# different project, or asking the right project the wrong question.
set -u
OUT=""
DATA=""
URL=""
PREV=""
for ARG in "$@"; do
  [ "$PREV" = "-o" ] && OUT="$ARG"
  [ "$PREV" = "--data-binary" ] && DATA="$ARG"
  case "$ARG" in
    https://*) URL="$ARG" ;;
  esac
  PREV="$ARG"
done

if [ -n "${OW_TEST_CURL_RC:-}" ] && [ "${OW_TEST_CURL_RC}" != "0" ]; then
  echo "stub curl: forced transport failure (OW_TEST_CURL_RC=${OW_TEST_CURL_RC})" >&2
  exit "$OW_TEST_CURL_RC"
fi

[ -n "$OUT" ] || { echo "stub curl: no -o argument" >&2; exit 9; }

EXPECT_REF="${OW_TEST_EXPECT_REF:-${OW_DEFINER_PROJECT_REF:-}}"
if [ -n "$EXPECT_REF" ] && [[ "$URL" != *"$EXPECT_REF"* ]]; then
  echo "stub curl: request URL '${URL}' does not target expected ref '${EXPECT_REF}'" >&2
  exit 9
fi

if [[ "$DATA" != *"nspname = 'public'"* ]] || [[ "$DATA" != *"p.prosecdef"* ]]; then
  echo "stub curl: request body is missing the public-schema or security-definer filter" >&2
  exit 9
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
  local NAME="$1" WANT="$2" BODY="$3" EXTRA="${4:-}"
  local OUT RC
  OUT=$(
    PATH="${WORK}/bin:${PATH}" \
    SUPABASE_ACCESS_TOKEN='stub-token-not-a-real-credential' \
    OW_DEFINER_PROJECT_REF="$DEV_REF" \
    OW_TEST_BODY="$BODY" \
    GITHUB_STEP_SUMMARY="${WORK}/summary.md" \
    ${EXTRA:+$EXTRA} \
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

# 8. The pre-existing guards, asserted here so a later edit cannot quietly
#    remove them.
run_case 'zero functions is CANNOT CHECK' 2 \
  "$(body "{\"definer_total\":0,\"definer_sigs\":[],\"offenders\":[]}")"

run_case 'no report object is CANNOT CHECK' 2 '[{"not_a_report":1}]'

# 10. A non-zero curl exit (DNS failure, timeout, connection refused) must
#     refuse, not silently treat a stub-shaped absence of output as clean.
#     This is the branch at check-definer-grants.sh lines 146-148, never
#     observed firing until now because the stub always returned rc 0.
run_case 'curl transport failure is CANNOT CHECK' 2 \
  "$(body "{\"definer_total\":3,\"definer_sigs\":${SIGS},\"offenders\":[]}")" \
  'OW_TEST_CURL_RC=7'

# 11. A non-2xx HTTP status (expired token, wrong scope, revoked credential)
#     must refuse. This is the branch at lines 154-164, and it is the one the
#     2xx widening in PR #489 touched directly: nothing before this proved
#     that widening did not also swallow a genuine failure status.
run_case 'non-2xx http status is CANNOT CHECK' 2 \
  "$(body "{\"definer_total\":3,\"definer_sigs\":${SIGS},\"offenders\":[]}")" \
  'OW_TEST_HTTP_CODE=401'

# 12. The suite must also prove it would notice the gate asking the wrong
#     question: the stub refuses a request that does not target the given
#     project ref, or whose body drops the public-schema or security-definer
#     filter. This case forces that mismatch on purpose, so the assertion
#     itself is proven able to fire rather than sitting there unexercised.
run_case 'stub catches a request aimed at the wrong project ref' 2 \
  "$(body "{\"definer_total\":3,\"definer_sigs\":${SIGS},\"offenders\":[]}")" \
  'OW_TEST_EXPECT_REF=not-the-real-project-ref'

echo
if [ "$FAILURES" -gt 0 ]; then
  echo "${FAILURES} case(s) failed."
  exit 1
fi
echo "All cases behaved as required."
exit 0
