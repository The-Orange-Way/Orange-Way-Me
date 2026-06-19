-- ============================================================
-- Defense-in-depth: household-member SELECT policies on shared tables
-- ============================================================
-- Audit finding H1 (2026-06-18 full review). The shared-household
-- tables (accounts, transactions, categories, budgets, goals, rules)
-- currently have only `user_id = auth.uid()` SELECT policies. Today,
-- shared reads work because edge functions use the service-role key
-- (which bypasses RLS) to fetch on a member's behalf, then return
-- ciphertext that the client unwraps with the household DEK.
--
-- This works, but there is no RLS safety net: any future edge function
-- that calls adminClient.from(<shared-table>).select() without an
-- explicit household-scope filter would return every user's rows.
-- We're trusting code review forever rather than the database.
--
-- Fix: add a second SELECT policy on each shared table that allows
-- members of the same household to read household-scoped rows. The
-- existing user_is_active_household_member() SECURITY DEFINER helper
-- (added in 20260610170000_fix_household_rls_recursion.sql) avoids
-- reintroducing the policy-graph recursion.
--
-- This change is additive: SELECT policies OR together, so existing
-- "row owner can read" behavior is preserved and the new policy only
-- expands what active household members can see, never restricts.
--
-- Idempotency: Postgres does not support CREATE POLICY IF NOT EXISTS.
-- We DROP IF EXISTS first, then CREATE. Safe to re-run.
-- ============================================================

-- accounts
DROP POLICY IF EXISTS "accounts_select_household_members" ON public.accounts;
CREATE POLICY "accounts_select_household_members"
  ON public.accounts FOR SELECT TO authenticated
  USING (
    household_id IS NOT NULL
    AND public.user_is_active_household_member(household_id)
  );

-- transactions
DROP POLICY IF EXISTS "transactions_select_household_members" ON public.transactions;
CREATE POLICY "transactions_select_household_members"
  ON public.transactions FOR SELECT TO authenticated
  USING (
    household_id IS NOT NULL
    AND public.user_is_active_household_member(household_id)
  );

-- categories
DROP POLICY IF EXISTS "categories_select_household_members" ON public.categories;
CREATE POLICY "categories_select_household_members"
  ON public.categories FOR SELECT TO authenticated
  USING (
    household_id IS NOT NULL
    AND public.user_is_active_household_member(household_id)
  );

-- budgets
DROP POLICY IF EXISTS "budgets_select_household_members" ON public.budgets;
CREATE POLICY "budgets_select_household_members"
  ON public.budgets FOR SELECT TO authenticated
  USING (
    household_id IS NOT NULL
    AND public.user_is_active_household_member(household_id)
  );

-- goals
DROP POLICY IF EXISTS "goals_select_household_members" ON public.goals;
CREATE POLICY "goals_select_household_members"
  ON public.goals FOR SELECT TO authenticated
  USING (
    household_id IS NOT NULL
    AND public.user_is_active_household_member(household_id)
  );

-- rules
DROP POLICY IF EXISTS "rules_select_household_members" ON public.rules;
CREATE POLICY "rules_select_household_members"
  ON public.rules FOR SELECT TO authenticated
  USING (
    household_id IS NOT NULL
    AND public.user_is_active_household_member(household_id)
  );
