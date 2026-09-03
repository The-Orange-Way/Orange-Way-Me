#!/usr/bin/env bash
#
# Proves check-definer-grant-migrations.sh actually refuses what it must,
# instead of trusting that it does because nobody has watched it fail. Builds
# a throwaway git repo with a base commit and one head commit per case, and
# asserts each one gets the exit code it should.
#
# RULE 1, no new anon or PUBLIC EXECUTE grant:
#   1) a migration that adds GRANT EXECUTE ... TO anon on a function NOT on
#      the policy table                        -> must exit 1 (VIOLATION)
#   2) a migration that adds GRANT EXECUTE ... TO PUBLIC on the SAME function
#      the policy table permits only for anon   -> must exit 1 (VIOLATION,
#      because PUBLIC is never permitted even where anon is)
#   3) a migration that adds GRANT EXECUTE ... TO anon on a function the
#      policy table permits, plus an unrelated migration with no grant at all
#                                               -> must exit 0 (PASS)
#
# RULE 2, a re-created hardened function must re-apply its revoke:
#   4) a migration that re-creates a hardened function and does NOT revoke
#                                               -> must exit 1 (VIOLATION)
#   5) the same re-creation WITH the revoke back -> must exit 0 (PASS)
#   6) the same re-creation revoking PUBLIC but NOT anon
#                                               -> must exit 1 (VIOLATION,
#      because half a revoke leaves anon holding EXECUTE)
#   7) a CREATE OR REPLACE of a function that is NOT on the policy table
#                                               -> must exit 0 (PASS: the rule
#      must not fire on every migration that happens to define a function)
#
# Run from the repo root: bash scripts/check-definer-grant-migrations-selftest.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET="${SCRIPT_DIR}/check-definer-grant-migrations.sh"

WORKDIR=$(mktemp -d)
trap 'rm -rf "$WORKDIR"' EXIT

cd "$WORKDIR"
git init -q -b main
git config user.email "selftest@example.invalid"
git config user.name "selftest"

mkdir -p supabase/migrations
echo "-- base" > supabase/migrations/0001_base.sql
git add -A
git commit -q -m base
BASE_SHA=$(git rev-parse HEAD)

FAILURES=0

check_case() {
  local name="$1" expect="$2" head_sha="$3"
  set +e
  bash "$TARGET" "$BASE_SHA" "$head_sha" >/tmp/selftest-out.$$ 2>&1
  local rc=$?
  set -e
  if [ "$rc" -eq "$expect" ]; then
    echo "ok: ${name} (exit ${rc}, expected ${expect})"
  else
    echo "FAIL: ${name} (exit ${rc}, expected ${expect})"
    cat /tmp/selftest-out.$$
    FAILURES=$((FAILURES + 1))
  fi
  rm -f /tmp/selftest-out.$$
}

# --- RULE 1 -----------------------------------------------------------------

# Case 1: unallowlisted anon grant must be refused.
git checkout -q -b case1 main
cat > supabase/migrations/0002_bad_anon.sql <<'SQL'
GRANT EXECUTE ON FUNCTION public.some_definer_fn(uuid) TO anon;
SQL
git add -A
git commit -q -m "case1"
check_case "rule 1: unallowlisted anon grant" 1 "$(git rev-parse HEAD)"
git checkout -q main

# Case 2: PUBLIC grant on an otherwise-permitted function must still be refused.
git checkout -q -b case2 main
cat > supabase/migrations/0002_bad_public.sql <<'SQL'
GRANT EXECUTE ON FUNCTION is_invite_code_valid(text) TO PUBLIC;
SQL
git add -A
git commit -q -m "case2"
check_case "rule 1: PUBLIC grant on a function permitted only for anon" 1 "$(git rev-parse HEAD)"
git checkout -q main

# Case 3: a permitted anon grant, plus an unrelated migration with no grant at
# all, must pass clean.
git checkout -q -b case3 main
cat > supabase/migrations/0002_ok_allowlisted.sql <<'SQL'
GRANT EXECUTE ON FUNCTION is_invite_code_valid(text) TO anon;
SQL
cat > supabase/migrations/0003_unrelated.sql <<'SQL'
CREATE INDEX IF NOT EXISTS idx_selftest ON some_table (some_column);
SQL
git add -A
git commit -q -m "case3"
check_case "rule 1: permitted grant plus unrelated migration" 0 "$(git rev-parse HEAD)"
git checkout -q main

# --- RULE 2 -----------------------------------------------------------------

# Case 4: a hardened function re-created with no revoke must be refused.
git checkout -q -b case4 main
cat > supabase/migrations/0002_recreate_no_revoke.sql <<'SQL'
BEGIN;
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;
COMMIT;
SQL
git add -A
git commit -q -m "case4"
check_case "rule 2: hardened function re-created with no revoke" 1 "$(git rev-parse HEAD)"
git checkout -q main

# Case 5: the same re-creation WITH the revoke put back must pass.
git checkout -q -b case5 main
cat > supabase/migrations/0002_recreate_with_revoke.sql <<'SQL'
BEGIN;
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, service_role;
COMMIT;
SQL
git add -A
git commit -q -m "case5"
check_case "rule 2: hardened function re-created with its revoke" 0 "$(git rev-parse HEAD)"
git checkout -q main

# Case 6: revoking PUBLIC but not anon is still a violation. PUBLIC and anon
# are separate grantees, so a revoke from PUBLIC alone leaves an explicit anon
# grant standing if one is ever added back.
git checkout -q -b case6 main
cat > supabase/migrations/0002_recreate_half_revoke.sql <<'SQL'
BEGIN;
CREATE OR REPLACE FUNCTION public.purge_expired_old_household_key_wraps()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM public.old_household_key_wraps WHERE expires_at < now();
$$;
REVOKE EXECUTE ON FUNCTION public.purge_expired_old_household_key_wraps() FROM PUBLIC;
COMMIT;
SQL
git add -A
git commit -q -m "case6"
check_case "rule 2: revokes PUBLIC but not anon" 1 "$(git rev-parse HEAD)"
git checkout -q main

# Case 7: CONTROL. A function that is not on the policy table can be created
# and replaced freely. If this case ever goes red the rule is firing on
# everything, which is indistinguishable from working until it blocks an
# unrelated migration.
git checkout -q -b case7 main
cat > supabase/migrations/0002_unrelated_function.sql <<'SQL'
BEGIN;
CREATE OR REPLACE FUNCTION public.some_ordinary_helper(_id uuid)
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT 'ok';
$$;
COMMIT;
SQL
git add -A
git commit -q -m "case7"
check_case "rule 2 control: a function outside the policy table is untouched" 0 "$(git rev-parse HEAD)"
git checkout -q main

if [ "$FAILURES" -gt 0 ]; then
  echo "::error::${FAILURES} self-test case(s) did not get the exit code they should. The gate cannot be trusted until this is green."
  exit 1
fi

echo "PASS: all self-test cases got the exit code they should."
exit 0
