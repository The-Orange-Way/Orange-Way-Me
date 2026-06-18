DROP INDEX IF EXISTS idx_transactions_external;

CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_external
  ON public.transactions(user_id, external_source, external_id);