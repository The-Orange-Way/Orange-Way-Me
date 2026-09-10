-- THROWAWAY, do not merge. Proves the new cron-calling-role revoke scan in
-- scripts/check-definer-grant-migrations.sh (OWM-T0635 step 7) actually
-- fires. This file is never applied to any database: the PR-scan CI job
-- only diffs migration text, it does not run SQL. Removed in the next
-- commit on this branch once the red run is captured.
revoke execute on function public.expire_time_boxed_household_roles() from postgres;
