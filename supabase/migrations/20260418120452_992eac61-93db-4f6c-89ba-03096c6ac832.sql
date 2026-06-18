
-- Add type column to categories (income | expense | transfer)
ALTER TABLE public.categories
  ADD COLUMN IF NOT EXISTS type text NOT NULL DEFAULT 'expense';

ALTER TABLE public.categories
  ADD CONSTRAINT categories_type_check CHECK (type IN ('income', 'expense', 'transfer'));

-- Add is_manual_category flag to transactions (suppresses rule overwrites)
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS is_manual_category boolean NOT NULL DEFAULT false;

-- Helpful index for budget month lookups
CREATE INDEX IF NOT EXISTS idx_budgets_user_month ON public.budgets(user_id, month);
