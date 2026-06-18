-- Add transfer_group_id to transactions for transfer pairing
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS transfer_group_id uuid;
CREATE INDEX IF NOT EXISTS idx_transactions_transfer_group ON public.transactions(transfer_group_id);

-- Useful indexes for the transactions UI workload
CREATE INDEX IF NOT EXISTS idx_transactions_user_date ON public.transactions(user_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_account_date ON public.transactions(account_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_hmac_merchant ON public.transactions(user_id, hmac_merchant);
CREATE INDEX IF NOT EXISTS idx_transactions_hmac_category ON public.transactions(user_id, hmac_category);
CREATE INDEX IF NOT EXISTS idx_transactions_split_parent ON public.transactions(split_parent_id);

-- Trigger to bump updated_at on row update (function already exists: set_updated_at)
DROP TRIGGER IF EXISTS trg_transactions_updated_at ON public.transactions;
CREATE TRIGGER trg_transactions_updated_at
BEFORE UPDATE ON public.transactions
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();