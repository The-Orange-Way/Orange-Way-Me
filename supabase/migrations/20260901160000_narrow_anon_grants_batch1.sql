-- Batch 1 of 2: remove anon's table grants on the 26 non-key public tables, and
-- strip the four privileges the authenticated role never uses.
--
-- WHY THIS EXISTS. Every table in schema public inherited the platform default
-- and shipped with anon holding DELETE, INSERT, MAINTAIN, REFERENCES, SELECT,
-- TRIGGER, TRUNCATE and UPDATE. TRUNCATE and MAINTAIN are not filtered by row
-- level security at all, so for those two the policy set on these tables is not
-- protecting anything. This is drift and a missing layer of defence rather than
-- a demonstrated open door: PostgREST does not expose TRUNCATE, so there is no
-- known reachable path from a holder of the public anon key today.
--
-- WHAT THIS DELIBERATELY DOES NOT DO.
--   1. The authenticated role KEEPS SELECT, INSERT, UPDATE and DELETE. The client
--      reads these tables as authenticated and the RLS policies do the row
--      filtering; revoking the table grant would make PostgREST answer permission
--      denied on every table. Only TRUNCATE, MAINTAIN, REFERENCES and TRIGGER go.
--   2. The four self-custody key tables (household_keys, household_signing_keys,
--      household_member_osk_wraps, vault_metadata) are NOT in this file. They are
--      the same change on tables where a mistake is expensive and they carry an
--      Auditor pass before merge.
--   3. stealth_sync_runs, invite_codes and or_connection_key_namespace already
--      carry no anon grant and are excluded. Verified live, not assumed:
--      33 tables in public, 30 with an anon entry, minus the 4 key tables = 26.
--
-- TWO ANON GRANTS ARE KEPT ON PURPOSE, re-granted narrowly at the end of this
-- file. Both were traced to the source line that needs them, not guessed:
--
--   app_flags SELECT
--     src/main.tsx calls loadRuntimeFlags() at module load, before any sign-in,
--     and src/lib/stealth/runtimeFlags.ts reads public.app_flags through the
--     browser client. For a signed-out visitor that request runs as anon. The
--     policy "app_flags public read" targets anon and authenticated with
--     USING true, so the policy already expects this. The module FAILS CLOSED on
--     a query error, which is the reason this grant must not be removed casually:
--     revoking it would not raise anything a user or a log would show, it would
--     just pin the flag off forever and make a kill switch that cannot be
--     switched back.
--
--   beta_applications INSERT
--     src/routes/beta.tsx submits the public /beta marketing route straight to
--     this table through the browser client, with no auth. The policy
--     "beta_applications_anon_insert" targets anon and carries a WITH CHECK that
--     validates the email shape and bounds the note, so the row filter is doing
--     real work here and INSERT alone is the right grant. anon gets no SELECT, so
--     an applicant still cannot read the applications table.
--
-- THE OTHER THREE PLAUSIBLE CANDIDATES WERE CHECKED AND NEED NOTHING. Read live
-- from pg_policy rather than reasoned about from the table names:
--   beta_allowlist        zero policies with RLS enabled, which is deny-all.
--   household_invites     both policies require auth.uid(); no unauthenticated path.
--   pending_admin_emails  single policy with USING false.
--
-- REVERSIBLE. The undo is the platform default:
--   grant all on table <t> to anon;
--   grant truncate, references, trigger, maintain on table <t> to authenticated;
--
-- IDEMPOTENT. REVOKE and GRANT are naturally re-runnable; running this file twice
-- leaves the same end state.

begin;

revoke all on table
  public.accounts,
  public.app_flags,
  public.beta_allowlist,
  public.beta_applications,
  public.budgets,
  public.categories,
  public.connection_account_map,
  public.connector_credentials,
  public.crosssell_state,
  public.goals,
  public.household_active_key_versions,
  public.household_invites,
  public.household_key_rotation_jobs,
  public.household_members,
  public.households,
  public.ow_or_proxy_rate_limit,
  public.pending_admin_emails,
  public.rules,
  public.support_sessions,
  public.sync_events,
  public.transactions,
  public.user_last_seen_household_key_versions,
  public.user_profiles,
  public.user_public_keys,
  public.user_roles,
  public.vault_security_events
from anon;

revoke truncate, references, trigger, maintain on table
  public.accounts,
  public.app_flags,
  public.beta_allowlist,
  public.beta_applications,
  public.budgets,
  public.categories,
  public.connection_account_map,
  public.connector_credentials,
  public.crosssell_state,
  public.goals,
  public.household_active_key_versions,
  public.household_invites,
  public.household_key_rotation_jobs,
  public.household_members,
  public.households,
  public.ow_or_proxy_rate_limit,
  public.pending_admin_emails,
  public.rules,
  public.support_sessions,
  public.sync_events,
  public.transactions,
  public.user_last_seen_household_key_versions,
  public.user_profiles,
  public.user_public_keys,
  public.user_roles,
  public.vault_security_events
from authenticated;

-- The two deliberate unauthenticated paths, restored narrowly. See the header
-- for the source line behind each.
grant select on table public.app_flags to anon;
grant insert on table public.beta_applications to anon;

commit;
