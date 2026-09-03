-- DO NOT MERGE. Deliberate violation, used only to watch the definer gate go red.
--
-- This is the failure OWM-T0599 is about: replacing a SECURITY DEFINER
-- function resets EXECUTE to PUBLIC, and PUBLIC includes anon, with no GRANT
-- line anywhere for the older rule to find. The matching
-- REVOKE EXECUTE ... FROM PUBLIC, anon is omitted on purpose.

BEGIN;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role
  );
$$;

COMMIT;
