-- Reassert public.redeem_invite_code(text) as supabase_auth_admin only.
--
-- Why. The invite consuming path (redeem_invite_code) is meant to run only
-- from the Before User Created auth hook, which executes as
-- supabase_auth_admin. The July 7 migrations set that end state: EXECUTE
-- granted to supabase_auth_admin, revoked from public, anon and authenticated.
--
-- The ordering drift. 20260720000000_restrict_redeem_invite_code_to_authenticated.sql
-- is dated after the July 7 files and grants EXECUTE to authenticated. On an
-- existing database (dev, prod) it has already run and the later hand applied
-- July 7 state stands, so nothing is wrong today. On a from scratch rebuild
-- (a new environment, a local supabase db reset, an ephemeral CI database)
-- migrations run in timestamp order, so restrict runs last and re opens the
-- consuming function to authenticated. This migration, dated after all of the
-- above, restores the intended end state so the two paths agree.
--
-- Retry safety. REVOKE and GRANT are idempotent, so a repeat run is a no op.
-- No DDL against a populated table, no index build, no blocking lock. On an
-- existing database this is a no op because the state is already correct.
--
-- Left alone. public.is_invite_code_valid() keeps its anon grant: it is the
-- non consuming pre auth check the signup form calls before a session exists.
-- service_role and postgres grants are untouched.

REVOKE EXECUTE ON FUNCTION public.redeem_invite_code(text) FROM public, anon, authenticated;

-- Restated so the intended end state is explicit rather than inherited.
GRANT EXECUTE ON FUNCTION public.redeem_invite_code(text) TO supabase_auth_admin;

COMMENT ON FUNCTION public.redeem_invite_code(text) IS
    'Atomically consume one use of an invite code (single UPDATE guard, no race). '
    'Returns true iff consumed. Consuming and auth hook only: granted to '
    'supabase_auth_admin. The pre auth check is public.is_invite_code_valid(), '
    'which does not mutate.';

-- ---------------------------------------------------------------------------
-- DOWN PATH (reversal)
--
-- Restores the prior grant state that 20260720000000_restrict... produced.
-- Idempotent, so a partial apply reverses cleanly and a second run is a no op.
--
--   GRANT EXECUTE ON FUNCTION public.redeem_invite_code(text) TO authenticated;
--
-- Reversal note: reversing this re opens the consuming function to
-- authenticated callers. Any use already consumed stays consumed, because a
-- spent use is not restored by changing a grant.
-- ---------------------------------------------------------------------------
