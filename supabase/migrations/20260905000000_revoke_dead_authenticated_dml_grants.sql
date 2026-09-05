-- OWM-T0489: revoke dead authenticated DML grants on 13 non-key public
-- tables. "Dead" means: RLS is enabled, no restrictive policies exist
-- anywhere in schema public, and no permissive policy targeting
-- authenticated (or PUBLIC) is reachable for that command, so the grant
-- being removed changes zero rows returned today. Full per-table
-- reachable-command matrix is posted on OWM-T0489, re-verified live
-- immediately before this file was written.
--
-- EXPLICITLY NOT TOUCHED, stated so scope does not creep:
--   app_flags anon SELECT (logged-out feature flag reads)
--   beta_applications anon INSERT (public beta signup form)
--   the four self-custody key tables (household_keys,
--   household_signing_keys, household_member_osk_wraps, vault_metadata),
--   handled separately with an Auditor pass under OWM-T0493 / PR #576.
--
-- REVERSIBLE: grant delete, insert, update back to authenticated per table
-- (select is never touched here). IDEMPOTENT: REVOKE re-runs cleanly.

begin;

revoke delete, insert, update on table public.app_flags from authenticated;

revoke delete, insert, select, update on table public.beta_allowlist from authenticated;

revoke delete, update on table public.beta_applications from authenticated;

revoke delete, insert on table public.crosssell_state from authenticated;

revoke delete, insert, update on table public.household_active_key_versions from authenticated;

revoke delete on table public.household_key_rotation_jobs from authenticated;

revoke delete, insert, update on table public.pending_admin_emails from authenticated;

revoke delete, insert, update on table public.support_sessions from authenticated;

revoke delete, insert, update on table public.sync_events from authenticated;

revoke delete on table public.user_last_seen_household_key_versions from authenticated;

revoke delete on table public.user_public_keys from authenticated;

revoke delete, insert, update on table public.user_roles from authenticated;

revoke delete, update on table public.vault_security_events from authenticated;

commit;
