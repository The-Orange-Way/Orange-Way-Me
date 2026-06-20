-- ============================================================
-- ow-or-proxy: per-user-per-hour rate-limit table + RPC
-- ============================================================
-- Audit finding (cybersec persona, 2026-06-19). The ow-or-proxy edge
-- function had no per-user rate limit. An authenticated user could
-- flood OR's platform endpoints via the proxy, abusing both our
-- quota and OR's.
--
-- This migration adds:
--   - public.ow_or_proxy_rate_limit (user_id, hour_bucket, count)
--   - public.increment_ow_or_proxy_rate(p_user_id uuid) RETURNS int
--     SECURITY DEFINER, idempotently increments the current hour's
--     counter and returns the post-increment count.
--
-- The edge function calls this RPC at the top of each request, after
-- JWT verification. If the returned count exceeds 60 the function
-- returns 429 with Retry-After.
--
-- Cleanup: old rows are kept for one day so an operator can audit
-- recent flood attempts. A separate pg_cron job (configured outside
-- this migration) trims rows older than 24h.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.ow_or_proxy_rate_limit (
  user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  hour_bucket timestamptz NOT NULL,
  count       int         NOT NULL DEFAULT 1,
  PRIMARY KEY (user_id, hour_bucket)
);

COMMENT ON TABLE public.ow_or_proxy_rate_limit IS
  'Per-user-per-hour request counter for the ow-or-proxy edge function. Written exclusively by the increment_ow_or_proxy_rate SECURITY DEFINER RPC.';

CREATE INDEX IF NOT EXISTS idx_ow_or_proxy_rate_limit_hour
  ON public.ow_or_proxy_rate_limit (hour_bucket);

-- Rate-limit reads must not be exposed to clients. Lock the table.
ALTER TABLE public.ow_or_proxy_rate_limit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ow_or_proxy_rate_limit_deny_all" ON public.ow_or_proxy_rate_limit;
CREATE POLICY "ow_or_proxy_rate_limit_deny_all"
  ON public.ow_or_proxy_rate_limit FOR ALL
  USING (false) WITH CHECK (false);

CREATE OR REPLACE FUNCTION public.increment_ow_or_proxy_rate(p_user_id uuid)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hour  timestamptz := date_trunc('hour', now());
  v_count int;
BEGIN
  INSERT INTO public.ow_or_proxy_rate_limit (user_id, hour_bucket, count)
  VALUES (p_user_id, v_hour, 1)
  ON CONFLICT (user_id, hour_bucket)
  DO UPDATE SET count = ow_or_proxy_rate_limit.count + 1
  RETURNING count INTO v_count;
  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public.increment_ow_or_proxy_rate(uuid) IS
  'Atomic per-user-per-hour counter increment. Called by the ow-or-proxy edge function after JWT verification. Returns the post-increment count.';

REVOKE ALL ON FUNCTION public.increment_ow_or_proxy_rate(uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_ow_or_proxy_rate(uuid) TO service_role;
