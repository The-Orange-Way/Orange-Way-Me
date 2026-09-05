-- Batch 2 of 2: remove anon's table grants on the four self-custody key
-- tables, and strip the four privileges the authenticated role never uses.
--
-- THE FOUR TABLES: household_keys, household_signing_keys,
-- household_member_osk_wraps, vault_metadata.
--
-- WHY THIS EXISTS. Every table in schema public inherited the platform
-- default and shipped with anon holding DELETE, INSERT, MAINTAIN,
-- REFERENCES, SELECT, TRIGGER, TRUNCATE and UPDATE. Read live from
-- pg_class.relacl on 2026-09-01, all four of these still carry
-- anon=arwdDxtm. TRUNCATE and MAINTAIN are not filtered by row level
-- security at all, so for those two the policy set on these tables is not
-- protecting anything.
--
-- HONEST STATEMENT OF EXPOSURE, so this is neither escalated as a breach
-- nor dismissed as cosmetic. PostgREST does not expose TRUNCATE, so there
-- is no known reachable path from a holder of the public anon key today.
-- This is drift and a missing layer of defence, not a demonstrated open
-- door. It is worth fixing carefully and promptly.
--
-- WHY THE anon GRANT IS SAFE TO REMOVE HERE. Checked against the source,
-- not reasoned about from the table names:
--   1. No client path reads these four tables as anon. Every application
--      read runs after sign-in and therefore as the authenticated role.
--   2. Every edge function that touches these tables does so through its
--      service_role admin client (household-rekey-batch,
--      invite-household-member, abort-household-rekey,
--      admin-update-household-member, complete-household-invite-wrap,
--      mint-household-signing-key, sweep-expired-household-roles). The
--      service_role grant is untouched by this file.
--   3. Those functions also build a caller-scoped client from the anon
--      key, but only with the caller's own Authorization header attached,
--      and each returns 401 when that header is absent. Such a request
--      executes as authenticated, not as anon, so narrowing the anon grant
--      does not reach it.
--
-- WHAT THIS DELIBERATELY DOES NOT DO. The authenticated role KEEPS SELECT,
-- INSERT, UPDATE and DELETE. The four policies on household_keys target
-- the authenticated role explicitly and the RLS policies do the row
-- filtering; revoking the table grant would make PostgREST answer
-- permission denied and break vault unlock outright. Only TRUNCATE,
-- MAINTAIN, REFERENCES and TRIGGER go.
--
-- OUT OF SCOPE, STATED SO IT IS NOT ASSUMED DONE. Production has NOT been
-- measured. No seat that has examined this holds a production read scope,
-- so whether prod carries the same grants is unknown, not assumed-yes.
-- Sequence and function default privileges are a different object class
-- and are tracked separately.
--
-- REVERSIBLE. The undo is the platform default:
--   grant all on table <t> to anon;
--   grant truncate, references, trigger, maintain on table <t> to authenticated;
--
-- IDEMPOTENT. REVOKE is naturally re-runnable; running this file twice
-- leaves the same end state.

begin;

revoke all on table
  public.household_keys,
  public.household_member_osk_wraps,
  public.household_signing_keys,
  public.vault_metadata
from anon;

revoke truncate, references, trigger, maintain on table
  public.household_keys,
  public.household_member_osk_wraps,
  public.household_signing_keys,
  public.vault_metadata
from authenticated;

commit;
