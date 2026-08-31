-- Trigger SECDEF least-privilege EXECUTE grants (OWM-T0400)
--
-- Five SECURITY DEFINER functions carry EXECUTE for PUBLIC (the empty
-- grantee) plus anon and authenticated on the production project. Four
-- return `trigger` and one returns `event_trigger`, so none of them is
-- reachable over PostgREST RPC. They are still an unjustified grant: a
-- SECURITY DEFINER function runs with its owner's rights, and no role
-- outside the trigger machinery has any reason to hold EXECUTE on one.
--
-- WHY THIS IS SAFE, on evidence rather than on theory. The development
-- project already runs with exactly the target ACL below, {postgres,
-- service_role}, and its triggers fire normally. PostgreSQL checks
-- EXECUTE on a trigger function when the trigger is CREATED, not when it
-- fires, so removing EXECUTE from PUBLIC, anon and authenticated does not
-- affect any existing trigger. This migration moves production onto the
-- shape development has been running, it does not invent a new one.
--
-- Revoking PUBLIC also removes service_role's implicit EXECUTE, so
-- service_role is granted back explicitly to match development exactly.
--
-- Reversible: the undo is GRANT EXECUTE ... TO PUBLIC, anon, authenticated
-- on each function. No object is dropped, no type is changed, no row is
-- touched.
--
-- Idempotent: REVOKE and GRANT are safe to re-apply. A later
-- CREATE OR REPLACE of any of these functions resets EXECUTE to PUBLIC,
-- so this must run after any such change (the proacl CI gate enforces
-- the same invariant).

BEGIN;

REVOKE EXECUTE ON FUNCTION public.enforce_account_opened_at_not_after_txns() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.enforce_account_opened_at_not_after_txns() TO service_role;

REVOKE EXECUTE ON FUNCTION public.enforce_transaction_after_account_opened() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.enforce_transaction_after_account_opened() TO service_role;

REVOKE EXECUTE ON FUNCTION public.link_pending_household_invites_on_keypair_insert() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.link_pending_household_invites_on_keypair_insert() TO service_role;

REVOKE EXECUTE ON FUNCTION public.verify_mutation_signature_on_write() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.verify_mutation_signature_on_write() TO service_role;

REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.rls_auto_enable() TO service_role;

COMMIT;
