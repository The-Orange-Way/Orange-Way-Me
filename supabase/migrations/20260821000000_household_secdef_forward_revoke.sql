-- Household SECDEF least-privilege EXECUTE grants (DL-1546)
--
-- Three SECURITY DEFINER, write-performing functions were executable by
-- PUBLIC (the empty grantee) plus anon and authenticated. Per least
-- privilege, a definer function that writes should be reachable only by
-- the roles that actually call it. This narrows EXECUTE accordingly:
-- PUBLIC and anon are removed from all three; authenticated is removed
-- from the two that have no client caller.
--
-- Revoking PUBLIC also removes service_role's implicit EXECUTE (these
-- functions currently reach service_role only via the PUBLIC grant), so
-- the roles the edge-function paths require are granted back explicitly.
--
-- Caller map (verified against dev):
--   advance_household_rotation_job(uuid, text)
--       client  -> authenticated   (src/lib/household-rekey.ts, supabase.rpc)
--       edge    -> service_role     (abort-household-rekey, finalize-household-rekey)
--   expire_time_boxed_household_roles()
--       edge    -> service_role     (sweep-expired-household-roles)
--       pg_cron : runs as the job owner, unaffected by these grants
--   purge_expired_old_household_key_wraps()
--       pg_cron : runs as the job owner, unaffected by these grants
--       service_role granted for on-demand administrative invocation
--
-- Idempotent: REVOKE and GRANT are safe to re-apply. A later
-- CREATE OR REPLACE of any of these functions resets EXECUTE to PUBLIC,
-- so this must run after any such change (the proacl CI gate enforces
-- the same invariant).

BEGIN;

REVOKE EXECUTE ON FUNCTION public.advance_household_rotation_job(uuid, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.advance_household_rotation_job(uuid, text) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.expire_time_boxed_household_roles() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.expire_time_boxed_household_roles() TO service_role;

REVOKE EXECUTE ON FUNCTION public.purge_expired_old_household_key_wraps() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.purge_expired_old_household_key_wraps() TO service_role;

COMMIT;
