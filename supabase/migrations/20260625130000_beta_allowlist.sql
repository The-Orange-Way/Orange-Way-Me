-- Beta allowlist: which email addresses are permitted to sign up.
--
-- The signup form (AuthScreen) calls public.is_email_in_beta_allowlist
-- via RPC BEFORE supabase.auth.signUp; if the email is not on the
-- list, the form short-circuits with a "private beta" toast.
--
-- The RPC is SECURITY DEFINER so anon/authenticated callers can check
-- whether AN email is allowed (returns just a bool) without being
-- able to read the full list. RLS on the table denies all
-- anon/authenticated access; only service_role and the SECURITY
-- DEFINER function can read or write.
--
-- Server-side enforcement gap (tracked as follow-up): a determined
-- attacker can call supabase.auth.signUp directly and create the user
-- without the SPA's pre-check. Harm bounded (no household, no vault),
-- but should ship a Supabase Auth Before-User-Created Hook that
-- re-runs is_email_in_beta_allowlist server-side. Hook lands in a
-- separate PR alongside the matching OWB Hook so both apps converge
-- on identical enforcement.
--
-- Mirrors the OWB pattern (BIRCH detail on standing thread
-- 2026-06-25). Implementation is fresh (no copy-paste).

CREATE TABLE IF NOT EXISTS public.beta_allowlist (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Email stored exactly as inserted; uniqueness + lookup are
    -- lowercase via the partial index below. Storing the as-inserted
    -- form preserves casing for audit log / future "we invited you on
    -- Friday" UX. The unique index uses LOWER() so duplicate adds of
    -- the same address (any case) fail at insert time.
    email                 TEXT NOT NULL,
    invited_by            UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    invited_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Populated when the operator sends the invite email (manual op
    -- today; may be automated via a Pages Function later).
    invitation_sent_at    TIMESTAMPTZ,
    -- Populated when the user actually signs up. Lets a future
    -- analytics query compute "invite → signup" conversion without
    -- joining against auth.users (which is restricted).
    signed_up_at          TIMESTAMPTZ,
    note                  TEXT
);

-- Lowercase-unique index. Casts on every insert/update; cheap, makes
-- the lookup-by-email path O(log n) at any case.
CREATE UNIQUE INDEX IF NOT EXISTS beta_allowlist_email_lower_uidx
    ON public.beta_allowlist (LOWER(email));

-- RLS: deny-all for anon and authenticated. Only service_role and the
-- SECURITY DEFINER function below can read. service_role can write.
ALTER TABLE public.beta_allowlist ENABLE ROW LEVEL SECURITY;

-- No SELECT policy for anon/authenticated: the table content is
-- considered semi-sensitive (knowing who's invited could be used to
-- enumerate the beta). The function returns just a bool, which is the
-- safe surface for a public caller. service_role keeps full access by
-- bypassing RLS.
COMMENT ON TABLE public.beta_allowlist IS
    'Email addresses permitted to sign up during private beta. '
    'RLS denies all anon/authenticated reads; check membership via '
    'public.is_email_in_beta_allowlist(). Writes are service_role '
    '/ migration-only today; an admin UI for inviting lands later.';

-- The membership-check function. SECURITY DEFINER so the caller does
-- not need SELECT on the table. Returns FALSE on lookup miss; never
-- raises (so callers can treat error == fail-closed via the client).
--
-- Lowercase comparison so case differences in the input don't allow
-- bypass.
CREATE OR REPLACE FUNCTION public.is_email_in_beta_allowlist(
    p_email TEXT
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF p_email IS NULL OR LENGTH(p_email) = 0 THEN
        RETURN FALSE;
    END IF;
    RETURN EXISTS (
        SELECT 1
        FROM public.beta_allowlist
        WHERE LOWER(email) = LOWER(p_email)
    );
END;
$$;

REVOKE ALL ON FUNCTION public.is_email_in_beta_allowlist(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_email_in_beta_allowlist(TEXT) TO anon, authenticated;

COMMENT ON FUNCTION public.is_email_in_beta_allowlist(TEXT) IS
    'Returns TRUE iff p_email matches an entry in beta_allowlist '
    '(case-insensitive). SECURITY DEFINER so anon callers can check '
    'their own email before sign-up without being able to read the '
    'full list. Returns FALSE on null/empty input. Mirrors the OWB '
    'allowlist primitive for cross-product UX consistency.';

-- Seed the operator email so the founder can sign up on prod from
-- day one. Idempotent: ON CONFLICT updates the note.
INSERT INTO public.beta_allowlist (email, note)
VALUES
    ('miguel@orangeway.app', 'Founder; seeded with the migration that introduces the allowlist primitive.')
ON CONFLICT ((LOWER(email))) DO UPDATE
    SET note = EXCLUDED.note;
