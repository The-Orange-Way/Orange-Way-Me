/**
 * Pinning the Orange Rails key material during a vault password change.
 *
 * WHY THIS IS A MODULE AND NOT TWENTY LINES INSIDE changeVaultPassword.
 *
 * A password change mints a new `kdf_salt`. The Orange Rails subkeys take the
 * salt as an HKDF salt context, so the material must be pinned against the salt
 * the already sealed rows were sealed under, which is the one still on the row
 * at the moment the change begins. Inline, that correctness rested entirely on
 * statement order: plan first, mint second. Nothing in the type system, the
 * linter or CI could see that ordering, so an edit that moved the mint above
 * the plan would pin material derived from the NEW salt while asserting it
 * matched rows sealed under the OLD one. The result is a well formed key that
 * opens nothing and looks exactly like success, which is the original defect
 * wearing a different hat.
 *
 * THE SALT IS NOT A PARAMETER, AND THAT IS THE POINT. This function reads
 * `row.kdf_salt` itself. There is no salt argument, so there is no wrong value
 * for a caller to pass and no ordering for a later edit to reverse. The hazard
 * is removed by construction rather than merely detected by a test.
 *
 * This is not pure and does not need to be: it awaits the shipped vault
 * primitives, all of which run under Node in the existing test environment.
 */

import {
  deriveOrMekBytes,
  importMekFromRaw,
  randomBytesB64,
  wrapOrMekWithVaultMek,
} from "@/lib/vault";

import { planOrKeyMaterial, type OrKeyMaterialRow } from "./or-key-material";

/**
 * What this decision reads from `vault_metadata`: the three pinned columns,
 * plus the salt that is still in force. The salt belongs on the row rather
 * than in the argument list, see the note above.
 */
export interface OrPasswordChangeRow extends OrKeyMaterialRow {
  kdf_salt: string;
}

/** Exactly the three columns a pin writes, and never anything else. */
export interface OrPinColumns {
  enc_or_mek_ciphertext: string;
  or_subkey_salt: string;
  or_key_epoch: number;
}

/**
 * Work out what the Orange Rails columns should become as part of a password
 * change, or that nothing should be written.
 *
 * Returns null in both of the cases where nothing is written, because the
 * caller's behaviour is identical for them: an already pinned row needs no
 * change, since the pin does not move with the password or the salt, and a
 * refusal must rotate the password anyway while touching no Orange Rails
 * column. In both refusal cases the material is already unreproducible and the
 * namespace is already disabled, so the rotation makes nothing worse, while
 * blocking a password change over an unrelated namespace generation would be a
 * real harm for no gain.
 *
 * A throw from here leaves nothing written and the password unchanged, which
 * the customer can retry. That is the better failure: rotating without the pin
 * would make the material unreproducible permanently.
 *
 * @param row              the vault_metadata row as it stands BEFORE the change
 * @param currentPassword  the old password, already verified by the caller
 * @param userId           Supabase auth user.id
 * @param vaultMekBytes    raw vault MEK bytes held in memory by the caller
 */
export async function computeOrPinForPasswordChange(
  row: OrPasswordChangeRow,
  currentPassword: string,
  userId: string,
  vaultMekBytes: Uint8Array,
): Promise<OrPinColumns | null> {
  // Planning against the salt on the row with saltMatchesExistingRows: true is
  // honest here and only here, because the new salt does not exist yet and
  // this function cannot be handed one.
  const plan = planOrKeyMaterial(row, row.kdf_salt, { saltMatchesExistingRows: true });

  if (plan.mode === "derive-and-pin") {
    // Everything needed is local. The old password is in hand and has just
    // been verified by the caller, the old salt is on the row, and the MEK
    // bytes are held in memory, so the legacy value is reproduced with no
    // network call.
    const vaultMek = await importMekFromRaw(vaultMekBytes);
    const orMekBytes = await deriveOrMekBytes(currentPassword, userId, plan.saltContext);
    try {
      return {
        enc_or_mek_ciphertext: await wrapOrMekWithVaultMek(orMekBytes, vaultMek),
        // DELIBERATE BREAK, reverted in the next commit. The correct value is
        // plan.saltContext, which is the OLD salt these subkeys were
        // established against. A fresh salt here is exactly the defect the
        // test must be seen catching.
        or_subkey_salt: randomBytesB64(16),
        or_key_epoch: plan.epoch,
      };
    } finally {
      // Our own copy, wrapped and no longer needed.
      orMekBytes.fill(0);
    }
  }

  if (plan.mode === "refuse") {
    // Reason only: no salt, ciphertext or key material.
    console.warn("[vault] Orange Rails material not pinned during password change:", plan.reason);
  }

  // "unwrap" needs nothing. The row is already pinned and the pin does not move
  // with the password or the salt, which is the whole point of it.
  return null;
}
