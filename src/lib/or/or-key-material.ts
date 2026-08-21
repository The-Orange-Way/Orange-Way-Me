/**
 * Deciding where the Orange Rails key material comes from (DL-1506).
 *
 * The defect this exists to close. The four Orange Rails subkeys are derived
 * from the vault password and `vault_metadata.kdf_salt`. Changing a vault
 * password regenerates that salt, so all four subkeys change, and every row
 * sealed under the previous ones can never be opened again by anyone,
 * including us. Recovery does the same for the same reason. The rows survive;
 * the key does not.
 *
 * The fix is not to re-encrypt anything. It is to stop re-deriving a key we
 * already have. The Orange Rails MEK keeps its CURRENT value and gets stored
 * wrapped under the vault MEK, which is a random key that is wrapped rather
 * than derived and therefore already survives a password change and is already
 * recoverable from the recovery code. Because the value does not change, no
 * sealed row anywhere needs touching.
 *
 * This is not a new idea in this codebase. `enc_hmac_key` does exactly this,
 * and says why in its own comment: it decouples the HMAC key from the vault
 * password so blind indexes stay valid after a password change. That
 * decoupling was simply never applied to the Orange Rails namespace.
 *
 * Two things must be pinned, not one. The subkeys take the salt as an HKDF
 * salt-context, so pinning the MEK while letting the salt rotate would still
 * move all four keys. `or_subkey_salt` pins the salt that was in force when
 * the material was established.
 *
 * This module is pure and holds no crypto. It answers only "derive, unwrap, or
 * refuse", so that the rule can be tested without WebCrypto and without a
 * vault. The caller performs whichever of the three it is told.
 */

/** The stored state, as read from `vault_metadata`. */
export interface OrKeyMaterialRow {
  /** Orange Rails MEK sealed under the vault MEK. Null until established. */
  enc_or_mek_ciphertext: string | null;
  /** The kdf_salt in force when the above was established. Null until then. */
  or_subkey_salt: string | null;
}

export type OrKeyMaterialPlan =
  | {
      /**
       * Nothing is pinned yet. Derive the legacy value exactly as before and
       * pin it. This is correct only at a moment when the password and the
       * current salt still produce the value that existing rows were sealed
       * under, which means an unlock, a vault creation, or a password change
       * BEFORE the salt is rotated.
       */
      mode: "derive-and-pin";
      saltContext: string;
    }
  | {
      /** Pinned. Use it, and never mind what the password or kdf_salt now are. */
      mode: "unwrap";
      ciphertext: string;
      saltContext: string;
    }
  | {
      /**
       * The stored state cannot be trusted. The caller must NOT fall back to
       * deriving: after a rotation, deriving produces a key that opens nothing
       * while looking exactly like success, which is the original defect.
       */
      mode: "refuse";
      reason: string;
    };

/**
 * Decide, from what is stored, how to obtain the Orange Rails key material.
 *
 * The half-established cases are refusals rather than repairs on purpose. One
 * column without the other means something wrote a partial state, and the two
 * possible repairs (derive a fresh key, or reuse the current salt) both
 * silently produce a key that opens nothing if the salt has since rotated.
 * Guessing here is how a data-loss bug hides itself for months; refusing is
 * visible on the first attempt.
 *
 * @param row       what `vault_metadata` holds for this user
 * @param kdfSalt   the salt in force right now, used only when pinning
 */
export function planOrKeyMaterial(row: OrKeyMaterialRow, kdfSalt: string): OrKeyMaterialPlan {
  const hasCiphertext =
    typeof row.enc_or_mek_ciphertext === "string" && row.enc_or_mek_ciphertext.length > 0;
  const hasSalt = typeof row.or_subkey_salt === "string" && row.or_subkey_salt.length > 0;

  if (hasCiphertext && hasSalt) {
    return {
      mode: "unwrap",
      ciphertext: row.enc_or_mek_ciphertext as string,
      saltContext: row.or_subkey_salt as string,
    };
  }

  if (hasCiphertext && !hasSalt) {
    return {
      mode: "refuse",
      reason:
        "Orange Rails key material is sealed but its salt is missing, so the subkeys cannot be reproduced.",
    };
  }

  if (!hasCiphertext && hasSalt) {
    return {
      mode: "refuse",
      reason:
        "Orange Rails key material has a pinned salt but no sealed key, so what it was pinned against is unknown.",
    };
  }

  if (typeof kdfSalt !== "string" || kdfSalt.length === 0) {
    return {
      mode: "refuse",
      reason: "No vault salt is available to pin Orange Rails key material against.",
    };
  }

  return { mode: "derive-and-pin", saltContext: kdfSalt };
}
