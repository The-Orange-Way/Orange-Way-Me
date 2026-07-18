-- Invite codes: a link + code lets a person join the private beta without
-- the operator pre-collecting their email. The code is the invite; the user
-- still sets their own email + password at signup (needed for vault-key
-- derivation and recovery), so the operator never has to know it in advance.
--
-- This composes with, and for code holders replaces, the email allowlist:
-- signup is permitted when the email is on beta_allowlist OR a valid,
-- unredeemed, unexpired code is presented. The authoritative, unbypassable
-- enforcement is the Supabase Before-User-Created auth hook (tracked as a
-- follow-up, same posture as the existing allowlist client pre-check). The
-- client RPCs below are the UX gate and the best-effort redemption until the
-- hook lands.
--
-- RLS denies all anon/authenticated access to the table itself. The only
-- surfaces a caller touches are the two SECURITY DEFINER functions, each
-- with search_path pinned to '' and every reference schema-qualified.

CREATE TABLE IF NOT EXISTS public.invite_codes (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Stored as inserted; uniqueness + lookup are lowercase via the index
    -- below, so a code is case-insensitive at redemption time.
    code        text NOT NULL,
    max_uses    integer NOT NULL DEFAULT 1 CHECK (max_uses >= 1),
    uses        integer NOT NULL DEFAULT 0 CHECK (uses >= 0),
    expires_at  timestamptz,
    revoked     boolean NOT NULL DEFAULT false,
    created_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    note        text,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS invite_codes_code_lower_uidx
    ON public.invite_codes (lower(code));

ALTER TABLE public.invite_codes ENABLE ROW LEVEL SECURITY;

-- No SELECT/INSERT/UPDATE/DELETE policies for anon or authenticated: the
-- table is fully closed to end users. service_role (operator scripts) and
-- the SECURITY DEFINER functions below are the only ways in. Knowing whether
-- a code exists is exposed only through the bool-returning validate function.
COMMENT ON TABLE public.invite_codes IS
    'Private-beta invite codes. RLS denies all anon/authenticated access. '
    'Validate via public.is_invite_code_valid(); redeem via '
    'public.redeem_invite_code(). Writes are service_role / migration-only.';

-- Non-consuming validity check. Returns a bool only (safe public surface,
-- mirrors is_email_in_beta_allowlist). Callable pre-auth (anon) because the
-- signup form gates on it before the user has a session. Never raises, so a
-- client can treat error as fail-closed.
CREATE OR REPLACE FUNCTION public.is_invite_code_valid(p_code text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.invite_codes
        WHERE lower(code) = lower(p_code)
          AND NOT revoked
          AND (expires_at IS NULL OR expires_at > now())
          AND uses < max_uses
    );
$$;

-- Atomic redemption. The single UPDATE ... WHERE uses < max_uses is the
-- whole guard: two concurrent redemptions of a max_uses = 1 code cannot both
-- succeed, because the row-level lock serializes them and the second sees
-- uses = max_uses and matches no row. This is deliberately NOT a
-- SELECT-then-UPDATE, which would race. Returns true iff a use was consumed.
CREATE OR REPLACE FUNCTION public.redeem_invite_code(p_code text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    consumed integer;
BEGIN
    IF p_code IS NULL OR length(p_code) = 0 THEN
        RETURN false;
    END IF;

    UPDATE public.invite_codes
       SET uses = uses + 1
     WHERE lower(code) = lower(p_code)
       AND NOT revoked
       AND (expires_at IS NULL OR expires_at > now())
       AND uses < max_uses;

    GET DIAGNOSTICS consumed = ROW_COUNT;
    RETURN consumed = 1;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.is_invite_code_valid(text) FROM public;
GRANT  EXECUTE ON FUNCTION public.is_invite_code_valid(text) TO anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.redeem_invite_code(text) FROM public;
GRANT  EXECUTE ON FUNCTION public.redeem_invite_code(text) TO anon, authenticated;

COMMENT ON FUNCTION public.is_invite_code_valid(text) IS
    'Non-consuming bool check that a private-beta invite code is currently redeemable.';
COMMENT ON FUNCTION public.redeem_invite_code(text) IS
    'Atomically consume one use of an invite code (single UPDATE guard, no race). Returns true iff consumed.';

-- ---------------------------------------------------------------------------
-- REVERSAL PATH (operator runbook, not executed by the migration runner)
--
-- This block is intentionally commented out. The Supabase CLI applies every
-- .sql file under supabase/migrations in name order, so a live down file next
-- to this one would drop the table on the next apply. To reverse, an operator
-- copies the statements below and runs them by hand against one database.
--
-- Order: functions first (they depend on the table), then the index, then the
-- table. Every statement is IF EXISTS, so a partially applied migration
-- reverses cleanly and a repeated reversal is a no-op.
--
--   DROP FUNCTION IF EXISTS public.redeem_invite_code(text);
--   DROP FUNCTION IF EXISTS public.is_invite_code_valid(text);
--   DROP INDEX    IF EXISTS public.invite_codes_code_lower_uidx;
--   DROP TABLE    IF EXISTS public.invite_codes;
--
-- What reversal undoes: the signup gate and the code store, completely. The
-- table holds no user data, only operator-issued codes, so nothing of a
-- family's is lost.
--
-- What reversal CANNOT undo: an account that a code already admitted. Those
-- rows live in auth.users, are outside this migration's blast radius, and
-- must be removed separately if that is the intent. Dropping the table also
-- destroys the record of which codes were spent, so export invite_codes
-- before reversing if that history matters.
-- ---------------------------------------------------------------------------
