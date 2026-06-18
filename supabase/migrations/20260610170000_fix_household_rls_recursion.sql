-- ============================================================
-- Fix infinite recursion in household RLS policies
-- ============================================================
-- Symptom: every SELECT against `households` or `household_members`
-- returned HTTP 500 with Postgres error 42P17 "infinite recursion
-- detected in policy for relation 'household_members'". Visible as
-- repeated red errors on dev.orangeway.app/connections page load
-- 2026-06-10.
--
-- Root cause: the policy graph after migration 20260527010000
-- ("households_select_for_members") forms a cycle.
--
--   households_select_active_member (on households)
--      USING: EXISTS(SELECT FROM household_members hm
--                    WHERE hm.household_id = households.id AND ...)
--
--   household_members_own_read (on household_members)
--      USING: user_id = auth.uid()
--          OR household_id IN (SELECT id FROM households
--                              WHERE owner_id = auth.uid())
--
-- When Postgres evaluates the EXISTS in households_select_active_member,
-- it queries household_members, which fires household_members_own_read,
-- which queries households, which fires the original policy, which
-- queries household_members, … 42P17.
--
-- Fix: route both sides through SECURITY DEFINER helper functions that
-- bypass RLS. The functions own their own visibility logic; the policies
-- just delegate. No cross-table policy graph, no recursion.

-- ── 1. Helper functions (SECURITY DEFINER, STABLE) ───────────────────

-- Returns true if the calling user is an active, non-revoked member of
-- the given household. SECURITY DEFINER so the SELECT bypasses RLS on
-- household_members itself.
CREATE OR REPLACE FUNCTION public.user_is_active_household_member(hh_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.household_members hm
    WHERE hm.household_id = hh_id
      AND hm.user_id = auth.uid()
      AND hm.status = 'active'
      AND hm.revoked_at IS NULL
  );
$$;

REVOKE EXECUTE ON FUNCTION public.user_is_active_household_member(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.user_is_active_household_member(uuid) TO authenticated;

COMMENT ON FUNCTION public.user_is_active_household_member(uuid) IS
  'SECURITY DEFINER membership check used by RLS policies on households '
  'and household_members. Bypasses RLS to avoid policy recursion. Returns '
  'true iff calling auth.uid() is an active, non-revoked member of the '
  'household.';

-- Returns true if the calling user owns the given household. SECURITY
-- DEFINER so the SELECT bypasses RLS on households itself.
CREATE OR REPLACE FUNCTION public.user_owns_household(hh_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.households h
    WHERE h.id = hh_id
      AND h.owner_id = auth.uid()
  );
$$;

REVOKE EXECUTE ON FUNCTION public.user_owns_household(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.user_owns_household(uuid) TO authenticated;

COMMENT ON FUNCTION public.user_owns_household(uuid) IS
  'SECURITY DEFINER ownership check used by RLS policies on household_members. '
  'Bypasses RLS to avoid policy recursion. Returns true iff calling auth.uid() '
  'owns the household.';

-- ── 2. Recreate the recursive policies using the helpers ─────────────

-- household_members: own rows + rows in households the user owns
DROP POLICY IF EXISTS "household_members_own_read" ON public.household_members;
CREATE POLICY "household_members_own_read"
  ON public.household_members FOR SELECT
  USING (
    user_id = auth.uid()
    OR public.user_owns_household(household_id)
  );

-- household_members: owner can INSERT / UPDATE / DELETE members of their household
DROP POLICY IF EXISTS "household_members_owner_write" ON public.household_members;
CREATE POLICY "household_members_owner_write"
  ON public.household_members FOR ALL
  USING (public.user_owns_household(household_id))
  WITH CHECK (public.user_owns_household(household_id));

-- households: active members can SELECT (the cross-table check
-- replaces the EXISTS subquery)
DROP POLICY IF EXISTS "households_select_active_member" ON public.households;
CREATE POLICY "households_select_active_member"
  ON public.households FOR SELECT
  USING (public.user_is_active_household_member(id));

-- ── 3. Sanity comment ─────────────────────────────────────────────────

COMMENT ON POLICY "household_members_own_read" ON public.household_members IS
  'Rewritten 2026-06-10 to break RLS recursion: cross-table household '
  'ownership check delegated to user_owns_household() (SECURITY DEFINER).';

COMMENT ON POLICY "household_members_owner_write" ON public.household_members IS
  'Rewritten 2026-06-10 to break RLS recursion via user_owns_household().';

COMMENT ON POLICY "households_select_active_member" ON public.households IS
  'Rewritten 2026-06-10 to break RLS recursion via '
  'user_is_active_household_member() (SECURITY DEFINER).';
