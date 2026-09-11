-- Revoke dead DML privileges on the self custody tables.
--
-- Companion to 20260901130000_revoke_dead_dml_grants.sql. Same rule, same
-- evidence, split into its own migration because these are self custody
-- surfaces: a wrong revoke here could break a key rotation path rather than
-- merely tightening a privilege nobody uses, so it is reviewed on its own.
--
-- THE RULE
-- Row level security is a filter on top of a granted privilege, never a
-- substitute for one. A role that holds a table privilege but cannot reach any
-- permissive policy for that command is already denied today, so removing the
-- privilege is a runtime no-op. It is worth removing anyway so that a policy
-- written later cannot widen access by assuming the underlying grant was narrow.
--
-- WHAT WAS MEASURED on the dev instance before writing this:
--   Every policy on these three tables names `authenticated` explicitly in its
--     roles list. None targets PUBLIC. anon therefore reaches no policy on any
--     of them, and the DELETE/INSERT/SELECT/UPDATE it holds has never been
--     usable.
--   household_keys: authenticated reaches a policy for all four commands, so
--     nothing is removed from authenticated here.
--   household_signing_keys and household_member_osk_wraps: authenticated reaches
--     a SELECT policy only, so SELECT is preserved and the other three go.
--   Row level security is enabled on all three tables.
--   There are no restrictive policies in schema public, so reading only the
--     permissive ones is complete.
--   There are no column level grants to anon or authenticated anywhere in
--     schema public, so a table level REVOKE leaves no residue behind.
--
-- WHAT IS PRESERVED, and removing any of it would break the product:
--   authenticated DELETE, INSERT, SELECT, UPDATE on household_keys
--   authenticated SELECT on household_signing_keys
--   authenticated SELECT on household_member_osk_wraps
--
-- NOT IN THIS MIGRATION: vault_metadata, even though it is a self custody
-- surface. Its four policies have an empty roles list, which means PUBLIC, so
-- both roles do reach them and the dead grant rule above does not apply to it.
-- Narrowing it needs a different change, to the policies rather than to the
-- grants, and it is tracked separately rather than folded in here.
--
-- IDEMPOTENT: REVOKE of a privilege that is not held is a no-op, so a re-run
-- changes nothing.
-- REVERSIBLE: the exact undo is the matching GRANT for each statement below,
-- for example GRANT DELETE, INSERT, SELECT, UPDATE ON public.household_keys TO anon;

REVOKE DELETE, INSERT, SELECT, UPDATE ON public.household_keys FROM anon;

REVOKE DELETE, INSERT, SELECT, UPDATE ON public.household_signing_keys FROM anon;
REVOKE DELETE, INSERT, UPDATE ON public.household_signing_keys FROM authenticated;

REVOKE DELETE, INSERT, SELECT, UPDATE ON public.household_member_osk_wraps FROM anon;
REVOKE DELETE, INSERT, UPDATE ON public.household_member_osk_wraps FROM authenticated;
