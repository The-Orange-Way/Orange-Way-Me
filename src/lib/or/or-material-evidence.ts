/**
 * Evidence that an account ever held Orange Rails key material, and the
 * decision that depends on it.
 *
 * WHY THIS EXISTS. `recoverWithCode` rotates `vault_metadata.kdf_salt`. If the
 * row had no Orange Rails material pinned at that moment, the rotation leaves
 * three null OR columns under a brand new salt, which is indistinguishable from
 * a vault that never had OR material at all. Recording the pre-rotation salt in
 * `or_subkey_salt` (the mark) makes the row half-established, and
 * `planOrKeyMaterial` then refuses it permanently rather than minting a
 * replacement key under the new salt and calling that success.
 *
 * That protection is correct for an account that had material sealed under the
 * old salt. It is harmful for an account that never had any: it disables a
 * namespace for a hazard the account was never exposed to. So the mark is
 * written only where there is positive evidence of Orange Rails material, or
 * where we could not tell.
 *
 * FAIL CLOSED MEANS WRITE THE MARK, and this is the whole point of the module.
 * An unnecessary mark preserves a salt that recovery was about to overwrite
 * anyway, and a human can clear it later. A skipped mark destroys the last
 * surviving copy of the old salt, irreversibly, and no later fix can reach it.
 * Every error, timeout, unexpected shape and doubt therefore resolves to
 * "unknown", and "unknown" marks.
 *
 * Neither read here touches key material. Both are scoped by row-level security
 * to the signed-in caller and return only a routing identifier and a row count,
 * so this reads nothing the user could not already read.
 */

/**
 * - `present`: the account has, or has had, Orange Rails material.
 * - `absent`:  both reads succeeded and both said no. The only value that
 *              suppresses the mark.
 * - `unknown`: we could not tell. Treated exactly like `present`.
 */
export type OrMaterialEvidence = "present" | "absent" | "unknown";

/** The shape a supabase-js read resolves to, narrowed to what we use. */
type ReadResult<T> = { data: T | null; error: unknown };

export interface OrMaterialEvidenceReads {
  /**
   * `public.user_profiles.or_subaccount_id` for the signed-in user, as a
   * `maybeSingle()` read: `data` is null when the user has no profile row,
   * which is a real "no subaccount" answer and not an error.
   */
  subaccountId: () => PromiseLike<ReadResult<{ or_subaccount_id: string | null }>>;
  /**
   * At most one `public.sync_events` row for the signed-in user. We only ever
   * ask whether the array is empty, so `limit(1)` is enough.
   */
  syncEvents: () => PromiseLike<ReadResult<unknown[]>>;
}

/**
 * Turn the two reads into evidence. Never throws: a thrown read is a doubt,
 * and a doubt is `unknown`.
 */
export async function readOrMaterialEvidence(
  reads: OrMaterialEvidenceReads,
): Promise<OrMaterialEvidence> {
  let subaccountAnswered = false;

  try {
    const { data, error } = await reads.subaccountId();
    if (error) return "unknown";
    if (data === null) {
      // No profile row at all. A definite "no subaccount".
      subaccountAnswered = true;
    } else if (typeof data === "object" && "or_subaccount_id" in data) {
      const value = (data as { or_subaccount_id: unknown }).or_subaccount_id;
      if (typeof value === "string" && value.length > 0) return "present";
      if (value === null || value === "") subaccountAnswered = true;
      else return "unknown";
    } else {
      // Something we did not expect came back. Do not interpret it.
      return "unknown";
    }
  } catch {
    return "unknown";
  }

  try {
    const { data, error } = await reads.syncEvents();
    if (error) return "unknown";
    if (!Array.isArray(data)) return "unknown";
    if (data.length > 0) return "present";
  } catch {
    return "unknown";
  }

  // Both reads answered, and both said no.
  return subaccountAnswered ? "absent" : "unknown";
}

export interface RecoveryMarkDecision {
  /**
   * True when all three Orange Rails key-material columns were absent on the
   * row immediately before this recovery rotated the salt.
   */
  hadNoOrMaterialBeforeRecovery: boolean;
  evidence: OrMaterialEvidence;
}

/**
 * Should this recovery record the pre-rotation salt in `or_subkey_salt`?
 *
 * A row that already carries Orange Rails material needs no mark: its pinned
 * salt is already on the row and survives the rotation untouched.
 */
export function shouldRecordPreRecoverySalt(decision: RecoveryMarkDecision): boolean {
  if (!decision.hadNoOrMaterialBeforeRecovery) return false;
  return decision.evidence !== "absent";
}
