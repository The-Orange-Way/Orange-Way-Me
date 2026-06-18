/**
 * Household Signing Key (HSK / OSK) client helpers — Orange Way Phase 4.4.
 *
 * The Household Signing Key is a per-household ML-DSA-65 keypair:
 *
 *   - Public half lives in `household_signing_keys` (plaintext; any
 *     member can fetch it to verify peer writes).
 *   - Private half is wrapped per writer via the same hybrid-KEM
 *     strategy used for household_keys invite wraps, and stored in
 *     `household_member_osk_wraps` keyed on (user_id, household_id,
 *     key_version).
 *
 * Auditor and pending members never get a wrap — that is the
 * cryptographic read-only enforcement. The server-side trigger
 * additionally refuses to commit a row whose `signature_b64` does not
 * verify under the household's public key.
 *
 * This module is browser-pure: it only knows about bytes + base64 +
 * ML-DSA primitives + hybrid-KEM strategies. Supabase I/O happens at
 * the VaultContext + household-osk.ts call sites.
 *
 * ── Non-goals ──────────────────────────────────────────────────────
 *   * No rotation logic — Phase 4.5 already owns the household hard
 *     re-key path; HSK rotation rides on top of that.
 *   * No signature payload-composition schema. Callers pass a
 *     `Uint8Array` and own the canonicalization: for Phase 4.4 the
 *     payload is the encrypted ciphertext bytes for the row's primary
 *     encrypted field.
 */

import {
  ML_DSA_65,
  generateSigKeyPair,
  sign as mlDsaSign,
  verify as mlDsaVerify,
  hybridEncapsulate,
  hybridDecapsulate,
  HYBRID_KEM_CIPHERTEXT_BYTES,
} from "@/lib/pqc";
import { base64ToBytes } from "@/lib/key-wrapping";

// ---------------------------------------------------------------------------
// Local base64 helpers — kept inline so this module has no cross-module
// dep on household-invite-wrap.ts (both modules share the primitive).
// ---------------------------------------------------------------------------

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

// ---------------------------------------------------------------------------
// Types exposed to callers.
// ---------------------------------------------------------------------------

/** One writer recipient for `generateAndWrapHouseholdSigningKey`. */
export interface WriterRecipient {
  /** auth.users.id of the writer. */
  userId: string;
  /** Base64 of their hybrid public key (user_public_keys.public_key_b64). */
  publicKeyB64: string;
}

/** Shape of one row the caller sends to the mint-household-signing-key fn. */
export interface OskWrapRow {
  user_id: string;
  wrapped_private_key: string;
  iv: string;
  wrap_algo: string;
  key_version: number;
}

/** Bundle produced by generateAndWrapHouseholdSigningKey. Ready to POST. */
export interface GeneratedHouseholdSigningKeyBundle {
  publicKeyB64: string;
  keyVersion: number;
  algorithm: string;
  wraps: OskWrapRow[];
  /**
   * Raw private key bytes — caller must drop the reference immediately
   * after passing to the mint-household-signing-key request (or store
   * in the VaultContext signing-key cache). The server never sees this.
   */
  privateKeyBytes: Uint8Array;
}

// Back-compat alias matching V3 naming.
export type GeneratedOskBundle = GeneratedHouseholdSigningKeyBundle;

// ---------------------------------------------------------------------------
// Wire-format constants.
// ---------------------------------------------------------------------------

/**
 * OW's mint-household-signing-key edge function defaults the wrap_algo
 * column to `hybrid_x25519_mlkem768` (underscore form). The V3 module
 * sent `hybrid-kem-v1`. We send the OW default so the migration's
 * stored value matches the column default and downstream tooling does
 * not have to know two labels for the same scheme.
 */
const WRAP_ALGO_LABEL = "hybrid_x25519_mlkem768";
const DATA_KEY_BYTES_TAG = 16;
const AES_GCM_IV_BYTES = 12;

// ---------------------------------------------------------------------------
// Public API — keypair lifecycle.
// ---------------------------------------------------------------------------

/**
 * Generate a fresh ML-DSA-65 keypair. The secret half stays in caller
 * memory; this is a thin convenience over the pqc primitive so feature
 * code never reaches into pqc.ts directly.
 */
export function generateHouseholdSigningKey(): {
  publicKey: Uint8Array;
  privateKey: Uint8Array;
} {
  const kp = generateSigKeyPair();
  return { publicKey: kp.publicKey, privateKey: kp.secretKey };
}

/**
 * Wrap a household signing key's private half to one recipient's hybrid
 * public key. Returns the same wire-format blob the edge function expects.
 *
 * NOTE: this wraps the ML-DSA secret key (4032 bytes for ML-DSA-65),
 * which is larger than the 32-byte DEK the hybrid-KEM strategy is
 * nominally designed to wrap. We use the hybrid KEM + AES-GCM
 * primitives directly. Layout matches the strategy V3 uses:
 *   kemCiphertext (1120) || iv (12) || AES-GCM(privateKey || tag)
 */
export async function wrapHouseholdSigningKey(
  privateKeyBytes: Uint8Array,
  recipientPublicKeyB64: string,
): Promise<{ wrappedBlobB64: string; ivB64: string; wrapAlgo: string }> {
  const recipientPub = base64ToBytes(recipientPublicKeyB64);
  const { ciphertext: kemCt, sharedSecret } = hybridEncapsulate(recipientPub);
  const aesKey = await crypto.subtle.importKey(
    "raw",
    sharedSecret as BufferSource,
    { name: "AES-GCM" },
    /* extractable */ false,
    ["encrypt", "decrypt"],
  );
  const iv = new Uint8Array(AES_GCM_IV_BYTES);
  crypto.getRandomValues(iv);
  const ct = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: iv as BufferSource },
      aesKey,
      privateKeyBytes as BufferSource,
    ),
  );

  // Concatenate kemCt || iv || ct (tag is appended by SubtleCrypto).
  const wrapped = new Uint8Array(kemCt.length + iv.length + ct.length);
  wrapped.set(kemCt, 0);
  wrapped.set(iv, kemCt.length);
  wrapped.set(ct, kemCt.length + iv.length);

  return {
    wrappedBlobB64: bytesToBase64(wrapped),
    ivB64: bytesToBase64(iv),
    wrapAlgo: WRAP_ALGO_LABEL,
  };
}

/**
 * Generate a fresh ML-DSA-65 keypair and wrap its private half to each
 * writer's hybrid public key. Callers pass the result to the
 * `mint-household-signing-key` edge function.
 */
export async function generateAndWrapHouseholdSigningKey(
  householdId: string,
  writers: WriterRecipient[],
  keyVersion = 1,
): Promise<GeneratedHouseholdSigningKeyBundle> {
  if (!householdId) throw new Error("householdId is required");
  if (writers.length === 0) {
    throw new Error("At least one writer recipient is required to mint a household signing key.");
  }

  const { publicKey, privateKey } = generateHouseholdSigningKey();

  const wraps: OskWrapRow[] = [];
  for (const w of writers) {
    const { wrappedBlobB64, ivB64, wrapAlgo } = await wrapHouseholdSigningKey(
      privateKey,
      w.publicKeyB64,
    );
    wraps.push({
      user_id: w.userId,
      wrapped_private_key: wrappedBlobB64,
      iv: ivB64,
      wrap_algo: wrapAlgo,
      key_version: keyVersion,
    });
  }

  return {
    publicKeyB64: bytesToBase64(publicKey),
    keyVersion,
    algorithm: "ml-dsa-65",
    wraps,
    privateKeyBytes: privateKey,
  };
}

/** Back-compat alias mirroring V3's name. */
export const generateAndWrapOsk = generateAndWrapHouseholdSigningKey;

/**
 * Unwrap a stored `household_member_osk_wraps` row to recover the
 * user's ML-DSA-65 secret key. Inverse of wrapHouseholdSigningKey.
 *
 * The recipient's hybrid secret key (x25519 || ML-KEM-768) must be
 * provided by the caller — VaultContext fetches and decrypts it on
 * unlock.
 */
export async function unwrapHouseholdSigningKey(
  wrappedPrivateKeyB64: string,
  ownHybridSecretKeyBytes: Uint8Array,
): Promise<Uint8Array> {
  const wrapped = base64ToBytes(wrappedPrivateKeyB64);

  if (wrapped.length < HYBRID_KEM_CIPHERTEXT_BYTES + AES_GCM_IV_BYTES + DATA_KEY_BYTES_TAG) {
    throw new Error("Household signing key wrap blob is too short to unwrap.");
  }

  const kemCt = wrapped.subarray(0, HYBRID_KEM_CIPHERTEXT_BYTES);
  const iv = wrapped.subarray(
    HYBRID_KEM_CIPHERTEXT_BYTES,
    HYBRID_KEM_CIPHERTEXT_BYTES + AES_GCM_IV_BYTES,
  );
  const ct = wrapped.subarray(HYBRID_KEM_CIPHERTEXT_BYTES + AES_GCM_IV_BYTES);

  const sharedSecret = hybridDecapsulate(ownHybridSecretKeyBytes, kemCt);
  const aesKey = await crypto.subtle.importKey(
    "raw",
    sharedSecret as BufferSource,
    { name: "AES-GCM" },
    /* extractable */ false,
    ["encrypt", "decrypt"],
  );
  const plaintext = new Uint8Array(
    await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: iv as BufferSource },
      aesKey,
      ct as BufferSource,
    ),
  );
  if (plaintext.length !== ML_DSA_65.secretKeyBytes) {
    throw new Error(
      `Unwrapped household signing key has wrong length: expected ${ML_DSA_65.secretKeyBytes}, got ${plaintext.length}`,
    );
  }
  return plaintext;
}

/** Back-compat alias mirroring V3's name. */
export const unwrapOskForSelf = unwrapHouseholdSigningKey;

// ---------------------------------------------------------------------------
// Public API — sign / verify.
// ---------------------------------------------------------------------------

/**
 * Signing-key handle returned by VaultContext. The private key bytes
 * stay inside the handle; callers pass the handle to `signMutation`.
 */
export interface OskHandle {
  privateKeyBytes: Uint8Array;
  keyVersion: number;
}

/** Produce an ML-DSA-65 signature over `payloadBytes` using the handle. */
export function signMutation(
  payloadBytes: Uint8Array,
  handle: OskHandle,
): { signature_b64: string; key_version: number } {
  const sig = mlDsaSign(handle.privateKeyBytes, payloadBytes);
  return {
    signature_b64: bytesToBase64(sig),
    key_version: handle.keyVersion,
  };
}

/**
 * Direct sign with a raw private key. Used by household-osk.ts when
 * minting (the freshly-generated key is held in caller memory, not yet
 * in the VaultContext cache).
 */
export function signWithPrivateKey(payloadBytes: Uint8Array, privateKey: Uint8Array): Uint8Array {
  return mlDsaSign(privateKey, payloadBytes);
}

/**
 * Verify an ML-DSA-65 signature against the provided household public
 * key. Returns false on any validation failure — never throws.
 */
export function verifySignature(
  publicKeyB64: string,
  payloadBytes: Uint8Array,
  signatureB64: string,
): boolean {
  try {
    const sig = base64ToBytes(signatureB64);
    const pub = base64ToBytes(publicKeyB64);
    return mlDsaVerify(pub, payloadBytes, sig);
  } catch {
    return false;
  }
}

/** Back-compat alias mirroring V3's name. */
export function verifyMutation(
  payloadBytes: Uint8Array,
  signatureB64: string,
  publicKeyB64: string,
): boolean {
  return verifySignature(publicKeyB64, payloadBytes, signatureB64);
}

// ---------------------------------------------------------------------------
// Incidental re-exports so call sites don't need to import from pqc.ts.
// ---------------------------------------------------------------------------

export { ML_DSA_65 };
