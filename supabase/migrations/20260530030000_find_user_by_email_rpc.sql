-- P2 (from 2026-05-16 audit): replace auth.admin.listUsers paginate-50x
-- linear scan with a single indexed lookup. Both invite-household-member
-- and admin-update-household-member paginate through up to 50K auth.users
-- rows to find one user by email. O(n) per invite; breaks past 50K users.
--
-- This RPC runs as SECURITY DEFINER, exposes only the user_id (never
-- emails or anything else), and is callable only by the service_role
-- (REVOKEd from authenticated). The underlying lookup hits auth.users'
-- email btree index — single round trip.
--
-- Idempotent.

BEGIN;

CREATE OR REPLACE FUNCTION public.find_user_id_by_email(p_email TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_id UUID;
BEGIN
  IF p_email IS NULL OR p_email = '' THEN
    RETURN NULL;
  END IF;

  SELECT id INTO v_id
    FROM auth.users
   WHERE lower(email) = lower(p_email)
   LIMIT 1;

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.find_user_id_by_email(TEXT) IS
  'P2 audit fix: replace edge-function listUsers linear scan. Returns '
  'NULL when no user matches. Service-role only — REVOKEd from '
  'authenticated and anon below.';

-- Lock down: only service_role + postgres can call. Anon/authenticated
-- cannot enumerate users by email through this RPC.
REVOKE ALL ON FUNCTION public.find_user_id_by_email(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.find_user_id_by_email(TEXT) FROM authenticated;
REVOKE ALL ON FUNCTION public.find_user_id_by_email(TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.find_user_id_by_email(TEXT) TO service_role;

COMMIT;
