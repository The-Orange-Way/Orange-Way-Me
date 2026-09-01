/**
 * Compute the Orange Rails pin columns for a vault row (DL-1506, DEV-0044).
 *
 * WHY THIS IS A FUNCTION AND NOT A FEW LINES INSIDE changeVaultPassword.
 * Pinning is only correct when it is planned against the salt the already
 * sealed rows were written under, which is the salt still stored on the row.
 * changeVaultPassword mints a replacement salt a few lines further down, and
 * if a future edit ever moved that mint above the pin, the function would pin
 * material derived from the NEW salt while asserting it matches rows sealed
 * under the OLD one. That produces a well formed key that opens nothing and
 * looks exactly like success, which is the defect DL-1506 exists to remove.
 *
 * The ordering is what made that possible, so the ordering is removed rather
 * than watched. This function takes the ROW and reads the salt off it. There
 * is no salt parameter, so a caller cannot hand it a newly minted salt even by
 * mistake: the fault is not representable rather than merely detected.
 *
 * DO NOT ADD A SALT ARGUMENT TO THIS SIGNATURE. That moves the hazard back
 * into the caller instead of keeping it closed.
 *
 * This is not a pure function. It awaits the real key derivation and the real
 * wrapping, exactly as the code it replaced did. It needs no DOM, so it is
 * tested under the node environment this repository already uses.
 */
import { deriveOrMekBytes, importMekFromRaw, wrapOrMekWithVaultMek } from "@/lib/vault";

import { planOrKeyMaterial, type OrKeyMaterialRow } from "./or-key-material";

/**
 * What this needs from `vault_metadata`: the three Orange Rails columns the
 * plan is made from, plus the salt the row currently stores.
 *
 * `kdf_salt` is the pre-rotation salt by construction. It is what the row
 * holds at the moment it is read, so it is the salt any already sealed row
 * was written against.
 */
export interface OrPinSourceRow extends OrKeyMaterialRow {
  kdf_salt: string;
}

export interface ComputeOrPinColumnsInput {
  row: OrPinSourceRow;
  /** The CURRENT vault password, already verified against this row. */
  password: string;
  /** Supabase auth user id. */
  userId: string;
  /**
   * Raw vault MEK bytes. Unchanged by a password change, which is the
   * property the whole pin design rests on.
   */
  mekBytes: Uint8Array;
}

/** The three columns to merge into the caller's UPDATE, or nothing at all. */
export interface OrPinColumns {
  enc_or_mek_ciphertext: string;
  or_subkey_salt: string;
  or_key_epoch: number;
}

/**
 * Returns the columns to write, or null when there is nothing to write:
 * either the row is already pinned, or the stored state cannot be used and
 * the namespace stays disabled. Null is not an error and the caller must not
 * treat it as one; a password change proceeds either way.
 */
export async function computeOrPinColumns({
  row,
  password,
  userId,
  mekBytes,
}: ComputeOrPinColumnsInput): Promise<OrPinColumns | null> {
  // The salt comes off the row, which is the only salt that can be honest
  // here: it is the one existing sealed rows were written under.
  const plan = planOrKeyMaterial(row, row.kdf_salt, { saltMatchesExistingRows: true });

  if (plan.mode === "derive-and-pin") {
    const vaultMek = await importMekFromRaw(mekBytes);
    const orMekBytes = await deriveOrMekBytes(password, userId, plan.saltContext);
    try {
      return {
        enc_or_mek_ciphertext: await wrapOrMekWithVaultMek(orMekBytes, vaultMek),
        // The OLD salt. These subkeys were established against it and must
        // not move when kdf_salt does.
        or_subkey_salt: plan.saltContext,
        or_key_epoch: plan.epoch,
      };
    } finally {
      // Our own copy, wrapped and no longer needed.
      orMekBytes.fill(0);
    }
    // A throw above leaves nothing written and the password unchanged, which
    // the customer can retry. That is the better failure: rotating without
    // the pin would make the material unreproducible permanently.
  }

  if (plan.mode === "refuse") {
    // The caller rotates anyway and writes no OR column. In both refusal
    // cases the material is already unreproducible and the namespace is
    // already disabled, so the rotation makes nothing worse, while blocking a
    // password change over an unrelated namespace generation would be a real
    // harm for no gain. Reason only: no salt, ciphertext or key material.
    console.warn("[vault] Orange Rails material not pinned during password change:", plan.reason);
  }

  // "unwrap" needs nothing. The row is already pinned and the pin does not
  // move with the password or the salt, which is the whole point of it.
  return null;
}
