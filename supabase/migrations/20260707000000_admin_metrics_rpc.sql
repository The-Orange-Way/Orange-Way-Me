-- Admin metrics RPC: aggregate, admin-only visibility into signups and
-- activity for the private beta.
--
-- Returns COUNTS ONLY. It never returns per-user rows and never touches any
-- vault content: financial payloads are client-encrypted and unreadable
-- server-side by construction, so there is nothing here that could leak a
-- user's data. The server already legitimately sees this metadata line
-- (user counts, signup timestamps), which is all this function exposes.
--
-- Self-gates on has_role(auth.uid(), 'admin'): a non-admin caller gets an
-- exception, so EXECUTE can be granted to all authenticated users without
-- leaking. auth.uid() reflects the caller's JWT even inside a SECURITY
-- DEFINER body, so the admin check identifies the real caller.
--
-- SECURITY DEFINER so it can count auth.users (which authenticated callers
-- cannot read directly). search_path is pinned to public.
--
-- Builds on the existing app_role enum, user_roles table, and has_role()
-- function (migration 20260428211238). No new tables, no data changes,
-- no locks on existing tables: this is a pure function definition.

CREATE OR REPLACE FUNCTION public.admin_metrics()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'not authorized' USING errcode = '42501';
  END IF;

  SELECT jsonb_build_object(
    'generated_at', now(),
    'total_users', (SELECT count(*) FROM auth.users),
    'users_confirmed', (SELECT count(*) FROM auth.users WHERE email_confirmed_at IS NOT NULL),
    'signups_last_7d', (SELECT count(*) FROM auth.users WHERE created_at >= now() - interval '7 days'),
    'signups_last_30d', (SELECT count(*) FROM auth.users WHERE created_at >= now() - interval '30 days'),
    'allowlist_total', (SELECT count(*) FROM public.beta_allowlist),
    'allowlist_invited', (SELECT count(*) FROM public.beta_allowlist WHERE invitation_sent_at IS NOT NULL),
    'allowlist_signed_up', (SELECT count(*) FROM public.beta_allowlist WHERE signed_up_at IS NOT NULL),
    'applications_total', (SELECT count(*) FROM public.beta_applications),
    'signups_daily_30d', (
      SELECT coalesce(
        jsonb_agg(jsonb_build_object('day', d.day, 'count', d.c) ORDER BY d.day),
        '[]'::jsonb
      )
      FROM (
        SELECT date_trunc('day', created_at)::date AS day, count(*) AS c
        FROM auth.users
        WHERE created_at >= now() - interval '30 days'
        GROUP BY 1
      ) d
    )
  ) INTO result;

  RETURN result;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_metrics() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_metrics() TO authenticated;

COMMENT ON FUNCTION public.admin_metrics() IS
  'Admin-only aggregate metrics (counts only, no per-user data, no vault content). '
  'Self-gates on has_role(auth.uid(), ''admin''). SECURITY DEFINER to count auth.users.';
