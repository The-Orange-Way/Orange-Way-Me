/**
 * row-signing — Phase 4.4 helper that builds the trio of column values
 * every mutation on a signed encrypted table must include:
 *
 *   { household_id, signature_b64, signature_key_version }
 *
 * The six signed OW tables are: transactions, accounts, categories,
 * budgets, goals, rules. Each has a server-side BEFORE-trigger that
 * checks the ML-DSA-65 signature when household_id IS NOT NULL and an
 * HSK has been minted for the household. Personal (household_id NULL)
 * rows short-circuit the trigger and need no signature.
 *
 * The canonical signed payload is the household_id as UTF-8 bytes —
 * mirrors the trigger's `convert_to(v_household_id::TEXT, 'UTF8')`
 * comparison in
 * `supabase/migrations/20260514234456_phase4_4_household_auditor_support_osk.sql`.
 *
 * Kept in its own pure module so the wiring is unit-testable without a
 * React tree. VaultContext wires its in-memory HSK cache through this
 * helper to expose `buildHouseholdSignatureFields` to every hook.
 */
import type { OskHandle } from "@/lib/osk";
import { signMutation as oskSignMutation } from "@/lib/osk";

export interface HouseholdSignatureFields {
  household_id: string | null;
  signature_b64: string | null;
  signature_key_version: number | null;
}

/**
 * Build the household-scope + signature fields for an insert/update.
 *
 *   - No active household → all-NULL (personal row, trigger skips).
 *   - Active household, HSK cached → fully signed payload.
 *   - Active household, HSK not yet cached → household_id present,
 *     signature columns NULL. The trigger accepts NULL signatures
 *     until an HSK exists for the household; once it does, this
 *     branch will fail server-side. The silent first-time mint on
 *     unlock is what closes that window. Read-only roles (Auditor)
 *     also land here — they have no wrap and the trigger blocks
 *     their writes for a different reason (role check).
 */
export function buildHouseholdSignatureFields(
  householdId: string | null,
  handle: OskHandle | null,
): HouseholdSignatureFields {
  if (!householdId) {
    return {
      household_id: null,
      signature_b64: null,
      signature_key_version: null,
    };
  }
  if (!handle) {
    return {
      household_id: householdId,
      signature_b64: null,
      signature_key_version: null,
    };
  }
  const payloadBytes = new TextEncoder().encode(householdId);
  const sig = oskSignMutation(payloadBytes, handle);
  return {
    household_id: householdId,
    signature_b64: sig.signature_b64,
    signature_key_version: sig.key_version,
  };
}

/**
 * The exact byte payload the server trigger reconstructs and verifies.
 * Exposed for tests and audit tooling — callers should not need this.
 */
export function canonicalRowSignaturePayload(householdId: string): Uint8Array {
  return new TextEncoder().encode(householdId);
}
