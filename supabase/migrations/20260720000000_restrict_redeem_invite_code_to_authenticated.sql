-- Restrict public.redeem_invite_code(text) to authenticated callers.
--
-- Why. redeem_invite_code consumes state: each successful call runs
-- UPDATE public.invite_codes SET uses = uses + 1 and permanently spends one
-- use of the code. The original migration granted EXECUTE on it to both anon
-- and authenticated, which put a consuming, irreversible operation on a
-- surface reachable with no session and no credential.
--
-- Why anon is not needed. The authoritative signup gate is the
-- Before-User-Created hook, which calls the NON-consuming
-- public.is_invite_code_valid(). Redemption is specified to run as a separate
-- call after the account exists, and that context is authenticated. So the
-- anon grant on the consuming function is surplus privilege rather than a
-- dependency of the documented flow.
--
-- What is deliberately left alone. public.is_invite_code_valid() keeps its
-- anon grant. The signup form must call it before a session exists, it does
-- not mutate anything, and it returns a bool only. Rate limiting that
-- pre-auth surface is a separate concern and is NOT addressed by this
-- migration.
--
-- Retry safety: REVOKE and GRANT are idempotent, so running this twice is a
-- no-op. No DDL against a populated table, no index build, no blocking lock.
-- A reversal path is written at the foot of this file.

REVOKE EXECUTE ON FUNCTION public.redeem_invite_code(text) FROM anon;

-- Restated so the intended end state is explicit rather than inherited.
GRANT EXECUTE ON FUNCTION public.redeem_invite_code(text) TO authenticated;

COMMENT ON FUNCTION public.redeem_invite_code(text) IS
    'Atomically consume one use of an invite code (single UPDATE guard, no race). '
    'Returns true iff consumed. Consuming, so authenticated only: the pre-auth '
    'check is public.is_invite_code_valid(), which does not mutate.';

-- ---------------------------------------------------------------------------
-- DOWN PATH (reversal)
--
-- Restores the prior grant state. Guarded and idempotent, so a partial apply
-- reverses cleanly and a second run is a no-op.
--
--   GRANT EXECUTE ON FUNCTION public.redeem_invite_code(text) TO anon;
--
-- Reversal note: reversing this re-opens the consuming function to callers
-- with no session. Any use already consumed stays consumed, because a spent
-- use is not restored by changing a grant.
-- ---------------------------------------------------------------------------
