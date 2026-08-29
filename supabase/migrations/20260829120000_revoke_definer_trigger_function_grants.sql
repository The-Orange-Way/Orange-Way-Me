-- Revoke EXECUTE from PUBLIC, anon and authenticated on the SECURITY DEFINER
-- trigger functions in schema public.
--
-- These five are trigger or event trigger functions. They are invoked by the
-- trigger mechanism, and PostgreSQL checks EXECUTE at CREATE TRIGGER time, not
-- at fire time, so removing the grant cannot break any trigger. Nothing can
-- call them over PostgREST either, but a SECURITY DEFINER function carrying a
-- PUBLIC grant is a hole we do not leave open on the strength of that alone.
--
-- The grants had no migration behind them: CREATE FUNCTION defaults EXECUTE to
-- PUBLIC, and the blanket grant in 20260512000000_grant_table_privileges.sql
-- gives anon EXECUTE on every function in this schema, including ones created
-- later. A CREATE OR REPLACE of any of these functions will reset the PUBLIC
-- grant again, which is exactly why the gate reads the live database.
--
-- Idempotent: REVOKE of a privilege that is not held is a no-op.
-- Reversible: GRANT EXECUTE ... TO the same roles restores the previous state.

REVOKE EXECUTE ON FUNCTION public.enforce_account_opened_at_not_after_txns()
  FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.enforce_transaction_after_account_opened()
  FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.link_pending_household_invites_on_keypair_insert()
  FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.rls_auto_enable()
  FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.verify_mutation_signature_on_write()
  FROM PUBLIC, anon, authenticated;
