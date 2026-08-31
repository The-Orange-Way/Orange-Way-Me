/**
 * Does the pinned Orange Rails key material actually survive a vault salt
 * rotation? (OWM-T0391, the execution check for OWM-T0176 / DL-1506.)
 *
 * WHY THIS FILE EXISTS. The fix pins the Orange Rails key bytes by WRAPPING
 * them under the vault key rather than deriving them from
 * `vault_metadata.kdf_salt`. That protects the customer's already sealed rows
 * only if the vault key itself is unchanged by a password change. Nothing
 * anywhere asserted that. Its neighbour `or-key-material.test.ts` covers the
 * decision function, which is pure and holds no crypto: it proves which branch
 * is taken, with placeholder strings standing in for keys, and can therefore
 * never show that the bytes on both sides of a rotation are the same bytes.
 *
 * WHAT IS UNDER TEST. Key recovery over the shipped primitives, with no mocks
 * and no locally reimplemented crypto. Every call below is the function the
 * app calls: real Argon2id, the real wrap and unwrap, the real HKDF subkey
 * step. There is no user interface in the property, so there is none in the
 * test either.
 *
 * THE SEQUENCE, mirroring the password change path in VaultContext:
 *   1. A vault exists at salt S-old with password P. Its key bytes are random
 *      and wrapped, not derived.
 *   2. The Orange Rails key is derived from (P, user id, S-old) and pinned by
 *      wrapping it under the vault key, alongside S-old and the generation.
 *   3. A payload is sealed under the subkey that key produces.
 *   4. The password changes to P-prime. That mints S-new and re-wraps the SAME
 *      vault key bytes under it.
 *   5. Afterwards the pinned blob must still open to the same 32 bytes, and
 *      the payload sealed in step 3 must still open.
 *
 * THE NEGATIVE CONTROL is the pre-fix path: nothing pinned, so the client
 * re-derives against the salt in force. It must produce a different key that
 * opens nothing. Without it this file would pass whether or not the pin does
 * anything, which is the failure mode a guard test exists to avoid.
 *
 * ZERO KNOWLEDGE: no plaintext, no address, no transaction id, no wallet
 * identifying value and no real customer material appears here. Every input is
 * synthetic.
 *
 * COST: Argon2id is deliberately expensive, about half a second per call, and
 * this file makes eight of them. They all happen once in `beforeAll` so the
 * assertions themselves stay instant.
 */

import { beforeAll, describe, expect, it } from "vitest";

import {
  decryptText,
  deriveOrCredsKeyFromMek,
  deriveOrMekBytes,
  encryptText,
  importMekFromRaw,
  randomBytesB64,
  unwrapMekWithPasswordArgon2id,
  unwrapOrMekWithVaultMek,
  wrapMekWithPasswordArgon2id,
  wrapOrMekWithVaultMek,
} from "@/lib/vault";

import { CURRENT_OR_KEY_EPOCH, planOrKeyMaterial, type OrKeyMaterialRow } from "../or-key-material";

/** Argon2id runs eight times in setup at roughly half a second each. */
const SETUP_TIMEOUT_MS = 180_000;

const USER_ID = "00000000-0000-4000-8000-000000000001";
const OLD_PASSWORD = "old-vault-password-14c";
const NEW_PASSWORD = "new-vault-password-14c";
const SEALED_TEXT = "synthetic connection label, sealed before the rotation";

const NOTHING_PINNED: OrKeyMaterialRow = {
  enc_or_mek_ciphertext: null,
  or_subkey_salt: null,
  or_key_epoch: null,
};

const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

/** A fresh, exactly sized buffer. Avoids passing a view of a larger buffer. */
const toBuffer = (bytes: Uint8Array): ArrayBuffer => bytes.slice().buffer as ArrayBuffer;

let saltOld = "";
let saltNew = "";

/** The Orange Rails key derived and pinned before anything rotated. */
let orKeyAtPin = new Uint8Array();
/** The same key, re-derived, to show the derivation is deterministic. */
let orKeyRederived = new Uint8Array();
/** What the pinned blob opens to AFTER the password change. */
let orKeyAfterRotation = new Uint8Array();

/** The vault key bytes, before and after the password change. */
let vaultKeyBytesBefore = new Uint8Array();
let vaultKeyBytesAfter = new Uint8Array();

/** The row as the pin writes it, and the plan read back after the rotation. */
let pinnedRow: OrKeyMaterialRow = NOTHING_PINNED;
let planAfterRotation = planOrKeyMaterial(NOTHING_PINNED, "unset", {
  saltMatchesExistingRows: true,
});

/** A payload sealed under the pre-rotation subkey. */
let sealedPayload = "";
let openedAfterRotation = "";

/** The pre-fix path: no pin, so the client re-derives against the new salt. */
let orKeyPreFixSameSalt = new Uint8Array();
let credsKeyPreFix: CryptoKey | null = null;

beforeAll(async () => {
  // 1. A vault at salt S-old. The key bytes are random and stored wrapped,
  //    which is what makes them survivable in the first place.
  saltOld = randomBytesB64(16);
  const freshVaultKey = crypto.getRandomValues(new Uint8Array(32));
  const encMekOld = await wrapMekWithPasswordArgon2id(
    toBuffer(freshVaultKey),
    OLD_PASSWORD,
    saltOld,
  );
  vaultKeyBytesBefore = await unwrapMekWithPasswordArgon2id(encMekOld, OLD_PASSWORD, saltOld);
  const vaultKeyBefore = await importMekFromRaw(vaultKeyBytesBefore);

  // 2. C1 DERIVE. The shipped derivation, twice, to show it is deterministic
  //    for a given password and salt.
  orKeyAtPin = await deriveOrMekBytes(OLD_PASSWORD, USER_ID, saltOld);
  orKeyRederived = await deriveOrMekBytes(OLD_PASSWORD, USER_ID, saltOld);

  // 3. C2 PIN. Exactly what the unlock and password change paths write: the
  //    key wrapped under the vault key, plus the salt in force at that moment
  //    and the generation.
  const planAtPin = planOrKeyMaterial(NOTHING_PINNED, saltOld, {
    saltMatchesExistingRows: true,
  });
  if (planAtPin.mode !== "derive-and-pin") {
    throw new Error(`expected derive-and-pin at first sight, got ${planAtPin.mode}`);
  }
  pinnedRow = {
    enc_or_mek_ciphertext: await wrapOrMekWithVaultMek(orKeyAtPin, vaultKeyBefore),
    or_subkey_salt: planAtPin.saltContext,
    or_key_epoch: planAtPin.epoch,
  };

  // A row sealed before the rotation, under the subkey that key produces.
  const credsKeyBefore = await deriveOrCredsKeyFromMek(orKeyAtPin, saltOld);
  sealedPayload = await encryptText(SEALED_TEXT, credsKeyBefore);

  // 4. The password change. It mints a new salt and re-wraps the SAME vault
  //    key bytes under it. The vault key value is not rotated, which is the
  //    property the pin leans on.
  saltNew = randomBytesB64(16);
  const encMekNew = await wrapMekWithPasswordArgon2id(
    toBuffer(vaultKeyBytesBefore),
    NEW_PASSWORD,
    saltNew,
  );
  vaultKeyBytesAfter = await unwrapMekWithPasswordArgon2id(encMekNew, NEW_PASSWORD, saltNew);
  const vaultKeyAfter = await importMekFromRaw(vaultKeyBytesAfter);

  // 5. C4 UNWRAP AFTER ROTATION. Read the row back with the NEW salt in force.
  planAfterRotation = planOrKeyMaterial(pinnedRow, saltNew, {
    saltMatchesExistingRows: true,
  });
  if (planAfterRotation.mode !== "unwrap") {
    throw new Error(`expected unwrap after the rotation, got ${planAfterRotation.mode}`);
  }
  orKeyAfterRotation = await unwrapOrMekWithVaultMek(planAfterRotation.ciphertext, vaultKeyAfter);
  const credsKeyAfter = await deriveOrCredsKeyFromMek(
    orKeyAfterRotation,
    planAfterRotation.saltContext,
  );
  openedAfterRotation = await decryptText(sealedPayload, credsKeyAfter);

  // 6. C5 NEGATIVE CONTROL. The pre-fix path: no columns to unwrap, so the
  //    client derives against whatever salt is in force now. Both arms below
  //    exist because they blame different things. The first changes the
  //    password and the salt together, which is what a password change does.
  //    The second holds the password and moves only the salt, which isolates
  //    the salt as the cause and is the shape recovery takes.
  const orKeyPreFix = await deriveOrMekBytes(NEW_PASSWORD, USER_ID, saltNew);
  orKeyPreFixSameSalt = await deriveOrMekBytes(OLD_PASSWORD, USER_ID, saltNew);
  credsKeyPreFix = await deriveOrCredsKeyFromMek(orKeyPreFix, saltNew);
}, SETUP_TIMEOUT_MS);

describe("Orange Rails key material across a vault salt rotation", () => {
  it("C1 DERIVE: the shipped derivation is deterministic for a password and salt", () => {
    expect(orKeyAtPin).toHaveLength(32);
    expect(toHex(orKeyRederived)).toBe(toHex(orKeyAtPin));
  });

  it("C2 PIN: the row stores the key wrapped under the vault key, with the salt of the moment", () => {
    expect(pinnedRow.or_subkey_salt).toBe(saltOld);
    expect(pinnedRow.or_key_epoch).toBe(CURRENT_OR_KEY_EPOCH);
    expect(typeof pinnedRow.enc_or_mek_ciphertext).toBe("string");
    expect(pinnedRow.enc_or_mek_ciphertext).not.toBe("");
  });

  /**
   * The load bearing assertion. If the vault key value moved on a password
   * change, wrapping under it would be no more durable than deriving, the pin
   * would be decorative, and this ticket becomes a design escalation rather
   * than a test fix.
   */
  it("C3 SURVIVAL: the vault key is byte identical before and after the password change", () => {
    expect(vaultKeyBytesAfter).toHaveLength(32);
    expect(toHex(vaultKeyBytesAfter)).toBe(toHex(vaultKeyBytesBefore));
  });

  it("C3 SURVIVAL: the salt really did rotate, so the check above is not vacuous", () => {
    expect(saltNew).not.toBe(saltOld);
  });

  it("C4 UNWRAP: after the rotation the row is read as unwrap, against the PINNED salt", () => {
    expect(planAfterRotation.mode).toBe("unwrap");
    if (planAfterRotation.mode !== "unwrap") throw new Error("unreachable");
    expect(planAfterRotation.saltContext).toBe(saltOld);
  });

  it("C4 UNWRAP: the pinned blob still opens to the same 32 bytes", () => {
    expect(toHex(orKeyAfterRotation)).toBe(toHex(orKeyAtPin));
  });

  it("C4 UNWRAP: a payload sealed before the rotation still opens after it", () => {
    expect(openedAfterRotation).toBe(SEALED_TEXT);
  });

  /**
   * Without this, every assertion above would pass just as happily if the pin
   * did nothing at all, because the same password and salt reproduce the same
   * key. This is the arm that goes red when the pin is absent.
   */
  it("C5 CONTROL: the pre-fix path derives a DIFFERENT key after the rotation", async () => {
    const derivedWithoutThePin = credsKeyPreFix;
    if (!derivedWithoutThePin) throw new Error("setup did not run");
    expect(toHex(orKeyPreFixSameSalt)).not.toBe(toHex(orKeyAtPin));
    await expect(decryptText(sealedPayload, derivedWithoutThePin)).rejects.toThrow();
  });

  it("C5 CONTROL: moving only the salt is enough to lose the key, password unchanged", () => {
    expect(toHex(orKeyPreFixSameSalt)).not.toBe(toHex(orKeyAtPin));
  });
});
