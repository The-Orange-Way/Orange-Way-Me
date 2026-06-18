-- Allow active household members (not just the owner) to SELECT their
-- household row. An earlier migration added
-- primary_currency / reporting_currency / btc_display_mode to
-- households as plaintext display preferences, but the only policy on
-- households is `households_owner_all` (owner-only), so non-owner
-- members never receive the row — their dashboard falls back to
-- USD/btc defaults forever.
--
-- The new columns are non-sensitive (display preferences, not amounts);
-- exposing them to active members is the intended behavior. The
-- owner-only WRITE constraint stays in place via the existing policy's
-- WITH CHECK.
--
-- Idempotent: DROP IF EXISTS first.

BEGIN;

DROP POLICY IF EXISTS "households_select_active_member" ON public.households;
CREATE POLICY "households_select_active_member" ON public.households
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
        FROM public.household_members hm
       WHERE hm.household_id = households.id
         AND hm.user_id      = auth.uid()
         AND hm.status       = 'active'
         AND hm.revoked_at IS NULL
    )
  );

COMMENT ON POLICY "households_select_active_member" ON public.households IS
  'Active non-owner household members can SELECT the household row so they '
  'see shared display preferences (primary_currency, reporting_currency, '
  'btc_display_mode). Owner SELECT/INSERT/UPDATE/DELETE remains covered by '
  'households_owner_all. WRITE access is NOT granted to non-owners.';

COMMIT;
