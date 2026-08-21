/**
 * Vault crypto primitives (zero-knowledge layer).
 *
 * Responsibilities:
 *   - Derive a Master Encryption Key (MEK) from the user's vault password
 *     using PBKDF2 + SHA-256, 600,000 iterations (OWASP 2023+).
 *   - AES-256-GCM authenticated encryption for individual fields and blobs.
 *   - HMAC-SHA-256 blind indexes derived from the MEK via HKDF, so we can
 *     search encrypted columns (merchant, category) without exposing them.
 *   - A "verifier" plaintext that we encrypt at vault-creation time and
 *     try to decrypt on unlock — confirming the password without ever
 *     transmitting it.
 *   - A 12-word BIP-39-style recovery code that wraps a copy of the MEK,
 *     so a forgotten vault password can be recovered without a server-side
 *     escrow.
 *
 * Wire format (encryptText / encryptBlob):
 *   base64( iv[12] || ciphertext || gcm_tag[16] )
 *
 * The MEK is held only as a non-extractable CryptoKey in memory; it is
 * NEVER serialized, NEVER sent to the server, NEVER written to storage.
 */

import { argon2id } from "hash-wasm";

const PBKDF2_ITERATIONS = 600_000;
const HMAC_HKDF_LABEL = "ow-hmac-v1";
const RECOVERY_HKDF_LABEL = "ow-recovery-v1";
export const VAULT_VERIFIER_PLAINTEXT = "ORANGE_WAY_VAULT_V1";
/**
 * Minimum password length enforced at vault CREATION by UI components.
 * NOT enforced inside derive* functions — those must remain usable for
 * unlocking legacy vaults (and decrypting legacy backup files) that were
 * created under a looser policy.
 */
export const MIN_VAULT_PASSWORD_LENGTH = 14;

// Argon2id parameters (OWASP 2023 recommended tier).
// 64 MiB memory × 3 iterations × 4 parallelism gives ~500 ms on a modern
// laptop and is >10,000× harder to attack on GPU/ASIC than PBKDF2-SHA256.
const ARGON2ID_MEMORY_KIB = 64 * 1024; // 64 MiB
const ARGON2ID_ITERATIONS = 3;
const ARGON2ID_PARALLELISM = 4;

// ---------- helpers ----------

function b64encode(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function b64decode(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function randomBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}

export function randomBytesB64(length: number): string {
  return b64encode(randomBytes(length));
}

// ---------- key derivation ----------

/**
 * Derive a non-extractable AES-256-GCM CryptoKey from a vault password +
 * a per-user salt (base64). Iterations default to 600k.
 */
export async function deriveMek(
  password: string,
  saltB64: string,
  iterations: number = PBKDF2_ITERATIONS,
): Promise<CryptoKey> {
  // Intentionally no minimum-length check here — this path is shared between
  // vault creation and unlocking existing (possibly legacy) vaults. The
  // creation-time policy (MIN_VAULT_PASSWORD_LENGTH) is enforced at the UI layer.
  if (typeof password !== "string" || password.length === 0) {
    throw new Error("Vault password is required");
  }
  const baseKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey", "deriveBits"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: b64decode(saltB64) as BufferSource,
      iterations,
      hash: "SHA-256",
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/**
 * Derive an HMAC-SHA-256 key from the MEK via HKDF using a fixed label.
 * Used for blind-index columns (hmac_merchant, hmac_category).
 *
 * The MEK CryptoKey is non-extractable, so we re-derive raw bits from the
 * password directly via PBKDF2 + HKDF rather than exporting the MEK.
 * Caller passes the same password + salt that produced the MEK.
 */
export async function deriveHmacKey(
  password: string,
  saltB64: string,
  hmacSaltB64: string,
  iterations: number = PBKDF2_ITERATIONS,
): Promise<CryptoKey> {
  // Derive 32 raw bytes via PBKDF2 (we cannot export the AES MEK).
  const baseKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const ikm = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: b64decode(saltB64) as BufferSource,
      iterations,
      hash: "SHA-256",
    },
    baseKey,
    256,
  );
  // HKDF expand into a dedicated HMAC subkey.
  const hkdfKey = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: b64decode(hmacSaltB64) as BufferSource,
      info: new TextEncoder().encode(HMAC_HKDF_LABEL),
    },
    hkdfKey,
    { name: "HMAC", hash: "SHA-256", length: 256 },
    false,
    ["sign"],
  );
}

/**
 * Derive a recovery KEK from a recovery code (the 12-word string).
 * Uses PBKDF2 with a fixed app-wide salt label — recovery codes have
 * ~128 bits of entropy on their own, so the salt is just domain
 * separation, not a secret.
 */
export async function deriveRecoveryKek(recoveryCode: string): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(recoveryCode.trim().toLowerCase()),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: new TextEncoder().encode(RECOVERY_HKDF_LABEL) as BufferSource,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

// ---------- AES-GCM encrypt / decrypt ----------

export async function encryptText(plaintext: string, key: CryptoKey): Promise<string> {
  const iv = randomBytes(12);
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    key,
    new TextEncoder().encode(plaintext),
  );
  const combined = new Uint8Array(12 + ct.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ct), 12);
  return b64encode(combined);
}

export async function decryptText(ciphertextB64: string, key: CryptoKey): Promise<string> {
  const combined = b64decode(ciphertextB64);
  if (combined.length < 12) throw new Error("Invalid ciphertext");
  const iv = combined.slice(0, 12);
  const data = combined.slice(12);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: iv as BufferSource }, key, data);
  return new TextDecoder().decode(pt);
}

export async function encryptBlob(
  plaintext: ArrayBuffer | Uint8Array,
  key: CryptoKey,
): Promise<Blob> {
  const iv = randomBytes(12);
  const bytes = plaintext instanceof ArrayBuffer ? new Uint8Array(plaintext) : plaintext;
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    key,
    bytes as BufferSource,
  );
  const combined = new Uint8Array(12 + ct.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ct), 12);
  return new Blob([combined], { type: "application/octet-stream" });
}

export async function decryptBlob(
  ciphertext: Blob | ArrayBuffer,
  key: CryptoKey,
): Promise<ArrayBuffer> {
  const buf = ciphertext instanceof Blob ? await ciphertext.arrayBuffer() : ciphertext;
  const combined = new Uint8Array(buf);
  if (combined.length < 12) throw new Error("Invalid ciphertext blob");
  const iv = combined.slice(0, 12);
  const data = combined.slice(12);
  return crypto.subtle.decrypt({ name: "AES-GCM", iv: iv as BufferSource }, key, data);
}

// ---------- HMAC blind indexes ----------

/**
 * Compute a base64-encoded HMAC-SHA-256 of the lowercased input.
 * Use for blind-index columns so equality-search works without
 * leaking plaintext.
 */
export async function blindIndex(input: string, hmacKey: CryptoKey): Promise<string> {
  const sig = await crypto.subtle.sign(
    "HMAC",
    hmacKey,
    new TextEncoder().encode(input.trim().toLowerCase()),
  );
  return b64encode(new Uint8Array(sig));
}

// ---------- recovery code (12-word BIP-39-style) ----------

// Short, friendly wordlist — not full BIP-39, but ~2048-ish entropy when
// combined into 12 words gives ≥ 128 bits.

/**
 * Generate a 12-word recovery code using the full EFF Large Wordlist
 * (7,776 words). Each word is uniformly chosen using rejection sampling
 * over crypto.getRandomValues(Uint32Array) — no modulo bias.
 *
 * log2(7776) * 12 ≈ 155 bits of entropy — exceeds BIP-39 (132 bits)
 * and is gated by the same PBKDF2 / Argon2id work factor as the vault
 * password itself.
 *
 * Backwards compatibility: existing recovery codes (generated with the
 * earlier 251-word implementation) keep unlocking their vaults. This
 * function's output is treated as opaque passphrase input to PBKDF2,
 * so the distribution of words has no effect on existing-vault recovery.
 *
 * ZKA invariant: the returned code is only ever user-facing passphrase
 * input. Never log it. Never transmit it.
 */
export async function generateRecoveryCode(): Promise<string> {
  const mod = await import("@/assets/eff-wordlist.json");
  const words = (mod.default ?? mod) as string[];
  if (!Array.isArray(words) || words.length !== 7776) {
    throw new Error(
      `EFF wordlist integrity check failed: expected 7776 words, got ${
        Array.isArray(words) ? words.length : typeof words
      }`,
    );
  }

  const NEED = 12;
  const n = words.length; // 7776
  // Largest multiple of n that fits in uint32. Values >= max would create
  // modulo bias when reduced via `r % n`, so we reject them and re-roll.
  // Probability of rejection per draw: (2^32 - max) / 2^32 ≈ 6e-7.
  const max = Math.floor(0x100000000 / n) * n;

  const out: string[] = [];
  while (out.length < NEED) {
    const buf = new Uint32Array(NEED - out.length);
    crypto.getRandomValues(buf);
    for (const r of buf) {
      if (r < max) {
        out.push(words[r % n]);
        if (out.length === NEED) break;
      }
    }
  }
  return out.join(" ");
}

/**
 * Wrap raw MEK bytes with a recovery KEK so a forgotten password can
 * be recovered. We export the MEK material from raw bytes the caller
 * provides (caller derives once, uses both for the AES key import and
 * for this wrap).
 */
export async function wrapMekWithRecovery(
  mekRawBytes: ArrayBuffer,
  recoveryCode: string,
): Promise<string> {
  const kek = await deriveRecoveryKek(recoveryCode);
  return encryptText(b64encode(new Uint8Array(mekRawBytes)), kek);
}

export async function unwrapMekWithRecovery(
  wrappedB64: string,
  recoveryCode: string,
): Promise<Uint8Array> {
  const kek = await deriveRecoveryKek(recoveryCode);
  const b64 = await decryptText(wrappedB64, kek);
  return b64decode(b64);
}

/**
 * Derive raw MEK bytes (32) from password + salt — used only at vault
 * creation time so we can wrap them with the recovery KEK. We never
 * keep these bytes around after wrapping.
 */
export async function deriveMekRawBytes(
  password: string,
  saltB64: string,
  iterations: number = PBKDF2_ITERATIONS,
): Promise<ArrayBuffer> {
  const baseKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  return crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: b64decode(saltB64) as BufferSource,
      iterations,
      hash: "SHA-256",
    },
    baseKey,
    256,
  );
}

/** Import 32 raw bytes as a non-extractable AES-256-GCM key. */
export async function importMekFromRaw(rawBytes: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    rawBytes as BufferSource,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

// ---------- password-based MEK wrap/unwrap (new vault architecture) ----------

/**
 * Wrap raw MEK bytes with a password-derived KEK (AES-GCM).
 * Stored as `enc_mek_ciphertext` in vault_metadata. This decouples the MEK
 * from the password, so changing the vault password does NOT invalidate
 * any encrypted data — only this wrapper changes.
 */
export async function wrapMekWithPassword(
  mekRawBytes: ArrayBuffer,
  password: string,
  saltB64: string,
  iterations: number = PBKDF2_ITERATIONS,
): Promise<string> {
  const kek = await deriveMek(password, saltB64, iterations);
  return encryptText(b64encode(new Uint8Array(mekRawBytes)), kek);
}

export async function unwrapMekWithPassword(
  ciphertextB64: string,
  password: string,
  saltB64: string,
  iterations: number = PBKDF2_ITERATIONS,
): Promise<Uint8Array> {
  const kek = await deriveMek(password, saltB64, iterations);
  const b64 = await decryptText(ciphertextB64, kek);
  return b64decode(b64);
}

/**
 * Generate and encrypt a 32-byte HMAC key with the MEK.
 * Stored as `enc_hmac_key` in vault_metadata. Decouples HMAC key from the
 * vault password, so blind indexes stay valid after a password change.
 */
export async function createEncryptedHmacKey(
  mek: CryptoKey,
): Promise<{ raw: Uint8Array; ciphertext: string }> {
  const raw = crypto.getRandomValues(new Uint8Array(32));
  const ciphertext = await encryptText(b64encode(raw), mek);
  return { raw, ciphertext };
}

/**
 * Seal the Orange Rails MEK bytes under the vault MEK (DL-1506).
 *
 * Same wire format and the same reasoning as createEncryptedHmacKey above,
 * which decouples the HMAC key from the vault password so blind indexes stay
 * valid after a password change. The Orange Rails namespace needs precisely
 * that decoupling and never got it: its subkeys are derived from the password
 * and kdf_salt, so a password change or a recovery rotates them and orphans
 * every row already sealed under the old ones.
 *
 * The value being wrapped here is the CURRENT Orange Rails MEK, not a fresh
 * one. That is the whole point: a new key would need every sealed row
 * re-encrypted, and a browser that may never see some of those rows cannot
 * promise to do it. Preserving the value means nothing has to be re-encrypted
 * at all.
 *
 * The vault MEK is a random key that is wrapped rather than derived, so it is
 * unchanged by a password change and recoverable from the recovery code.
 * Anything sealed under it inherits both properties.
 */
export async function wrapOrMekWithVaultMek(
  orMekBytes: Uint8Array,
  mek: CryptoKey,
): Promise<string> {
  if (orMekBytes.length !== 32) {
    throw new Error("Orange Rails MEK must be 32 bytes");
  }
  return encryptText(b64encode(orMekBytes), mek);
}

/**
 * Open what wrapOrMekWithVaultMek sealed.
 *
 * THROWS rather than returning null, and the caller must not catch this and
 * derive instead. After a salt rotation, deriving produces a well-formed key
 * that opens nothing while looking exactly like success, which is the defect
 * this whole change exists to remove. A thrown error is visible on the first
 * attempt; a silently wrong key is invisible until a customer notices their
 * history is gone.
 *
 * The length check is not ceremony. A short or long result means the blob is
 * not what we wrote, and feeding it to HKDF anyway would derive four subkeys
 * that open nothing, which is the same failure wearing a different hat.
 */
export async function unwrapOrMekWithVaultMek(
  ciphertextB64: string,
  mek: CryptoKey,
): Promise<Uint8Array> {
  const b64 = await decryptText(ciphertextB64, mek);
  const raw = b64decode(b64);
  if (raw.length !== 32) {
    throw new Error("Sealed Orange Rails MEK is not 32 bytes; refusing to use it");
  }
  return raw;
}

export async function decryptHmacKey(ciphertextB64: string, mek: CryptoKey): Promise<CryptoKey> {
  const b64 = await decryptText(ciphertextB64, mek);
  const raw = b64decode(b64);
  return crypto.subtle.importKey(
    "raw",
    raw as BufferSource,
    { name: "HMAC", hash: "SHA-256", length: 256 },
    false,
    ["sign"],
  );
}

// ---------- Argon2id key derivation (vault key version 3) ----------

/**
 * Derive 32 raw bytes from a password + salt using Argon2id.
 *
 * Argon2id (RFC 9106) is memory-hard, which defeats the GPU/ASIC brute-force
 * advantage PBKDF2 suffers from. At the parameters below, a single attempt
 * costs ~500 ms and ~64 MiB of RAM per core on a modern CPU — and that cost
 * does not drop on specialized hardware.
 */
export async function deriveMekRawBytesArgon2id(
  password: string,
  saltB64: string,
): Promise<ArrayBuffer> {
  if (typeof password !== "string" || password.length === 0) {
    throw new Error("Vault password is required");
  }
  const hex = await argon2id({
    password: new TextEncoder().encode(password),
    salt: b64decode(saltB64),
    iterations: ARGON2ID_ITERATIONS,
    memorySize: ARGON2ID_MEMORY_KIB,
    parallelism: ARGON2ID_PARALLELISM,
    hashLength: 32,
    outputType: "hex",
  });
  // Convert hex string to ArrayBuffer.
  const len = hex.length / 2;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes.buffer;
}

/**
 * Derive a non-extractable AES-256-GCM CryptoKey from a password + salt
 * using Argon2id. The raw key bytes are used only to import the CryptoKey
 * and are discarded immediately afterward.
 */
export async function deriveMekArgon2id(password: string, saltB64: string): Promise<CryptoKey> {
  const raw = await deriveMekRawBytesArgon2id(password, saltB64);
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM", length: 256 }, false, [
    "encrypt",
    "decrypt",
  ]);
}

/**
 * Wrap raw MEK bytes under an Argon2id-derived KEK. Used at vault creation
 * (v3 vaults) and at upgrade (v2 → v3) to re-wrap the existing MEK without
 * re-encrypting any data.
 */
export async function wrapMekWithPasswordArgon2id(
  mekRawBytes: ArrayBuffer,
  password: string,
  saltB64: string,
): Promise<string> {
  const kek = await deriveMekArgon2id(password, saltB64);
  return encryptText(b64encode(new Uint8Array(mekRawBytes)), kek);
}

export async function unwrapMekWithPasswordArgon2id(
  ciphertextB64: string,
  password: string,
  saltB64: string,
): Promise<Uint8Array> {
  const kek = await deriveMekArgon2id(password, saltB64);
  const b64 = await decryptText(ciphertextB64, kek);
  return b64decode(b64);
}

// ---------- OrangeRails subkey derivation (cross-app Bitcoin sync) ----------
//
// Orange Way is a platform consumer of OrangeRails. Provider credentials
// (e.g. Blink API keys) and synced transactions are encrypted in the
// browser before they ever reach OR's database, using two AES-256-GCM
// subkeys derived deterministically from the user's vault password.
//
// Why a separate derivation (not the vault MEK):
//   - The vault MEK changes shape across versions (v2 = PBKDF2, v3 = direct
//     Argon2id, future v4 = random + wrapped). Upgrading vault would
//     otherwise invalidate all stored OR ciphertexts.
//   - The per-user `kdf_salt` (vault_metadata.kdf_salt) acts as the salt
//     context for this namespace.
//
// HKDF info strings ('orangerails-creds-v1', 'orangerails-txns-v1') and
// the salt-context format MUST stay byte-identical to the OR wire contract —
// OR's edge functions verify ciphertext shape against this exact format.
//
// Cost: one extra Argon2id call (~500 ms) per vault unlock. Acceptable
// for the durability gain.

/**
 * Derive 32 raw bytes that act as the OR-namespaced "MEK". Stable across
 * vault key-version upgrades (v2 PBKDF2 → v3 Argon2id → v4 wrapped).
 *
 * @param password         User's vault password (never leaves the browser).
 * @param userId           Supabase auth user.id (uuid string).
 * @param userVaultSaltB64 Per-user random salt — stored in
 *                         vault_metadata.kdf_salt.
 */
export async function deriveOrMekBytes(
  password: string,
  userId: string,
  userVaultSaltB64: string,
): Promise<Uint8Array> {
  if (typeof password !== "string" || password.length === 0) {
    throw new Error("Vault password is required");
  }
  const encoder = new TextEncoder();
  const saltBytes = encoder.encode("ow-or-mek-v1:" + userId + ":" + userVaultSaltB64);
  const hashBytes = await argon2id({
    password: encoder.encode(password),
    salt: saltBytes,
    memorySize: ARGON2ID_MEMORY_KIB,
    iterations: ARGON2ID_ITERATIONS,
    parallelism: ARGON2ID_PARALLELISM,
    hashLength: 32,
    outputType: "binary",
  });
  return hashBytes;
}

async function deriveOrSubkey(
  mekRaw: Uint8Array,
  userVaultSaltB64: string,
  hkdfInfo: string,
): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const saltBytes = encoder.encode("ow-or:" + userVaultSaltB64);
  const mekAsHkdf = await crypto.subtle.importKey("raw", mekRaw as BufferSource, "HKDF", false, [
    "deriveBits",
  ]);
  const rawBits = await crypto.subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: saltBytes as BufferSource,
      info: encoder.encode(hkdfInfo) as BufferSource,
    },
    mekAsHkdf,
    256,
  );
  return crypto.subtle.importKey("raw", rawBits, { name: "AES-GCM" }, /* extractable */ true, [
    "encrypt",
    "decrypt",
  ]);
}

/** Subkey for encrypting connection labels + provider credentials. */
export async function deriveOrCredsKeyFromMek(
  mekRaw: Uint8Array,
  userVaultSaltB64: string,
): Promise<CryptoKey> {
  return deriveOrSubkey(mekRaw, userVaultSaltB64, "orangerails-creds-v1");
}

/** Subkey for encrypting synced transaction payloads. */
export async function deriveOrTxnsKeyFromMek(
  mekRaw: Uint8Array,
  userVaultSaltB64: string,
): Promise<CryptoKey> {
  return deriveOrSubkey(mekRaw, userVaultSaltB64, "orangerails-txns-v1");
}

/**
 * Derive the raw 32-byte OPK seed (NOT an AES key) from the OR MEK. Feeds
 * libsodium crypto_box_seed_keypair to produce the X25519 keypair OR seals
 * background-synced bank transactions to. Same OR-subkey HKDF family as
 * creds/txns (salt prefix "ow-or:") so it regenerates deterministically
 * on every unlock with no separate storage.
 */
export async function deriveOrOpkSeedFromMek(
  mekRaw: Uint8Array,
  userVaultSaltB64: string,
): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const saltBytes = encoder.encode("ow-or:" + userVaultSaltB64);
  const mekAsHkdf = await crypto.subtle.importKey("raw", mekRaw as BufferSource, "HKDF", false, [
    "deriveBits",
  ]);
  const rawBits = await crypto.subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: saltBytes as BufferSource,
      info: encoder.encode("orangerails-opk-seed-v1") as BufferSource,
    },
    mekAsHkdf,
    256,
  );
  return new Uint8Array(rawBits);
}

/**
 * Derive the AES-GCM key that re-seals synced data for the stealth-sync
 * widget, which runs in a cross-origin popup. Same OR-subkey HKDF family
 * as creds / txns / opk-seed (IKM = OR MEK, salt "ow-or:" + userVaultSaltB64)
 * with a distinct HKDF info label, so it regenerates deterministically on
 * every unlock with no separate storage and can never collide with a sibling.
 *
 * READ THIS BEFORE RELYING ON extractable = false HERE.
 *
 * This CryptoKey form is non-extractable, so the bytes cannot be read back
 * out of THIS object. That is not, today, a guarantee about the widget: the
 * widget's contract accepts the key only as base64, so the platform sends the
 * raw bytes over postMessage via deriveOrStealthWidgetKeyBytesFromMek below.
 * The receiving origin therefore holds usable key material and can both
 * encrypt and decrypt with it, and nothing on this side can prevent it being
 * forwarded once it is in that context.
 *
 * The scope that does hold is the HKDF label: this key opens only what was
 * sealed under "orangerails-stealth-widget-v1", never the credentials,
 * transactions or OPK siblings.
 *
 * The intended end state is to hand over this non-extractable CryptoKey by
 * structured clone instead, so the far side can use the key without ever
 * reading it. That needs a field on the widget side that does not exist yet
 * and proof that a non-extractable key survives the clone in every browser we
 * support. Until both land, treat the bytes as disclosed to that origin and
 * do not write code whose safety depends on them being secret from it.
 */
export async function deriveOrStealthWidgetKeyFromMek(
  mekRaw: Uint8Array,
  userVaultSaltB64: string,
): Promise<CryptoKey> {
  const rawBits = await deriveOrStealthWidgetKeyBytesFromMek(mekRaw, userVaultSaltB64);
  return crypto.subtle.importKey(
    "raw",
    rawBits as BufferSource,
    { name: "AES-GCM" },
    /* extractable */ false,
    ["encrypt", "decrypt"],
  );
}

/**
 * The same 256 bits as deriveOrStealthWidgetKeyFromMek, as raw bytes.
 *
 * The widget's opening message takes the wrapping key as base64, which is
 * the only shape its current contract accepts, so the platform has to be
 * able to produce the bytes. Both functions read the same salt and the same
 * HKDF info from this one place: the base64 the widget receives and the
 * CryptoKey a caller derives locally are therefore provably the same key,
 * and a later change to the label cannot move one without moving the other.
 *
 * The caller owns the lifetime of what this returns. It is raw key material:
 * zero it when the vault locks, exactly as the OPK seed is handled, and
 * never write it to storage, a log, or a network call.
 */
export async function deriveOrStealthWidgetKeyBytesFromMek(
  mekRaw: Uint8Array,
  userVaultSaltB64: string,
): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const saltBytes = encoder.encode("ow-or:" + userVaultSaltB64);
  const mekAsHkdf = await crypto.subtle.importKey("raw", mekRaw as BufferSource, "HKDF", false, [
    "deriveBits",
  ]);
  const rawBits = await crypto.subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: saltBytes as BufferSource,
      info: encoder.encode("orangerails-stealth-widget-v1") as BufferSource,
    },
    mekAsHkdf,
    256,
  );
  return new Uint8Array(rawBits);
}

// ---------- KDF strategy map (Open/Closed Principle extension point) ----------
//
// STABILITY RULE: a strategy entry MUST never be removed from
// KEY_DERIVATION_STRATEGIES once a vault has been written under it.
// Every vault row stores its own vault_key_version, and unlock fails
// permanently if its strategy is no longer registered.
//
// History: pre-public-launch the registry carried v2 (PBKDF2-SHA256
// 600k iter) and v3 (Argon2id 64 MiB / 3 iter / 4 lanes), with v3 as
// the upgrade target driven by an explicit Settings-page button. When
// the public-launch wipe removed every existing vault row, no vault
// referenced v2 or v3 anymore, so the registry was renumbered to a
// single entry at v1 mapping to the same Argon2id parameters. New
// vaults created after the launch are written under v=1.
//
// When adding a new version, append a new entry and bump
// CURRENT_VAULT_KEY_VERSION. Never delete a previous entry.

export type VaultKeyVersion = 1;
export const CURRENT_VAULT_KEY_VERSION: VaultKeyVersion = 1;

export interface KeyDerivationStrategy {
  deriveMek: (password: string, saltB64: string) => Promise<CryptoKey>;
  deriveMekRawBytes: (password: string, saltB64: string) => Promise<ArrayBuffer>;
  wrapMekWithPassword: (mek: ArrayBuffer, password: string, saltB64: string) => Promise<string>;
  unwrapMekWithPassword: (ct: string, password: string, saltB64: string) => Promise<Uint8Array>;
}

/**
 * Strategy map keyed by vault_key_version. A new entry plugs in here
 * (e.g. v=2 with bumped Argon2id parameters or a future memory-hard
 * KDF) without touching the VaultContext unlock flow.
 */
export const KEY_DERIVATION_STRATEGIES: Record<VaultKeyVersion, KeyDerivationStrategy> = {
  1: {
    deriveMek: deriveMekArgon2id,
    deriveMekRawBytes: deriveMekRawBytesArgon2id,
    wrapMekWithPassword: wrapMekWithPasswordArgon2id,
    unwrapMekWithPassword: unwrapMekWithPasswordArgon2id,
  },
};

// ============================================================================
// Orange Rails adapter exports — Phase 4.0
// ----------------------------------------------------------------------------
// These re-exports (and thin wrappers) expose Orange Way's native vault
// primitives under the names that Orange Rails' pqc-lifecycle.ts,
// co-admin.ts, and key-derivation.ts import. This keeps those files
// byte-identical across the two consumers.
//
// Do NOT add new logic here — only name translations over existing exports.
// ============================================================================

/** OR alias for encryptText — identical semantics (AES-256-GCM). */
export const encryptString = encryptText;

/** OR alias for decryptText — identical semantics (AES-256-GCM). */
export const decryptString = decryptText;

/**
 * OR alias for deriveMekRawBytes, returning Uint8Array instead of
 * ArrayBuffer to match OR's signature (deriveMekRaw: Uint8Array). The
 * underlying Argon2id path is the same — the only shape difference is the
 * view wrapping the same bytes.
 *
 * OR's deriveMekRaw uses a single-argument (password, salt) signature
 * under Argon2id v3 parameters, which matches deriveMekRawBytesArgon2id
 * byte-for-byte. We route through the Argon2id variant so the co-admin
 * grant flow uses the vault's current KDF (v3), not the legacy PBKDF2 path.
 */
export async function deriveMekRaw(password: string, saltB64: string): Promise<Uint8Array> {
  const buf = await deriveMekRawBytesArgon2id(password, saltB64);
  return new Uint8Array(buf);
}

/**
 * OR alias for importing 32 raw bytes as an extractable AES-256-GCM key.
 * OR's importAesKey takes ArrayBuffer and returns an extractable key so
 * HKDF-derived subkeys can be handed to sync edge functions in-transit.
 * importMekFromRaw is non-extractable by design, so this wrapper uses
 * the raw WebCrypto call directly (matching OR's exact behaviour).
 */
export async function importAesKey(rawBytes: ArrayBuffer): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", rawBytes, { name: "AES-GCM" }, /* extractable */ true, [
    "encrypt",
    "decrypt",
  ]);
}

/**
 * OR alias for importing 32 raw bytes as a non-extractable AES-256-GCM key.
 * Equivalent to importMekFromRaw but accepts ArrayBuffer (OR's signature)
 * in addition to Uint8Array. Used for verifier subkeys that must never
 * leave the browser as raw bytes.
 */
export async function importAesKeyNonExtractable(rawBytes: ArrayBuffer): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", rawBytes, { name: "AES-GCM" }, /* extractable */ false, [
    "encrypt",
    "decrypt",
  ]);
}
