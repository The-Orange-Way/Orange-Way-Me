-- Trigger SECDEF least-privilege EXECUTE grants (ticket T0402)
--
-- Five SECURITY DEFINER trigger / event-trigger functions were executable
-- by PUBLIC (the empty grantee) plus anon and authenticated on dev, with
-- no migration file asking for that state. Someone applied the revoke to
-- dev by hand. This migration writes down what dev already is, so a
-- fresh environment built from migrations lands in the same place and
-- the definer-grants gate has a file to point at.
--
-- Revoking PUBLIC also removes service_role's implicit EXECUTE, so it is
-- granted back explicitly, same reasoning as the earlier forward-revoke
-- migration for household functions.
--
-- Safety: these are trigger and event-trigger functions. PostgreSQL
-- checks EXECUTE on a trigger function when the trigger is CREATED, not
-- each time it fires, so narrowing the grant does not stop an existing
-- trigger firing. None of the five are reachable over PostgREST RPC,
-- because PostgREST does not expose trigger-returning functions.
--
-- Idempotent: REVOKE and GRANT are safe to re-apply. A later
-- CREATE OR REPLACE of any of these functions resets EXECUTE to PUBLIC,
-- so this must run again after any such change (the proacl CI gate
-- enforces the same invariant).

BEGIN;

REVOKE EXECUTE ON FUNCTION public.enforce_account_opened_at_not_after_txns() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.enforce_account_opened_at_not_after_txns() TO service_role;

REVOKE EXECUTE ON FUNCTION public.enforce_transaction_after_account_opened() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.enforce_transaction_after_account_opened() TO service_role;

REVOKE EXECUTE ON FUNCTION public.link_pending_household_invites_on_keypair_insert() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.link_pending_household_invites_on_keypair_insert() TO service_role;

REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.rls_auto_enable() TO service_role;

REVOKE EXECUTE ON FUNCTION public.verify_mutation_signature_on_write() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.verify_mutation_signature_on_write() TO service_role;

COMMIT;
