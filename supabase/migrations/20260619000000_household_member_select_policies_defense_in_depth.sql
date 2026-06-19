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
-- expands what active household members can see — never restricts.
-- ============================================================

-- accounts
CREATE POLICY IF NOT EXISTS "accounts_select_household_members"
  ON public.accounts FOR SELECT TO authenticated
  USING (
    household_id IS NOT NULL
    AND public.user_is_active_household_member(household_id)
  );

-- transactions
CREATE POLICY IF NOT EXISTS "transactions_select_household_members"
  ON public.transactions FOR SELECT TO authenticated
  USING (
    household_id IS NOT NULL
    AND public.user_is_active_household_member(household_id)
  );

-- categories
CREATE POLICY IF NOT EXISTS "categories_select_household_members"
  ON public.categories FOR SELECT TO authenticated
  USING (
    household_id IS NOT NULL
    AND public.user_is_active_household_member(household_id)
  );

-- budgets
CREATE POLICY IF NOT EXISTS "budgets_select_household_members"
  ON public.budgets FOR SELECT TO authenticated
  USING (
    household_id IS NOT NULL
    AND public.user_is_active_household_member(household_id)
  );

-- goals
CREATE POLICY IF NOT EXISTS "goals_select_household_members"
  ON public.goals FOR SELECT TO authenticated
  USING (
    household_id IS NOT NULL
    AND public.user_is_active_household_member(household_id)
  );

-- rules
CREATE POLICY IF NOT EXISTS "rules_select_household_members"
  ON public.rules FOR SELECT TO authenticated
  USING (
    household_id IS NOT NULL
    AND public.user_is_active_household_member(household_id)
  );
