-- Indexes on household_id for the six shared tables touched by the new
-- household-member SELECT policies in 20260619000000.
--
-- Why: every household-scope row-level-security policy filters by household_id,
-- either directly or through the user_is_active_household_member(household_id)
-- helper. Without a btree index on the column, Postgres falls back to a
-- sequential scan to enforce the filter. For a single user that is fine; once
-- households have thousands of rows it becomes a quadratic slowdown that any
-- authenticated household member could trigger by querying their own data.
--
-- Tagged with finding #6 of the 2026-06-19 ZKA audit.
--
-- Safe to apply at any time:
--   * CREATE INDEX IF NOT EXISTS is idempotent and lock-light.
--   * btree on a foreign-key column never changes query semantics, only
--     planner cost.
--   * No app code needs to change; Postgres uses the index transparently
--     the next time the planner evaluates a matching predicate.

CREATE INDEX IF NOT EXISTS idx_accounts_household_id
  ON public.accounts (household_id)
  WHERE household_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_transactions_household_id
  ON public.transactions (household_id)
  WHERE household_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_categories_household_id
  ON public.categories (household_id)
  WHERE household_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_budgets_household_id
  ON public.budgets (household_id)
  WHERE household_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_goals_household_id
  ON public.goals (household_id)
  WHERE household_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_rules_household_id
  ON public.rules (household_id)
  WHERE household_id IS NOT NULL;

-- The partial-index predicate (WHERE household_id IS NOT NULL) keeps the
-- index small on tenants that have no household yet. Personal rows skip
-- the index entirely; only shared rows pay the storage cost.
