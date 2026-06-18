ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS cleared_status TEXT DEFAULT NULL;

COMMENT ON COLUMN public.transactions.cleared_status IS
  'Reconciliation status. NULL = unreconciled, ''cleared'' = user-flagged, ''reconciled'' = batch-reconciled.';