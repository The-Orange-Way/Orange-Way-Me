ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS external_id TEXT,
  ADD COLUMN IF NOT EXISTS external_source TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_external
  ON public.transactions(user_id, external_source, external_id)
  WHERE external_id IS NOT NULL;

COMMENT ON COLUMN public.transactions.external_id IS
  'Phase 5: external system identifier (e.g. OR transaction UUID). NULL for manually-entered transactions. Combined with external_source via a unique partial index to make re-imports idempotent.';

COMMENT ON COLUMN public.transactions.external_source IS
  'Phase 5: which external system produced this row. Currently one of: ''orangerails''. NULL for manually-entered transactions.';