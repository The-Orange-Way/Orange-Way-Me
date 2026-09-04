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
#   4) GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon
#                                               -> must exit 1 (blanket, never
#      allowlistable, because the allowlist is per function signature)
#   5) ALTER DEFAULT PRIVILEGES ... GRANT EXECUTE ON FUNCTIONS TO anon
#                                               -> must exit 1 (same reason)
#   6) the same grant as case 1 wrapped across three lines, which is normal
#      formatting and which a line-at-a-time scan cannot see
#                                               -> must exit 1
#   7) ON PROCEDURE and ON ROUTINE spellings    -> must exit 1
#   8) a comma list of two functions in one statement where the FIRST is
#      allowlisted and the second is not, so a first-match-only scan would
#      pass it                                   -> must exit 1
#   9) GRANT EXECUTE ON FUNCTION f TO anon with no signature written
#                                               -> must exit 1
#  10) an allowlisted grant written with PARAMETER NAMES, which is how
#      production declares the function, against a types-only allowlist entry
#                                               -> must exit 0 (PASS)
#  11) a grant that appears only inside a line comment
#                                               -> must exit 0 (PASS)
#  12) GRANT ALL ON FUNCTION f(args) TO anon    -> must exit 1. EXECUTE is the
#      only privilege a function has, so ALL confers exactly what EXECUTE does
#  13) GRANT ALL PRIVILEGES ON FUNCTION f(args) TO PUBLIC
#                                               -> must exit 1, same reason
#  14) GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO anon
#                                               -> must exit 1 (blanket)
#  15) ALTER DEFAULT PRIVILEGES ... GRANT ALL ON FUNCTIONS TO anon
#                                               -> must exit 1 (blanket)
#  16) ALTER DEFAULT PRIVILEGES ... GRANT ALL ON TABLES TO anon
#                                               -> must exit 0. A table grant
#      is outside this scan's remit. The case is here because accepting ALL at
#      the first filter is what first brings this statement to the default
#      privileges branch, so that branch has to check the object type or a
#      legal table grant would be reported as a blanket function grant
#  17) GRANT ALL ON TABLE t TO anon             -> must exit 0, same reason
#  18) GRANT ALL ON FUNCTION on an ALLOWLISTED function
#                                               -> must exit 0. The allowlist
#      is per function signature, not per keyword, so the same privilege
#      written a different way must still be allowed
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

# Case 4: a blanket schema-wide grant cannot be allowlisted, so it is refused.
git checkout -q -b case4 main
cat > supabase/migrations/0002_all_functions.sql <<'SQL'
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon;
SQL
git add -A
git commit -q -m "case4"
check_case "ON ALL FUNCTIONS IN SCHEMA" 1 "$(git rev-parse HEAD)"
git checkout -q main

# Case 5: default privileges grant every FUTURE function, which is worse than
# a single grant and carries no signature to allowlist.
git checkout -q -b case5 main
cat > supabase/migrations/0002_default_privs.sql <<'SQL'
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon;
SQL
git add -A
git commit -q -m "case5"
check_case "ALTER DEFAULT PRIVILEGES ON FUNCTIONS" 1 "$(git rev-parse HEAD)"
git checkout -q main

# Case 6: the keywords never appear together on one input line.
git checkout -q -b case6 main
cat > supabase/migrations/0002_wrapped.sql <<'SQL'
GRANT EXECUTE
  ON FUNCTION public.some_definer_fn(uuid)
  TO anon;
SQL
git add -A
git commit -q -m "case6"
check_case "grant wrapped across three lines" 1 "$(git rev-parse HEAD)"
git checkout -q main

# Case 7: ON PROCEDURE and ON ROUTINE carry the same privilege.
git checkout -q -b case7 main
cat > supabase/migrations/0002_procedure.sql <<'SQL'
GRANT EXECUTE ON PROCEDURE public.some_definer_proc(uuid) TO anon;
GRANT EXECUTE ON ROUTINE public.some_definer_routine(uuid) TO PUBLIC;
SQL
git add -A
git commit -q -m "case7"
check_case "ON PROCEDURE and ON ROUTINE" 1 "$(git rev-parse HEAD)"
git checkout -q main

# Case 8: first function is allowlisted, second is not. A scan that stops at
# the first signature in the statement would report this clean.
git checkout -q -b case8 main
cat > supabase/migrations/0002_comma_list.sql <<'SQL'
GRANT EXECUTE ON FUNCTION is_invite_code_valid(text), public.some_definer_fn(uuid) TO anon;
SQL
git add -A
git commit -q -m "case8"
check_case "comma list where only the second function is unallowlisted" 1 "$(git rev-parse HEAD)"
git checkout -q main

# Case 9: a grant with no signature written is legal SQL when the name is
# unique, and it cannot be matched against a per-signature allowlist.
git checkout -q -b case9 main
cat > supabase/migrations/0002_no_signature.sql <<'SQL'
GRANT EXECUTE ON FUNCTION public.some_definer_fn TO anon;
SQL
git add -A
git commit -q -m "case9"
check_case "grant with no signature written" 1 "$(git rev-parse HEAD)"
git checkout -q main

# Case 10: production declares is_invite_code_valid(p_code text). The allowlist
# entry is the regprocedure form, types only. This must PASS, or a legitimate
# re-grant migration is refused for a reason nobody can see in the output.
git checkout -q -b case10 main
cat > supabase/migrations/0002_named_params.sql <<'SQL'
GRANT EXECUTE ON FUNCTION public.is_invite_code_valid(p_code text) TO anon;
SQL
git add -A
git commit -q -m "case10"
check_case "allowlisted grant written with parameter names" 0 "$(git rev-parse HEAD)"
git checkout -q main

# Case 11: a commented-out grant is not a grant. Refusing it would train people
# to ignore this gate.
git checkout -q -b case11 main
cat > supabase/migrations/0002_commented.sql <<'SQL'
-- GRANT EXECUTE ON FUNCTION public.some_definer_fn(uuid) TO anon;
CREATE INDEX IF NOT EXISTS idx_selftest_2 ON some_table (other_column);
SQL
git add -A
git commit -q -m "case11"
check_case "grant only inside a line comment" 0 "$(git rev-parse HEAD)"
git checkout -q main

# Case 12: GRANT ALL on a named function. In PostgreSQL EXECUTE is the only
# privilege a function has, so ALL is the same grant written differently.
git checkout -q -b case12 main
cat > supabase/migrations/0002_all_named_fn.sql <<'SQL'
GRANT ALL ON FUNCTION public.some_definer_fn(uuid) TO anon;
SQL
git add -A
git commit -q -m "case12"
check_case "GRANT ALL on a named function to anon" 1 "$(git rev-parse HEAD)"
git checkout -q main

# Case 13: the ALL PRIVILEGES spelling, to PUBLIC.
git checkout -q -b case13 main
cat > supabase/migrations/0002_all_privileges.sql <<'SQL'
GRANT ALL PRIVILEGES ON FUNCTION public.some_definer_fn(uuid) TO PUBLIC;
SQL
git add -A
git commit -q -m "case13"
check_case "GRANT ALL PRIVILEGES on a named function to PUBLIC" 1 "$(git rev-parse HEAD)"
git checkout -q main

# Case 14: the schema-wide blanket form written with ALL.
git checkout -q -b case14 main
cat > supabase/migrations/0002_all_all_functions.sql <<'SQL'
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO anon;
SQL
git add -A
git commit -q -m "case14"
check_case "GRANT ALL ON ALL FUNCTIONS IN SCHEMA" 1 "$(git rev-parse HEAD)"
git checkout -q main

# Case 15: default privileges written with ALL, which reaches every FUTURE
# function in the schema.
git checkout -q -b case15 main
cat > supabase/migrations/0002_default_privs_all.sql <<'SQL'
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon;
SQL
git add -A
git commit -q -m "case15"
check_case "ALTER DEFAULT PRIVILEGES GRANT ALL ON FUNCTIONS" 1 "$(git rev-parse HEAD)"
git checkout -q main

# Case 16: the same statement on TABLES, which is outside this scan's remit and
# must not be refused. This is the false positive that accepting ALL at the
# first filter introduces if the default privileges branch does not check the
# object type.
git checkout -q -b case16 main
cat > supabase/migrations/0002_default_privs_tables.sql <<'SQL'
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon;
SQL
git add -A
git commit -q -m "case16"
check_case "ALTER DEFAULT PRIVILEGES GRANT ALL ON TABLES is not refused" 0 "$(git rev-parse HEAD)"
git checkout -q main

# Case 17: a plain table grant written with ALL, same direction as case 16.
git checkout -q -b case17 main
cat > supabase/migrations/0002_all_on_table.sql <<'SQL'
GRANT ALL ON TABLE public.some_table TO anon;
SQL
git add -A
git commit -q -m "case17"
check_case "GRANT ALL ON TABLE is not refused" 0 "$(git rev-parse HEAD)"
git checkout -q main

# Case 18: the other direction of the widening. An allowlisted function
# granted with ALL is the same privilege written differently and must still
# pass, or a later change that matched on the keyword instead of the signature
# would start refusing legitimate re-grants with every other case still green.
git checkout -q -b case18 main
cat > supabase/migrations/0002_grant_all_allowlisted.sql <<'SQL'
GRANT ALL ON FUNCTION public.is_invite_code_valid(text) TO anon;
SQL
git add -A
git commit -q -m "case18"
check_case "GRANT ALL on an allowlisted function" 0 "$(git rev-parse HEAD)"
git checkout -q main

if [ "$FAILURES" -gt 0 ]; then
  echo "::error::${FAILURES} self-test case(s) did not get the exit code they should. The gate cannot be trusted until this is green."
  exit 1
fi

echo "PASS: all self-test cases got the exit code they should."
exit 0
