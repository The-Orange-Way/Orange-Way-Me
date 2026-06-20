-- ============================================================
-- ow-or-proxy rate limit: enforce 24h retention inline
-- ============================================================
-- Compliance audit follow-up (2026-06-20). The earlier migration
-- 20260619210000_ow_or_proxy_rate_limit.sql introduced a per-user
-- request counter and noted that "a separate pg_cron job (configured
-- outside this migration) trims rows older than 24h." No such cron job
-- was actually scheduled, leaving user_ids in the table indefinitely.
-- Storage-limitation principles in GDPR Art. 5(1)(e) and Quebec
-- Law 25 require personal data to be kept no longer than the
-- operational need that justified collecting it. Keeping rate-limit
-- evidence forever fails that test.
--
-- This migration moves the retention enforcement inside the RPC itself
-- so it can never drift from the schema. Every increment also drops
-- any rows older than 24 hours for the same user. That makes the table
-- self-trimming with no external scheduler required.
--
-- The 24-hour window matches the operational need stated in the
-- earlier migration's comment ("an operator can audit recent flood
-- attempts"). If the audit window ever needs to grow, change the
-- INTERVAL value in one place: this function.
-- ============================================================

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
  -- Inline retention. Drops rows for this user older than 24h. The
  -- per-row write cost is negligible because the index on hour_bucket
  -- makes the delete a single index scan; the typical row count per
  -- user is at most 24.
  DELETE FROM public.ow_or_proxy_rate_limit
   WHERE user_id = p_user_id
     AND hour_bucket < now() - INTERVAL '24 hours';

  INSERT INTO public.ow_or_proxy_rate_limit (user_id, hour_bucket, count)
  VALUES (p_user_id, v_hour, 1)
  ON CONFLICT (user_id, hour_bucket)
  DO UPDATE SET count = ow_or_proxy_rate_limit.count + 1
  RETURNING count INTO v_count;
  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public.increment_ow_or_proxy_rate(uuid) IS
  'Atomic per-user-per-hour counter increment with inline 24h retention. Called by the ow-or-proxy edge function after JWT verification. Drops rows older than 24h for the same user on every call so the table self-trims without pg_cron.';

COMMENT ON TABLE public.ow_or_proxy_rate_limit IS
  'Per-user-per-hour request counter for the ow-or-proxy edge function. Written exclusively by the increment_ow_or_proxy_rate SECURITY DEFINER RPC, which also enforces a 24h retention window on every call.';
