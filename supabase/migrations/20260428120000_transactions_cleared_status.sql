-- ============================================================
-- Add cleared_status for wallet reconciliation
-- ============================================================
-- Stores the reconciliation state per transaction.
-- NULL = unreconciled (default)
-- 'cleared'    = user has manually flagged this transaction
-- 'reconciled' = included in a completed reconciliation batch
--
-- Intentionally plaintext: the status values themselves reveal no
-- financial information — only that the user reviewed the transaction.

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS cleared_status TEXT DEFAULT NULL;

COMMENT ON COLUMN public.transactions.cleared_status IS
  'Reconciliation status. NULL = unreconciled, ''cleared'' = user-flagged, ''reconciled'' = batch-reconciled.';
