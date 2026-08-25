-- ROLLBACK for 20260821000000_household_secdef_forward_revoke.sql (DL-1546)
--
-- Restores the three household SECURITY DEFINER functions to the EXACT
-- EXECUTE grants that were live on prod before the forward revoke,
-- captured by direct proacl query on prod (project tmqjusxxjjcsdgyiqbcg)
-- on 2026-08-24:
--
--   {=X/postgres,postgres=X,anon=X,authenticated=X,service_role=X}
--
-- i.e. PUBLIC (the empty grantee =X) plus anon, authenticated and
-- service_role all hold EXECUTE. postgres is the owner and keeps EXECUTE
-- regardless, so it is not named here.
--
-- WHY THIS FILE EXISTS: reverting the application code does not restore a
-- revoked grant. This is the written DB undo the forward revoke requires
-- before it is applied to prod.
--
-- HOW IT IS USED: applied by hand, two-party, ONLY to reverse the forward
-- revoke. It is deliberately outside supabase/migrations/ (in a rollbacks/
-- subfolder) so no apply path ever runs it automatically. Idempotent:
-- GRANT is safe to re-apply.

BEGIN;

GRANT EXECUTE ON FUNCTION public.advance_household_rotation_job(uuid, text)
  TO PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.expire_time_boxed_household_roles()
  TO PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.purge_expired_old_household_key_wraps()
  TO PUBLIC, anon, authenticated, service_role;

COMMIT;
