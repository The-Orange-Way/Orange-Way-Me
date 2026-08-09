/**
 * Vault envelope, version 4 (zero-knowledge layer).
 *
 * The v2/v3 vault (see vault.ts) derives the MEK straight from the password,
 * so a password change would in principle re-key everything. v4 decouples the
 * two: a RANDOM 256-bit MEK is generated once and then WRAPPED under a
 * password-derived KEK. Changing the password rewraps one 40-byte slot and
 * touches zero ciphertext.
 *
 * Wrap primitive: AES Key Wrap (RFC 3394, WebCrypto "AES-KW"). KW embeds its
 * own integrity check (the fixed IV A6A6A6A6A6A6A6A6), so an unwrap under the
 * wrong KEK, or over a tampered wrapper, THROWS. That is the password check.
 * We deliberately keep NO verifier plaintext: a verifier is a decryption
 * oracle we do not need when the wrapper already authenticates.
 *
 * Slot-extensible: the envelope holds an array of slots, each a KEK wrap of
 * the SAME MEK under a different password/salt. This is how multi-device and
 * co-admin work, N independent wrappers over one key. Adding or removing a
 * wrapper never re-encrypts data.
 *
 * The envelope is safe to store server-side: it is only salts, KDF parameters,
 * and AES-KW ciphertext. The MEK itself is never serialized and is returned to
 * the caller only as raw bytes at the trust boundary, to be imported as a
 * non-extractable CryptoKey by the vault layer.
 */

import { argon2id } from "hash-wasm";

/** Envelope format version. */
export const VAULT_ENVELOPE_VERSION = 4;

/**
 * Argon2id parameters for the v4 KEK.
 *
 * NOTE: parallelism here is 1, which differs from v3 in vault.ts (4). This is
 * intentional; it means a v4 KEK derivation is NOT interchangeable with a v3
 * one for the same password.
 */
export const V4_ARGON2ID_MEMORY_KIB = 64 * 1024; // 64 MiB
export const V4_ARGON2ID_ITERATIONS = 3;
export const V4_ARGON2ID_PARALLELISM = 1;
export const V4_KEY_LENGTH_BYTES = 32; // 256-bit MEK and KEK
export const V4_SALT_LENGTH_BYTES = 16; // client-generated per slot

/** One password/device wrapper over the shared MEK. */
export interface EnvelopeSlot {
  /** Opaque slot identifier (e.g. "primary", a device id). */
  id: string;
  kdf: "argon2id";
  /** Argon2id memory cost in KiB. */
  mem: number;
  /** Argon2id iterations (time cost). */
  iter: number;
  /** Argon2id parallelism (lanes). */
  par: number;
  /** Base64 of the per-slot salt. */
  salt: string;
  wrap: "AES-KW";
  /** Base64 of AES-KW( MEK ), 40 bytes for a 32-byte MEK. */
  wrapped: string;
}

/** Serializable, server-safe wrapper around the MEK. Carries no plaintext. */
export interface VaultEnvelope {
  v: number;
  /**
   * Rotation counter. Bumped only when the MEK itself is rotated (a new random
   * MEK replaces the old one). A password change does NOT bump the epoch, it
   * only edits a slot, so downstream ciphertext stays valid.
   */
  epoch: number;
  slots: EnvelopeSlot[];
}

// ---------- base64 helpers (module-local, byte-exact) ----------

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

// ---------- KEK derivation ----------

/**
 * Derive raw KEK bytes from a password and salt with Argon2id, using the
 * parameters recorded ON THE SLOT. Reading the parameters from the slot (not
 * from module constants) means an envelope written under one parameter tier
 * still unwraps after we tighten the defaults for new vaults.
 */
async function deriveKekBytes(password: string, slot: EnvelopeSlot): Promise<Uint8Array> {
  if (typeof password !== "string" || password.length === 0) {
    throw new Error("Vault password is required");
  }
  return argon2id({
    password: new TextEncoder().encode(password),
    salt: b64decode(slot.salt),
    iterations: slot.iter,
    memorySize: slot.mem,
    parallelism: slot.par,
    hashLength: V4_KEY_LENGTH_BYTES,
    outputType: "binary",
  });
}

/** Import raw KEK bytes as an AES-KW wrapping key. */
async function importKek(kekBytes: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", kekBytes as BufferSource, { name: "AES-KW" }, false, [
    "wrapKey",
    "unwrapKey",
  ]);
}

/**
 * Import raw MEK bytes as an EXTRACTABLE AES-GCM key so AES-KW can wrap it, and
 * so it can be exported back to raw after an unwrap. The extractable copy lives
 * only for the wrap/unwrap call; the vault layer re-imports the MEK as a
 * non-extractable key for actual use.
 */
async function importMekExtractable(mekBytes: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    mekBytes as BufferSource,
    { name: "AES-GCM", length: 256 },
    /* extractable */ true,
    ["encrypt", "decrypt"],
  );
}

// ---------- slot build / unwrap ----------

async function buildSlot(
  id: string,
  mekBytes: Uint8Array,
  password: string,
): Promise<EnvelopeSlot> {
  const salt = crypto.getRandomValues(new Uint8Array(V4_SALT_LENGTH_BYTES));
  const slotMeta: EnvelopeSlot = {
    id,
    kdf: "argon2id",
    mem: V4_ARGON2ID_MEMORY_KIB,
    iter: V4_ARGON2ID_ITERATIONS,
    par: V4_ARGON2ID_PARALLELISM,
    salt: b64encode(salt),
    wrap: "AES-KW",
    wrapped: "",
  };
  const kek = await importKek(await deriveKekBytes(password, slotMeta));
  const mekKey = await importMekExtractable(mekBytes);
  const wrapped = await crypto.subtle.wrapKey("raw", mekKey, kek, "AES-KW");
  slotMeta.wrapped = b64encode(new Uint8Array(wrapped));
  return slotMeta;
}

async function unwrapSlot(slot: EnvelopeSlot, password: string): Promise<Uint8Array> {
  const kek = await importKek(await deriveKekBytes(password, slot));
  // unwrapKey throws (OperationError) on a wrong KEK or a tampered wrapper,
  // because AES-KW verifies the RFC 3394 integrity block. That throw is the
  // password check.
  const mekKey = await crypto.subtle.unwrapKey(
    "raw",
    b64decode(slot.wrapped) as BufferSource,
    kek,
    "AES-KW",
    { name: "AES-GCM", length: 256 },
    /* extractable */ true,
    ["encrypt", "decrypt"],
  );
  return new Uint8Array(await crypto.subtle.exportKey("raw", mekKey));
}

// ---------- public API ----------

/**
 * Create a fresh v4 envelope: generate a random 256-bit MEK, wrap it under the
 * password in slot "primary", and return both the envelope (safe to store) and
 * the raw MEK bytes (to be imported as a non-extractable key by the caller).
 */
export async function createVaultEnvelope(
  password: string,
): Promise<{ envelope: VaultEnvelope; mekRawBytes: Uint8Array }> {
  const mekRawBytes = crypto.getRandomValues(new Uint8Array(V4_KEY_LENGTH_BYTES));
  const slot = await buildSlot("primary", mekRawBytes, password);
  return {
    envelope: { v: VAULT_ENVELOPE_VERSION, epoch: 0, slots: [slot] },
    mekRawBytes,
  };
}

/**
 * Unwrap the MEK from an envelope with a password. Tries each slot and returns
 * the raw MEK bytes from the first that opens. Throws if no slot opens (wrong
 * password) or the envelope is malformed.
 */
export async function unwrapVaultEnvelope(
  envelope: VaultEnvelope,
  password: string,
): Promise<Uint8Array> {
  if (!envelope || !Array.isArray(envelope.slots) || envelope.slots.length === 0) {
    throw new Error("Vault envelope has no slots");
  }
  let lastErr: unknown = null;
  for (const slot of envelope.slots) {
    try {
      return await unwrapSlot(slot, password);
    } catch (err) {
      lastErr = err;
    }
  }
  throw new Error("Vault password did not open any slot", { cause: lastErr });
}

/**
 * Add a wrapper for the SAME MEK under a new password (new device or co-admin).
 * The caller must have already unwrapped the MEK with an existing password, so
 * this never needs the old password. Returns a new envelope; the epoch is
 * unchanged because the MEK did not change.
 */
export async function addSlotToEnvelope(
  envelope: VaultEnvelope,
  mekRawBytes: Uint8Array,
  slotId: string,
  newPassword: string,
): Promise<VaultEnvelope> {
  if (envelope.slots.some((s) => s.id === slotId)) {
    throw new Error(`Envelope already has a slot with id ${slotId}`);
  }
  const slot = await buildSlot(slotId, mekRawBytes, newPassword);
  return { ...envelope, slots: [...envelope.slots, slot] };
}
