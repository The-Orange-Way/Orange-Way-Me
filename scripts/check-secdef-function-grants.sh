#!/usr/bin/env bash
#
# Refuse a migration that recreates a hardened SECURITY DEFINER function
# without re-applying that function's EXECUTE revoke in the same file.
#
# WHY THIS EXISTS
#
# Postgres resets a function's EXECUTE privileges to PUBLIC every time the
# function is replaced. PostgREST publishes any function the requesting role
# can execute, so the four functions listed below are only kept off PUBLIC
# and anon for as long as something re-applies their revoke after every
# replacement. Two migrations do that today:
#
#   supabase/migrations/20260821000000_household_secdef_forward_revoke.sql
#   supabase/migrations/20260824230000_has_role_forward_revoke.sql
#
# Their protection used to be accidental: neither was recorded as applied,
# so any replay re-ran them. Both are recorded now, so replay will not
# happen again and nothing else was watching. This script is that something.
#
# WHAT IT CHECKS, precisely
#
# For each migration file handed to it: if the file creates or replaces one
# of the protected functions, the SAME file must also contain a REVOKE of
# EXECUTE (or ALL) on that function whose FROM list names both PUBLIC and
# anon. Nothing else is inspected and no other file is consulted, because a
# revoke living in a different file is exactly the arrangement that just
# stopped working.
#
# WHAT IT DELIBERATELY DOES NOT DO
#
#   - It does not read a database. A live ACL probe needs production read,
#     which almost no caller holds, and it can only answer after the
#     migration has been applied, which is after the damage.
#   - It does not check that the revoke's argument types match the create's.
#     A same-name overload with different arguments would satisfy this text
#     check and not the real invariant. Argument-level matching needs a
#     parser; this is a lint, and it is honest about where it stops.
#   - It cannot see a replacement assembled as a string and run through
#     EXECUTE inside a DO block at run time.
#
# USAGE
#
#   check-secdef-function-grants.sh <file.sql> [file.sql ...]
#   check-secdef-function-grants.sh --self-test
#
# EXIT CODES
#
#   0  every file passed, or there was nothing to check
#   1  at least one file violates the rule
#   2  the script could not do its job (bad argument, unreadable file)
#
# Exit code 2 is separate on purpose. A check that cannot run must never be
# scored the same as a check that ran and found nothing.

set -uo pipefail

# The functions this guard protects. Add a name here in the same change that
# adds a forward-revoke migration for it, never afterwards.
PROTECTED=(
  has_role
  advance_household_rotation_job
  expire_time_boxed_household_roles
  purge_expired_old_household_key_wraps
)

# Strip SQL comments, then flatten to one statement per line.
#
# Comments are removed first so that a file merely DESCRIBING the hazard is
# not treated as causing it. Both forward-revoke migrations say "a later
# CREATE OR REPLACE of this function resets EXECUTE to PUBLIC" in their
# headers, and a guard that fails on its own documentation would be turned
# off within a week.
#
# Flattening matters because a create statement is normally written across
# several lines, so a line-oriented match would miss most real cases.
normalize_sql() {
  local file="$1"
  awk '
    BEGIN { inblk = 0 }
    {
      line = $0; out = ""; i = 1; n = length(line)
      while (i <= n) {
        rest = substr(line, i)
        if (inblk) {
          p = index(rest, "*/")
          if (p == 0) { i = n + 1 } else { i = i + p + 1; inblk = 0 }
        } else {
          a = index(rest, "--")
          b = index(rest, "/*")
          if (a == 0 && b == 0) { out = out rest; i = n + 1 }
          else if (b == 0 || (a > 0 && a < b)) { out = out substr(rest, 1, a - 1); i = n + 1 }
          else { out = out substr(rest, 1, b - 1); i = i + b + 1; inblk = 1 }
        }
      }
      print out
    }
  ' "$file" | tr '\n' ' ' | tr ';' '\n'
}

create_pattern() {
  printf 'CREATE[[:space:]]+(OR[[:space:]]+REPLACE[[:space:]]+)?FUNCTION[[:space:]]+("?public"?\.)?"?%s"?[[:space:]]*\(' "$1"
}

revoke_pattern() {
  printf 'REVOKE[[:space:]]+(EXECUTE|ALL([[:space:]]+PRIVILEGES)?)[[:space:]]+ON[[:space:]]+FUNCTION[[:space:]]+("?public"?\.)?"?%s"?[[:space:]]*\(' "$1"
}

# 0 = the file is fine, 1 = the file violates the rule.
check_file() {
  local file="$1"
  local statements name creates revokes revoke_ok bad line
  statements="$(normalize_sql "$file")"
  bad=0

  for name in "${PROTECTED[@]}"; do
    creates="$(printf '%s\n' "$statements" | grep -Eic "$(create_pattern "$name")" || true)"
    [ "$creates" -eq 0 ] && continue

    revoke_ok=0
    while IFS= read -r line; do
      [ -z "$line" ] && continue
      # The revoke has to name PUBLIC and anon in its FROM list. Revoking
      # PUBLIC alone leaves an explicit anon grant in place, and revoking
      # anon alone leaves the implicit grant every role inherits.
      if printf '%s' "$line" | grep -Eiq 'FROM.*PUBLIC' \
        && printf '%s' "$line" | grep -Eiq '(^|[^A-Za-z0-9_])anon([^A-Za-z0-9_]|$)'; then
        revoke_ok=1
      fi
    done < <(printf '%s\n' "$statements" | grep -Ei "$(revoke_pattern "$name")" || true)

    if [ "$revoke_ok" -ne 1 ]; then
      bad=1
      echo "::error file=${file}::${file} creates or replaces public.${name} without re-applying its EXECUTE revoke in the same file. Replacing a function resets its EXECUTE list to PUBLIC, so add: REVOKE EXECUTE ON FUNCTION public.${name}(<args>) FROM PUBLIC, anon; followed by the GRANTs the callers actually need."
    else
      echo "ok ${file}: public.${name} is recreated and its revoke is re-applied in the same file"
    fi
  done

  return "$bad"
}

self_test() {
  local dir rc failures=0
  dir="$(mktemp -d)"
  # shellcheck disable=SC2064
  trap "rm -rf '${dir}'" EXIT

  cat > "${dir}/bad.sql" <<'SQL'
BEGIN;
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$ SELECT false $$;
COMMIT;
SQL

  cat > "${dir}/good.sql" <<'SQL'
BEGIN;
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$ SELECT false $$;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, service_role;
COMMIT;
SQL

  # Revoking PUBLIC but not anon must still fail: an explicit anon grant
  # survives a PUBLIC-only revoke.
  cat > "${dir}/half.sql" <<'SQL'
BEGIN;
CREATE OR REPLACE FUNCTION public.expire_time_boxed_household_roles()
RETURNS void LANGUAGE sql SECURITY DEFINER AS $$ SELECT 1 $$;
REVOKE EXECUTE ON FUNCTION public.expire_time_boxed_household_roles() FROM PUBLIC;
COMMIT;
SQL

  cat > "${dir}/unrelated.sql" <<'SQL'
BEGIN;
CREATE TABLE public.ci_selftest_unrelated (id uuid PRIMARY KEY);
COMMIT;
SQL

  # A file that only TALKS about the hazard, which is what both real
  # forward-revoke migrations do in their headers.
  cat > "${dir}/comment_only.sql" <<'SQL'
-- A later CREATE OR REPLACE FUNCTION public.has_role(uuid, public.app_role)
-- resets EXECUTE to PUBLIC, so this must run after any such change.
BEGIN;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
COMMIT;
SQL

  expect() {
    local label="$1" want="$2" file="$3"
    check_file "$file" > /dev/null 2>&1
    rc=$?
    if [ "$rc" -ne "$want" ]; then
      echo "::error::self-test ${label}: expected exit ${want}, got ${rc}"
      failures=$((failures + 1))
    else
      echo "self-test ok: ${label} (exit ${rc})"
    fi
  }

  expect "recreate with no revoke is refused" 1 "${dir}/bad.sql"
  expect "recreate with PUBLIC and anon revoked passes" 0 "${dir}/good.sql"
  expect "revoking PUBLIC only is refused" 1 "${dir}/half.sql"
  expect "an unrelated migration passes" 0 "${dir}/unrelated.sql"
  expect "a comment mentioning the hazard passes" 0 "${dir}/comment_only.sql"

  if [ "$failures" -ne 0 ]; then
    echo "::error::${failures} self-test case(s) failed. This guard cannot be trusted until they pass, so the job fails rather than reporting a clean tree."
    return 2
  fi
  echo "self-test: 5 of 5 cases behaved as specified"
  return 0
}

main() {
  if [ "$#" -eq 0 ]; then
    echo "::error::no arguments. Usage: $0 <file.sql> [file.sql ...] | --self-test" >&2
    exit 2
  fi

  if [ "$1" = "--self-test" ]; then
    self_test
    exit $?
  fi

  local failed=0 checked=0 file
  for file in "$@"; do
    if [ ! -f "$file" ]; then
      # A named file that is not on disk means the caller computed the file
      # list wrongly. Passing here would report a clean tree for a check that
      # inspected nothing.
      echo "::error::${file} was named for inspection but does not exist. The caller's file list is wrong; this is not a clean result." >&2
      exit 2
    fi
    checked=$((checked + 1))
    check_file "$file" || failed=1
  done

  if [ "$failed" -ne 0 ]; then
    echo "examined ${checked} migration file(s): at least one recreates a protected function without its revoke"
    exit 1
  fi
  echo "examined ${checked} migration file(s): no protected function is recreated without its revoke"
  exit 0
}

main "$@"
