/**
 * Computing the Orange Rails pin columns for a vault_metadata row (DL-1506).
 *
 * WHY THIS IS A MODULE AND NOT A BLOCK INSIDE changeVaultPassword.
 *
 * The pin records the kdf_salt that the Orange Rails subkeys were established
 * against, so that those subkeys stop moving when kdf_salt rotates. Inside
 * changeVaultPassword the computation sat 38 lines above the line that mints
 * the new salt, and its correctness rested entirely on staying there. Nothing
 * in the type system, the linter, or any test could have noticed a future edit
 * moving the mint above the plan. If that ever happened, the function would
 * pin material derived from the NEW salt while asserting it matches rows
 * sealed under the OLD one: a well formed key that opens nothing and looks
 * exactly like success.
 *
 * This helper is handed the row and reads the old salt off it. The new salt is
 * not in its reach, so the ordering fault cannot be expressed here at all.
 * That is the point of the extraction: removing a hazard beats detecting one.
 *
 * THIS IS NOT A PURE FUNCTION and must not be described as one. It imports the
 * MEK, runs Argon2id, and wraps the result, all with the real shipped
 * primitives. It runs in the node test environment, which is why its suite can
 * assert on values rather than on mocks agreeing with each other.
 */

import {
  deriveOrMekBytes,
  importMekFromRaw,
  randomBytesB64,
  wrapOrMekWithVaultMek,
} from "@/lib/vault";

import { planOrKeyMaterial, type OrKeyMaterialRow } from "./or-key-material";

/**
 * What the helper needs to read off vault_metadata.
 *
 * `kdf_salt` is the salt CURRENTLY stored on the row, which during a password
 * change is the pre-rotation salt: the one existing rows were sealed under. It
 * is read from the row on purpose and is deliberately NOT a parameter. A salt
 * argument would let a caller hand in the newly minted one, which is the whole
 * defect this module exists to make unrepresentable.
 */
export interface OrPinSourceRow extends OrKeyMaterialRow {
  kdf_salt: string;
}

/** The three columns written when material is pinned for the first time. */
export interface OrPinColumns {
  enc_or_mek_ciphertext: string;
  or_subkey_salt: string;
  or_key_epoch: number;
}

export interface ComputeOrPinColumnsArgs {
  /** The row as read from vault_metadata, before any rotation is applied. */
  row: OrPinSourceRow;
  /** The vault password currently in force. Never leaves the browser. */
  password: string;
  /** Supabase auth user.id. */
  userId: string;
  /** Raw vault MEK bytes, held while the vault is unlocked. */
  mekBytes: Uint8Array;
}

/**
 * Decide, and if the answer is "pin", compute the three Orange Rails columns.
 *
 * Returns null when there is nothing to write, which covers both of the other
 * two plans. An already pinned row returns null because the pin does not move
 * with the password or the salt, which is the whole point of it. A refusal
 * returns null because the material is already unreproducible or the namespace
 * generation is unknown, and in both cases writing a column would be a guess.
 *
 * A throw from the crypto leaves nothing written and the password unchanged,
 * which the customer can retry. That is the better failure: rotating without
 * the pin would make the material unreproducible permanently.
 */
export async function computeOrPinColumns({
  row,
  password,
  userId,
  mekBytes,
}: ComputeOrPinColumnsArgs): Promise<OrPinColumns | null> {
  // DELIBERATE DEFECT, removed by the next commit on this branch. See the
  // commit message. Minting a salt here is the hazard the helper exists to
  // remove, expressed in one line, so the new suite can be seen going red.
  const orPlan = planOrKeyMaterial(row, randomBytesB64(16), { saltMatchesExistingRows: true });

  if (orPlan.mode === "derive-and-pin") {
    const vaultMek = await importMekFromRaw(mekBytes);
    const orMekBytes = await deriveOrMekBytes(password, userId, orPlan.saltContext);
    try {
      return {
        enc_or_mek_ciphertext: await wrapOrMekWithVaultMek(orMekBytes, vaultMek),
        // The OLD salt. These subkeys were established against it and must
        // not move when kdf_salt does.
        or_subkey_salt: orPlan.saltContext,
        or_key_epoch: orPlan.epoch,
      };
    } finally {
      // Our own copy, wrapped and no longer needed.
      orMekBytes.fill(0);
    }
  }

  if (orPlan.mode === "refuse") {
    // Write no column and let the caller proceed. In both refusal cases the
    // material is already unreproducible and the namespace is already
    // disabled, so rotating makes nothing worse, while blocking a password
    // change over an unrelated namespace generation would be a real harm for
    // no gain. Reason only: no salt, ciphertext or key material.
    console.warn("[vault] Orange Rails material not pinned during password change:", orPlan.reason);
  }

  // "unwrap" needs nothing. The row is already pinned and the pin does not
  // move with the password or the salt.
  return null;
}
