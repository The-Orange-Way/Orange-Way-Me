/**
 * Vault keypair lifecycle — Phase 4.1.
 *
 * Glue between the Phase 4.0 crypto primitives (`pqc.ts`,
 * `pqc-lifecycle.ts`, `key-derivation.ts`) and the Phase 4.1 schema:
 *
 *   - `user_public_keys`  — plaintext hybrid KEM public key per user.
 *   - `vault_metadata.enc_private_key` — MEK-wrapped hybrid secret key,
 *                                        co-located with the rest of
 *                                        the user's vault metadata row.
 *
 * This two-table split mirrors `HOUSEHOLD-SHARING-DESIGN.md §3`. The
 * public half is unencrypted (OK per §1) and lives on its own so other
 * household members can read it during the Phase 4.3 invite-wrap flow
 * without ever seeing the private side. The private half piggy-backs
 * on `vault_metadata`, which already has exactly one row per user, so
 * we cannot drift into multiple private-key rows by construction.
 *
 * The ML-DSA-65 signing half is NOT generated here — Orange Way doesn't
 * use signing keys in v1. Phase 4.4 (Auditor + Support + OSK) handles the
 * signing path separately.
 *
 * Functions:
 *
 *   - `ensureUserKeypair(opts)` — idempotent generate + publish on
 *     first unlock. Uses UPSERT semantics: INSERT into
 *     `user_public_keys`, UPDATE on `vault_metadata.enc_private_key`.
 *     Safe to call every unlock.
 *   - `rewrapUserKeypair(opts)` — atomic UPDATE on password change.
 *     Never INSERT or DELETE a private-key row — the row already
 *     exists (vault_metadata is created at vault setup). Unit test
 *     asserts count stays at 0 INSERT / 0 DELETE across N rotations.
 *
 * Both functions accept a narrow Supabase surface
 * (`SupabaseKeypairClient`) so the unit test can drive them with an
 * in-memory stub without pulling in the generated schema types.
 */

import { encryptString, decryptString } from "./vault";
import { derivePqcSecretWrapKey } from "./key-derivation";
import { generateHybridKemKeyPair } from "./pqc";

// ---------------------------------------------------------------------------
// Local base64 helper. Kept small and private so this module does not have
// to cross-depend on pqc-lifecycle.
// ---------------------------------------------------------------------------

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

// ---------------------------------------------------------------------------
// Narrow Supabase surface.
//
// We need:
//   - SELECT `public_key_b64` from user_public_keys (existence check)
//   - INSERT one row into user_public_keys
//   - SELECT `enc_private_key` from vault_metadata (re-wrap path)
//   - UPDATE `enc_private_key` on vault_metadata
// ---------------------------------------------------------------------------

export interface UserPublicKeyRow {
  public_key_b64: string;
  algorithm: string;
}

export interface VaultMetadataPrivateKeyRow {
  enc_private_key: string | null;
}

type Table = "user_public_keys" | "vault_metadata";

export interface SupabaseKeypairClient {
  from(table: Table): {
    select(columns: string): {
      eq(
        column: "user_id",
        value: string,
      ): {
        maybeSingle(): Promise<{
          data: Partial<UserPublicKeyRow> | Partial<VaultMetadataPrivateKeyRow> | null;
          error: unknown;
        }>;
      };
    };
    insert(values: Record<string, unknown>): Promise<{ error: unknown }>;
    update(values: Record<string, unknown>): {
      eq(column: "user_id", value: string): Promise<{ error: unknown }>;
    };
  };
}

// ---------------------------------------------------------------------------
// ensureUserKeypair — first-unlock generate + publish.
// ---------------------------------------------------------------------------

export interface EnsureUserKeypairArgs {
  userId: string;
  /**
   * MEK imported for HKDF-SHA-256 subkey derivation. See
   * `importMekForHkdf` at the bottom of this module. Not the same
   * CryptoKey used to encrypt data rows — both are views on the same
   * 32 raw bytes.
   */
  mek: CryptoKey;
  /** Base64 of the per-user vault salt (same salt passed to Argon2id). */
  saltB64: string;
  supabase: SupabaseKeypairClient;
}

export type EnsureUserKeypairResult =
  | { generated: false }
  | { generated: true; publicKeyB64: string };

/**
 * If the calling user does not yet have a row in `user_public_keys`,
 * generate a hybrid keypair, MEK-wrap the private key, INSERT the
 * public row, and UPDATE vault_metadata.enc_private_key. If the public
 * row already exists, this is a no-op.
 *
 * Non-blocking contract: the calling VaultContext should `void`-swallow
 * rejections. A transient Supabase failure must not prevent the user
 * from using the app — we'll retry next unlock. Phase 4.3 pulls a
 * missing keypair into the invite path's pending-wrap notification.
 */
export async function ensureUserKeypair(
  args: EnsureUserKeypairArgs,
): Promise<EnsureUserKeypairResult> {
  const { userId, mek, saltB64, supabase } = args;

  const existing = await supabase
    .from("user_public_keys")
    .select("public_key_b64")
    .eq("user_id", userId)
    .maybeSingle();

  if (existing.error) {
    throw existing.error;
  }
  const existingData = existing.data as Partial<UserPublicKeyRow> | null;
  if (existingData?.public_key_b64) {
    return { generated: false };
  }

  // Generate the hybrid keypair, wrap the private half with an
  // HKDF-derived subkey, then publish. Public row first so the
  // existence-check on the next unlock correctly sees an idempotent
  // "already provisioned" state even if the UPDATE on vault_metadata
  // fails in between. (The UPDATE is idempotent on its own: we always
  // set enc_private_key to the just-computed ciphertext.)
  const wrapKey = await derivePqcSecretWrapKey(mek, saltB64);
  const kem = generateHybridKemKeyPair();
  const publicKeyB64 = bytesToBase64(kem.publicKey);
  const encPrivateKey = await encryptString(bytesToBase64(kem.secretKey), wrapKey);

  const insert = await supabase.from("user_public_keys").insert({
    user_id: userId,
    public_key_b64: publicKeyB64,
    algorithm: "x25519-mlkem768-v1",
  } as Record<string, unknown>);

  if (insert.error) {
    throw insert.error;
  }

  const update = await supabase
    .from("vault_metadata")
    .update({ enc_private_key: encPrivateKey } as Record<string, unknown>)
    .eq("user_id", userId);

  if (update.error) {
    throw update.error;
  }

  return { generated: true, publicKeyB64 };
}

// ---------------------------------------------------------------------------
// rewrapUserKeypair — atomic UPDATE on password change.
// ---------------------------------------------------------------------------

export interface RewrapUserKeypairArgs {
  userId: string;
  /** MEK currently wrapping the private key (used to unwrap). */
  oldMek: CryptoKey;
  /** MEK that will wrap the private key after re-wrap. */
  newMek: CryptoKey;
  /** Salt in effect during the unwrap (old MEK's HKDF salt). */
  oldSaltB64: string;
  /** Salt in effect after the wrap (new MEK's HKDF salt). */
  newSaltB64: string;
  supabase: SupabaseKeypairClient;
}

export type RewrapUserKeypairResult = { rewrapped: false; reason: "no-row" } | { rewrapped: true };

/**
 * Re-wrap the user's hybrid private key with a new MEK. Used by the
 * password-change flow so the household DEK wraps do not have to
 * rotate (HOUSEHOLD-SHARING-DESIGN.md §10 "Password change does NOT
 * re-encrypt household DEK"). The hybrid secret bytes are unchanged —
 * only the wrapping cipher changes.
 *
 * Atomicity guardrail: this function MUST NOT INSERT a replacement
 * row, DELETE the existing row, or touch user_public_keys. Leaving old
 * ciphertext around (even briefly) means an attacker with the old MEK
 * can continue to decrypt the old private-key wrap. The unit test in
 * `vault-keypair.test.ts` asserts that (a) UPDATE is called, (b)
 * DELETE is never called, (c) INSERT is never called on
 * vault_metadata, and (d) the public key stays byte-identical across
 * every re-wrap.
 *
 * Returns `{ rewrapped: false, reason: 'no-row' }` if the user has no
 * keypair yet — a valid state during the Phase 4.1 transition when a
 * user may change their password before their first unlock generates
 * a keypair. The VaultContext caller should not treat this as an error.
 */
export async function rewrapUserKeypair(
  args: RewrapUserKeypairArgs,
): Promise<RewrapUserKeypairResult> {
  const { userId, oldMek, newMek, oldSaltB64, newSaltB64, supabase } = args;

  const existing = await supabase
    .from("vault_metadata")
    .select("enc_private_key")
    .eq("user_id", userId)
    .maybeSingle();

  if (existing.error) {
    throw existing.error;
  }
  const existingData = existing.data as Partial<VaultMetadataPrivateKeyRow> | null;
  if (!existingData?.enc_private_key) {
    return { rewrapped: false, reason: "no-row" };
  }

  // Unwrap under the old MEK / old salt, then re-wrap under the new
  // MEK / new salt. The salts may differ if a password change rotated
  // the Argon2id salt (Orange Way does — see VaultContext
  // changeVaultPassword). The HKDF subkey must be derived from the
  // MEK and the salt that were in effect when the ciphertext was
  // written, not whatever is current.
  const oldWrapKey = await derivePqcSecretWrapKey(oldMek, oldSaltB64);
  const newWrapKey = await derivePqcSecretWrapKey(newMek, newSaltB64);
  const secretKeyB64 = await decryptString(existingData.enc_private_key, oldWrapKey);
  const newEncrypted = await encryptString(secretKeyB64, newWrapKey);

  // Atomic UPDATE on the existing vault_metadata row. No INSERT, no
  // DELETE, no row-count drift.
  const update = await supabase
    .from("vault_metadata")
    .update({
      enc_private_key: newEncrypted,
    } as Record<string, unknown>)
    .eq("user_id", userId);

  if (update.error) {
    throw update.error;
  }

  return { rewrapped: true };
}

// ---------------------------------------------------------------------------
// MEK → HKDF import helper.
// ---------------------------------------------------------------------------

/**
 * Import raw MEK bytes as an HKDF base key, suitable for passing to
 * `ensureUserKeypair` / `rewrapUserKeypair` (both of which ultimately
 * call `crypto.subtle.deriveBits({ name: 'HKDF' }, mek, ...)` inside
 * `derivePqcSecretWrapKey`).
 *
 * Orange Way stores the MEK as a non-extractable AES-GCM CryptoKey in
 * VaultContext (used for data encrypt/decrypt). For HKDF subkey
 * derivation we need a *separate* import with usage `['deriveBits']`.
 * Both imports come from the same raw bytes so there is no trust
 * boundary crossed — they are simply different "views" of the same
 * 32-byte MEK tailored to different WebCrypto operations.
 *
 * The returned CryptoKey is non-extractable.
 */
export async function importMekForHkdf(mekRaw: Uint8Array): Promise<CryptoKey> {
  // `globalThis.crypto` resolves to the same WebCrypto in the browser
  // (window.crypto) and in Node 20+ (node's built-in crypto.webcrypto
  // is exposed globally). Using the global form keeps this module
  // node-testable without any jsdom dependency.
  return globalThis.crypto.subtle.importKey(
    "raw",
    mekRaw as BufferSource,
    "HKDF",
    /* extractable */ false,
    ["deriveBits"],
  );
}
