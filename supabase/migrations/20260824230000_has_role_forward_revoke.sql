-- has_role forward revoke: drop the anon EXECUTE grant on dev (DL-1546)
--
-- public.has_role(_user_id uuid, _role app_role) is SECURITY DEFINER and
-- returns boolean, so every grantee can reach it over PostgREST RPC. On
-- dev its EXECUTE list is {postgres, authenticated, anon, service_role},
-- which lets an unauthenticated caller ask whether an arbitrary user id
-- holds an arbitrary role. The function has zero client callsites: it is
-- referenced only by generated types and by RLS policies, and a policy
-- evaluates has_role as the querying role.
--
-- Evidence that no anon path needs it: prod (tmqjusxxjjcsdgyiqbcg) is
-- already {postgres, authenticated, service_role} and serves normally,
-- so the anon grant is dev-only drift. This moves dev onto the prod
-- shape rather than carrying dev's shape onto prod.
--
-- Idempotent: REVOKE and GRANT are safe to re-apply. A later
-- CREATE OR REPLACE of this function resets EXECUTE to PUBLIC, so this
-- must run after any such change.

BEGIN;

REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, service_role;

COMMIT;
