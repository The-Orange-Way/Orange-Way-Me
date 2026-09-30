-- Revoke DML privileges that row level security already denies.
--
-- WHY THIS EXISTS
-- 20260512000000_grant_table_privileges.sql runs
--   GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role
-- so that PostgREST can route to tables created by migration. That grant is
-- applied uniformly, so a role ends up holding SELECT, INSERT, UPDATE and DELETE
-- on tables where no policy ever lets it use them.
--
-- Row level security is a filter on top of a granted privilege, never a
-- substitute for one. Where a role holds a privilege but no permissive policy is
-- reachable for that command, the command is already denied today, so removing
-- the privilege is a runtime no-op. The reason to remove it anyway is the next
-- change: a policy written later cannot widen access by assuming the underlying
-- grant was narrow.
--
-- HOW THE LIST WAS BUILT, AND WHY IT IS NOT A BLANKET REVOKE
-- Every table in schema public was measured against every (role, command) pair,
-- comparing the effective privilege (has_table_privilege, so it accounts for
-- grants held via PUBLIC and via role membership, not only the explicit relacl
-- entry) against whether a permissive policy exists that the role can reach for
-- that command, counting polcmd ALL as all four commands and counting a policy
-- whose roles list is PUBLIC as reaching both anon and authenticated. Only pairs
-- that hold a privilege with no reachable policy appear below. Nothing else is
-- touched.
--
-- A blanket revoke would take the app offline: PostgREST connects as
-- `authenticated` for every logged in user, and most tables here have reachable
-- policies for the commands that are NOT listed below.
--
-- SUPPORTING FACTS, measured on the dev instance before writing this:
--   row level security is enabled on all 33 tables in schema public, so no grant
--     named here is unconstrained
--   there are no restrictive policies in schema public, so reading only the
--     permissive ones is complete
--   there are no column level grants to anon or authenticated anywhere in schema
--     public, so a table level REVOKE leaves no residue behind
--
-- DELIBERATELY PRESERVED. Do not remove these in a later cleanup:
--   anon SELECT on app_flags. This is the runtime flag read, and the client
--     fails closed on a missing row, so removing this grant would not raise an
--     error. It would read as "flag absent" and turn features off silently.
--   anon INSERT on beta_applications. This is the beta signup form.
--   authenticated SELECT on app_flags, household_active_key_versions,
--     pending_admin_emails, support_sessions, sync_events and user_roles. Each
--     has a reachable SELECT policy and is in use, which is why only DELETE,
--     INSERT and UPDATE are removed from those tables below.
--
-- NOT IN THIS MIGRATION: household_keys, household_signing_keys,
-- household_member_osk_wraps and vault_metadata. Those are self custody surfaces
-- and ship in their own migration under review, so that a change to them cannot
-- ride along with routine cleanup.
--
-- IDEMPOTENT: REVOKE of a privilege that is not held is a no-op, so a re-run
-- changes nothing.
-- REVERSIBLE: the exact undo is the matching GRANT for each statement below,
-- for example GRANT DELETE, INSERT, UPDATE ON public.app_flags TO authenticated;

REVOKE DELETE, INSERT, UPDATE ON public.app_flags FROM authenticated;
REVOKE DELETE, INSERT, SELECT, UPDATE ON public.beta_allowlist FROM authenticated;
REVOKE DELETE, UPDATE ON public.beta_applications FROM authenticated;
REVOKE DELETE, INSERT ON public.crosssell_state FROM authenticated;
REVOKE DELETE, INSERT, UPDATE ON public.household_active_key_versions FROM authenticated;
REVOKE DELETE ON public.household_key_rotation_jobs FROM authenticated;
REVOKE DELETE, INSERT, UPDATE ON public.pending_admin_emails FROM authenticated;
REVOKE DELETE, INSERT, UPDATE ON public.support_sessions FROM authenticated;
REVOKE DELETE, INSERT, UPDATE ON public.sync_events FROM authenticated;
REVOKE DELETE ON public.user_last_seen_household_key_versions FROM authenticated;
REVOKE DELETE ON public.user_public_keys FROM authenticated;
REVOKE DELETE, INSERT, UPDATE ON public.user_roles FROM authenticated;
REVOKE DELETE, UPDATE ON public.vault_security_events FROM authenticated;
