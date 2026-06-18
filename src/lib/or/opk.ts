/**
 * OPK (one-time public key) — the X25519 keypair OR seals background-synced
 * bank transactions to.
 *
 * Architecture: OR's or-quiltt-sync pulls bank transactions from Quiltt,
 * seals each under the subaccount's OPK public key using libsodium
 * crypto_box_seal (anonymous sealed box), and stores the ciphertext in
 * encrypted_transactions. Only the holder of the OPK *private* key can
 * unseal — that's this browser, and only while the vault is unlocked.
 *
 * ZKA: the private half never leaves the client. OR holds only the public
 * half (subaccounts.opk_public). A sealed transaction is unreadable to OR,
 * to the Orange Way server, and to anyone but the vault owner.
 *
 * Compatibility: we use libsodium-wrappers-sumo — the exact library +
 * construction OR uses to seal (opk_alg = 'libsodium-crypto_box_seal-v1').
 * crypto_box_seal_open here is guaranteed to open what OR's crypto_box_seal
 * produced. Hand-rolling X25519 + XSalsa20-Poly1305 + blake2b nonce would
 * risk a subtle incompatibility; matching the library removes that risk.
 *
 * The keypair is derived deterministically from the vault MEK (via
 * deriveOpkSeed in key-derivation.ts), so it regenerates identically on
 * every device after unlock with no separate storage.
 */

import _sodium from "libsodium-wrappers-sumo";

export const OPK_ALG = "libsodium-crypto_box_seal-v1";

export interface OpkKeypair {
  /** Base64 (libsodium ORIGINAL variant) of the 32-byte X25519 public key.
   *  This is what registers on OR's subaccounts.opk_public. */
  publicKeyB64: string;
  /** Raw 32-byte X25519 public key. */
  publicKey: Uint8Array;
  /** Raw 32-byte X25519 secret key — never leaves the client. */
  secretKey: Uint8Array;
}

let sodiumReady: Promise<typeof _sodium> | null = null;
async function getSodium(): Promise<typeof _sodium> {
  if (!sodiumReady) {
    sodiumReady = (async () => {
      await _sodium.ready;
      return _sodium;
    })();
  }
  return sodiumReady;
}

/**
 * Deterministically derive the OPK X25519 keypair from a 32-byte seed.
 * Same seed → same keypair (libsodium crypto_box_seed_keypair).
 */
export async function opkKeypairFromSeed(seed: Uint8Array): Promise<OpkKeypair> {
  if (seed.length !== 32) {
    throw new Error(`OPK seed must be 32 bytes, got ${seed.length}`);
  }
  const sodium = await getSodium();
  const kp = sodium.crypto_box_seed_keypair(seed);
  return {
    publicKey: kp.publicKey,
    secretKey: kp.privateKey,
    publicKeyB64: sodium.to_base64(kp.publicKey, sodium.base64_variants.ORIGINAL),
  };
}

/**
 * Open a crypto_box_seal ciphertext produced by OR (base64 ORIGINAL) using
 * the OPK keypair. Returns the plaintext as a UTF-8 string.
 *
 * Throws if the ciphertext wasn't sealed to this keypair (wrong vault,
 * tampered payload, or alg mismatch).
 */
export async function opkSealOpen(sealedB64: string, kp: OpkKeypair): Promise<string> {
  const sodium = await getSodium();
  const sealed = sodium.from_base64(sealedB64, sodium.base64_variants.ORIGINAL);
  const opened = sodium.crypto_box_seal_open(sealed, kp.publicKey, kp.secretKey);
  return sodium.to_string(opened);
}

/**
 * Self-test helper (used by unit tests): seal a message to a keypair's
 * public half, exactly as OR would, so the round-trip can be verified
 * client-side without a server round-trip.
 */
export async function opkSealForTest(plaintext: string, publicKey: Uint8Array): Promise<string> {
  const sodium = await getSodium();
  const sealed = sodium.crypto_box_seal(sodium.from_string(plaintext), publicKey);
  return sodium.to_base64(sealed, sodium.base64_variants.ORIGINAL);
}
