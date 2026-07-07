-- Before-User-Created auth hook: the authoritative, server-side signup gate.
--
-- Until now, both signup authorizations were enforced only in the browser:
-- AuthScreen calls is_email_in_beta_allowlist and JoinPage calls
-- is_invite_code_valid BEFORE supabase.auth.signUp. A caller who skips the
-- SPA and hits the auth endpoint directly creates a user with neither. The
-- beta_allowlist migration (20260625130000) already named this gap and the
-- fix: a Before-User-Created hook that re-runs the check on the server.
--
-- This function is that hook. GoTrue invokes it as supabase_auth_admin
-- during signup, before the user row is created, with the event payload
-- documented by Supabase: the email at event->'user'->>'email' and any
-- client-supplied metadata at event->'user'->'user_metadata'. It returns
-- an empty object to allow, or an {error:{http_code,message}} object to
-- reject.
--
-- Allow iff the email is on the beta allowlist OR a valid invite code was
-- presented. The code travels in user_metadata (JoinPage passes it as
-- options.data.invite_code on signUp). user_metadata is client-controlled,
-- but that grants no bypass: is_invite_code_valid decides against the table,
-- so a forged or made-up code fails the predicate. Enforcement is
-- fail-closed: anything that is neither allowlisted nor a valid code is
-- rejected.
--
-- Non-consuming on purpose. Redemption stays the separate atomic
-- redeem_invite_code call after the account exists, so a signup that fails
-- downstream of this hook never burns a use. The hook authorizes; it does
-- not count.
--
-- The hook only delegates to two SECURITY DEFINER checks (each of which
-- self-elevates to read its table), so it needs no direct table grants and
-- is a plain INVOKER function with search_path pinned to '' and every
-- reference schema-qualified.

CREATE OR REPLACE FUNCTION public.enforce_beta_signup(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
    v_email text;
    v_code  text;
BEGIN
    v_email := event -> 'user' ->> 'email';
    v_code  := event -> 'user' -> 'user_metadata' ->> 'invite_code';

    IF public.is_email_in_beta_allowlist(v_email)
       OR public.is_invite_code_valid(v_code) THEN
        RETURN '{}'::jsonb;
    END IF;

    RETURN jsonb_build_object(
        'error', jsonb_build_object(
            'http_code', 403,
            'message', 'Orange Way is in private beta. You need an invite to create an account.'
        )
    );
END;
$$;

-- Only GoTrue (supabase_auth_admin) may run the hook. Deny everyone else.
REVOKE EXECUTE ON FUNCTION public.enforce_beta_signup(jsonb) FROM public, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.enforce_beta_signup(jsonb) TO supabase_auth_admin;

-- The hook runs as supabase_auth_admin and calls these two checks, so the
-- auth admin needs execute on them. Both are SECURITY DEFINER, so they still
-- read their tables as the owner; this grant only lets the hook invoke them.
GRANT EXECUTE ON FUNCTION public.is_email_in_beta_allowlist(text) TO supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.is_invite_code_valid(text) TO supabase_auth_admin;

COMMENT ON FUNCTION public.enforce_beta_signup(jsonb) IS
    'Before-User-Created auth hook. Allows signup iff the email is on '
    'beta_allowlist OR user_metadata.invite_code is a currently-valid invite '
    'code; otherwise rejects 403. Register under Auth > Hooks (Before User '
    'Created) in the project dashboard; it is inert until registered.';
