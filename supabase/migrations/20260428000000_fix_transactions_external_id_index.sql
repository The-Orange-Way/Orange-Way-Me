-- ============================================================
-- Fix: replace partial unique index with regular unique index
-- ============================================================
-- PostgREST (Supabase REST API) cannot use a partial unique index
-- for ON CONFLICT resolution. The previous migration created:
--   CREATE UNIQUE INDEX ... WHERE external_id IS NOT NULL
-- which causes Postgres error 42P10 when the upsert fires.
--
-- A regular non-partial unique index is safe because PostgreSQL
-- treats NULLs as distinct in unique indexes — so manual
-- transactions with NULL external_id never conflict with each other
-- or with imported rows.

DROP INDEX IF EXISTS idx_transactions_external;

CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_external
  ON public.transactions(user_id, external_source, external_id);
