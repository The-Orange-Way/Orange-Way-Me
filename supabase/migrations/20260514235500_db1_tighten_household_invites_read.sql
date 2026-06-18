-- ============================================================
-- Tighten household_invites SELECT policy
-- ============================================================
-- Before this migration the SELECT policy `household_invites_accept_read`
-- used `auth.uid() IS NOT NULL`, meaning any authenticated user could
-- read every row in household_invites — hashed codes, email addresses,
-- email_hash, recipient_user_id, etc. That's a cross-household
-- information disclosure: an attacker with any account could enumerate
-- every pending invite across every household.
--
-- The data at rest is encrypted/hashed where appropriate (`code` is a
-- token, `email_hash` is a hash), but the SELECT policy is the wrong
-- knob for that defence-in-depth. Restrict reads to:
--   * the household owner (covered by the existing _owner ALL policy,
--     but we also include it here so SELECT works without relying on
--     ALL-policy semantics under restrictive policy combination),
--   * the inviter who created the invite, and
--   * the recipient once they've been bound (recipient_user_id).
--
-- Flows preserved:
--   * Owner listing pending invites (HouseholdPage / useHousehold).
--   * Owner draining ready_to_wrap rows (completePendingHouseholdWraps).
--   * Recipient inspecting their own bound invite.
--   * invite-household-member + complete-household-invite-wrap edge
--     functions: they use the service-role client and bypass RLS.
--   * link_pending_household_invites_on_keypair_insert trigger: runs as
--     SECURITY DEFINER, bypasses RLS — the bind step that sets
--     recipient_user_id is unaffected.
--
-- ZKA invariant: this tightens a read policy. It introduces no new
-- decryption path and grants no write access. Encrypted/hashed fields
-- stay opaque to the server.
--
-- Idempotent: DROP POLICY IF EXISTS before CREATE.

BEGIN;

DROP POLICY IF EXISTS "household_invites_accept_read" ON public.household_invites;

CREATE POLICY "household_invites_accept_read"
  ON public.household_invites
  FOR SELECT
  TO authenticated
  USING (
    recipient_user_id = auth.uid()
    OR inviter_id = auth.uid()
    OR household_id IN (
      SELECT id FROM public.households WHERE owner_id = auth.uid()
    )
  );

COMMENT ON POLICY "household_invites_accept_read" ON public.household_invites IS
  'Replaces the prior auth.uid() IS NOT NULL '
  'qual that leaked every household_invites row to any signed-in user. '
  'Reads are now scoped to recipient, inviter, or household owner.';

COMMIT;
