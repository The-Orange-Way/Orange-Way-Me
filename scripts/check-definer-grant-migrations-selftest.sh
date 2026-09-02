#!/usr/bin/env bash
#
# Proves check-definer-grant-migrations.sh actually refuses what it must,
# instead of trusting that it does because nobody has watched it fail. Builds
# a throwaway git repo with a base commit and three candidate head commits,
# and asserts each one gets the exit code it should:
#   1) a migration that adds GRANT EXECUTE ... TO anon on a function NOT on
#      the allowlist                          -> must exit 1 (VIOLATION)
#   2) a migration that adds GRANT EXECUTE ... TO PUBLIC on the SAME function
#      the allowlist permits only for anon     -> must exit 1 (VIOLATION,
#      because PUBLIC is never allowlisted even where anon is)
#   3) a migration that adds GRANT EXECUTE ... TO anon on a function that IS
#      on the allowlist, plus an unrelated migration with no grant at all
#                                               -> must exit 0 (PASS)
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

# Case 1: unallowlisted anon grant must be refused.
git checkout -q -b case1 main
cat > supabase/migrations/0002_bad_anon.sql <<'SQL'
GRANT EXECUTE ON FUNCTION public.some_definer_fn(uuid) TO anon;
SQL
git add -A
git commit -q -m "case1"
check_case "unallowlisted anon grant" 1 "$(git rev-parse HEAD)"
git checkout -q main

# Case 2: PUBLIC grant on an otherwise-allowlisted function must still be refused.
git checkout -q -b case2 main
cat > supabase/migrations/0002_bad_public.sql <<'SQL'
GRANT EXECUTE ON FUNCTION is_invite_code_valid(text) TO PUBLIC;
SQL
git add -A
git commit -q -m "case2"
check_case "PUBLIC grant on allowlisted-for-anon function" 1 "$(git rev-parse HEAD)"
git checkout -q main

# Case 3: an allowlisted anon grant, plus an unrelated migration with no
# grant at all, must pass clean.
git checkout -q -b case3 main
cat > supabase/migrations/0002_ok_allowlisted.sql <<'SQL'
GRANT EXECUTE ON FUNCTION is_invite_code_valid(text) TO anon;
SQL
cat > supabase/migrations/0003_unrelated.sql <<'SQL'
CREATE INDEX IF NOT EXISTS idx_selftest ON some_table (some_column);
SQL
git add -A
git commit -q -m "case3"
check_case "allowlisted grant plus unrelated migration" 0 "$(git rev-parse HEAD)"
git checkout -q main

if [ "$FAILURES" -gt 0 ]; then
  echo "::error::${FAILURES} self-test case(s) did not get the exit code they should. The gate cannot be trusted until this is green."
  exit 1
fi

echo "PASS: all self-test cases got the exit code they should."
exit 0
