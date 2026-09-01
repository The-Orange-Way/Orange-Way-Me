/**
 * Pinning the Orange Rails key material during a vault password change.
 *
 * WHY THIS IS A SEPARATE MODULE AND NOT A BLOCK INSIDE changeVaultPassword.
 * The correctness of the password-change path rests on an ordering that is
 * invisible to every machine we own: the Orange Rails pin must be planned
 * BEFORE the new kdf_salt is minted, because the four Orange Rails subkeys
 * take the salt as an HKDF salt context and were established against the OLD
 * one. Nothing in the type system, the linter or the five CI checks would
 * notice if a future edit moved the mint above the plan. The result would be
 * a well formed key that opens nothing and looks exactly like success, which
 * is the same silent shape the pin design (DL-1506) exists to remove.
 *
 * A test could detect that reordering. This module makes it unexpressible
 * instead: the salt is READ OFF THE ROW that was fetched before anything
 * rotated, so there is no salt argument for a caller to get wrong and no
 * ordering for a caller to break. The caller supplies the row and the
 * material; it does not get to say which salt the pin records.
 *
 * ZKA: no plaintext, no address, no txid and no wallet-identifying value
 * passes through here. This is key-derivation plumbing only, and the derived
 * bytes are zeroed the moment they are wrapped.
 */

import { deriveOrMekBytes, importMekFromRaw, randomBytesB64, wrapOrMekWithVaultMek } from "@/lib/vault";

import { planOrKeyMaterial } from "./or-key-material";
import type { OrKeyMaterialRow } from "./or-key-material";

/**
 * What this helper reads out of `vault_metadata`.
 *
 * `kdf_salt` is nullable because the column is: a row that has lost its salt
 * cannot pin anything, and `planOrKeyMaterial` already answers that case with
 * a refusal rather than a guess.
 */
export interface PasswordChangePinRow extends OrKeyMaterialRow {
  /** The salt in force BEFORE this password change mints a new one. */
  kdf_salt: string | null;
}

/** The three columns that ride along with the salt rotation, or none. */
export interface OrPinColumns {
  enc_or_mek_ciphertext: string;
  or_subkey_salt: string;
  or_key_epoch: number;
}

export interface OrPinForPasswordChange {
  /**
   * Columns to merge into the password-change UPDATE, or null when there is
   * nothing to write. Null covers both benign cases: the row is already
   * pinned and must not be overwritten, and the stored state is unusable.
   */
  columns: OrPinColumns | null;
  /** Non-null only when the stored state cannot be used. Reason only: never a salt, ciphertext or key material. */
  refusalReason: string | null;
}

export interface PlanOrPinForPasswordChangeParams {
  row: PasswordChangePinRow;
  /** The password being replaced. Already verified by the caller. */
  currentPassword: string;
  userId: string;
  /** Raw vault MEK bytes. Unchanged by a password change, which is what makes the pin survive one. */
  vaultMekBytes: Uint8Array;
}

/**
 * Decide what the password change should write for the Orange Rails
 * namespace, and produce it.
 *
 * Everything needed is local: the old password is in hand and has just been
 * verified, the old salt is on the row, and the vault MEK is held by the
 * caller, so this makes no network call and reads nothing it was not given.
 *
 * A throw leaves nothing written and the password unchanged, which the
 * customer can retry. That is the better failure: rotating without the pin
 * would make the material unreproducible permanently.
 */
export async function planOrPinForPasswordChange(
  params: PlanOrPinForPasswordChangeParams,
): Promise<OrPinForPasswordChange> {
  const { row, currentPassword, userId, vaultMekBytes } = params;

  // DELIBERATE HAZARD, REMOVED IN THE NEXT COMMIT. This mints the new salt
  // before planning, which is the exact reordering OWM-T0262 exists to catch,
  // and it is here only so the test can be seen going red against it.
  const saltForPin = randomBytesB64(16);
  const plan = planOrKeyMaterial(row, saltForPin, {
    saltMatchesExistingRows: true,
  });

  if (plan.mode === "unwrap") {
    // Already pinned. The pin does not move with the password or the salt,
    // which is the whole point of it, so the change writes no OR column.
    return { columns: null, refusalReason: null };
  }

  if (plan.mode === "refuse") {
    // Rotate anyway and write no OR column. In both refusal cases the material
    // is already unreproducible and the namespace is already disabled, so the
    // rotation makes nothing worse, while blocking a password change over an
    // unrelated namespace generation would be a real harm for no gain.
    return { columns: null, refusalReason: plan.reason };
  }

  const vaultMek = await importMekFromRaw(vaultMekBytes);
  const orMekBytes = await deriveOrMekBytes(currentPassword, userId, plan.saltContext);
  try {
    return {
      columns: {
        enc_or_mek_ciphertext: await wrapOrMekWithVaultMek(orMekBytes, vaultMek),
        // The salt these subkeys were established against. It must not move
        // when kdf_salt does.
        or_subkey_salt: plan.saltContext,
        or_key_epoch: plan.epoch,
      },
      refusalReason: null,
    };
  } finally {
    // Our own copy, wrapped and no longer needed.
    orMekBytes.fill(0);
  }
}
