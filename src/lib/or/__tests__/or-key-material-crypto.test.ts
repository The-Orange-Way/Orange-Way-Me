/**
 * Does the pinned Orange Rails key material survive a kdf_salt rotation?
 *
 * WHAT IS UNDER TEST, and what is not. The sibling suite
 * `or-key-material.test.ts` covers `planOrKeyMaterial`, a pure decision
 * function that holds no crypto: it answers "derive, unwrap or refuse" and
 * nothing else, so it cannot say whether the plan it returns actually opens
 * anything. This suite runs the real shipped primitives, with no mocks and no
 * local copies of the crypto, and asserts the key-recovery property the pin
 * design exists to provide.
 *
 * THE PROPERTY. The design (DL-1506) pins the Orange Rails key material by
 * WRAPPING it under the vault MEK rather than deriving it from kdf_salt. That
 * protects nothing unless the vault MEK is itself byte-identical either side
 * of a password change. C3 below is that assertion and it is the load-bearing
 * one: if it fails the pin is decorative, and every account already pinned is
 * exposed too.
 *
 * NO BROWSER, DELIBERATELY. The property is key recovery over the shipped
 * primitives. It needs no UI, no fixture account and no credentials, so it
 * runs in CI on every push instead of waiting on an end-to-end environment
 * that does not exist for authenticated flows.
 *
 * WHY THE NEGATIVE CONTROL MATTERS. C5 reproduces the pre-fix path in
 * process: derive again after the rotation, against the new salt. It asserts
 * that the result is a different key and that it opens none of the rows
 * sealed before the change. Without it this suite would pass just as happily
 * with the fix reverted, which is the exact shape of guard test that reports
 * success while covering nothing.
 *
 * ZKA. Every input here is synthetic. No plaintext, no address, no txid, no
 * wallet-identifying value and no customer material is involved.
 */

import { beforeAll, describe, expect, it } from "vitest";

import {
  CURRENT_VAULT_KEY_VERSION,
  KEY_DERIVATION_STRATEGIES,
  decryptText,
  deriveOrCredsKeyFromMek,
  deriveOrMekBytes,
  encryptText,
  importMekFromRaw,
  randomBytesB64,
  unwrapOrMekWithVaultMek,
  wrapOrMekWithVaultMek,
} from "@/lib/vault";

import { CURRENT_OR_KEY_EPOCH, planOrKeyMaterial } from "../or-key-material";
import type { OrKeyMaterialRow } from "../or-key-material";

const USER_ID = "11111111-2222-3333-4444-555555555555";
const PW_OLD = "old-password-correct-horse-14c";
const PW_NEW = "new-password-battery-staple-14c";

/** Stands in for a row an account synced BEFORE anything rotated. */
const SEALED_PLAINTEXT = "orange-rails-payload-sealed-before-the-rotation";

const EMPTY_ROW: OrKeyMaterialRow = {
  enc_or_mek_ciphertext: null,
  or_subkey_salt: null,
  or_key_epoch: null,
};

/** The wrapper every vault written today uses. Read, not assumed. */
const strategy = KEY_DERIVATION_STRATEGIES[CURRENT_VAULT_KEY_VERSION];

const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

interface Fixture {
  saltOld: string;
  saltNew: string;
  encBefore: string;
  encAfter: string;
  mekBefore: Uint8Array;
  mekAfter: Uint8Array;
  vaultMekBefore: CryptoKey;
  kOld: Uint8Array;
  kOldAgain: Uint8Array;
  kAfter: Uint8Array;
  pinned: OrKeyMaterialRow;
  sealed: string;
}

let fixture!: Fixture;

/**
 * Open the row sealed before the rotation, going through the resolver's
 * unwrap branch exactly as the app does.
 *
 * `saltMatchesExistingRows` is the caller's statement, not a detail: an
 * unlock passes true and recovery passes false, and a pinned account has to
 * come back either way or the fix trades a silent loss for a loud one.
 */
async function openSealedAfterRotation(saltMatches: boolean): Promise<string> {
  const vaultMekAfter = await importMekFromRaw(fixture.mekAfter);
  const opts = { saltMatchesExistingRows: saltMatches };
  const plan = planOrKeyMaterial(fixture.pinned, fixture.saltNew, opts);
  if (plan.mode !== "unwrap") {
    throw new Error(`expected unwrap, got ${plan.mode}`);
  }
  const recovered = await unwrapOrMekWithVaultMek(plan.ciphertext, vaultMekAfter);
  const creds = await deriveOrCredsKeyFromMek(recovered, plan.saltContext);
  return decryptText(fixture.sealed, creds);
}

/**
 * Argon2id is deliberately expensive (64 MiB, 3 iterations) and this sequence
 * needs seven derivations. They are done once here rather than per test, so
 * the assertions below are near-instant and the cost is paid a single time.
 */
beforeAll(async () => {
  const saltOld = randomBytesB64(16);

  // A vault as `createVault` writes one: a RANDOM key, wrapped under the
  // password rather than derived from it. That is the property C3 depends on.
  const mekRaw = crypto.getRandomValues(new Uint8Array(32));
  const wrapMek = (pw: string, salt: string) =>
    strategy.wrapMekWithPassword(mekRaw.buffer as ArrayBuffer, pw, salt);
  const unwrapMek = (ct: string, pw: string, salt: string) =>
    strategy.unwrapMekWithPassword(ct, pw, salt);

  const encBefore = await wrapMek(PW_OLD, saltOld);
  const mekBefore = await unwrapMek(encBefore, PW_OLD, saltOld);
  const vaultMekBefore = await importMekFromRaw(mekBefore);

  // C1 and C2: the derive-and-pin branch, in the order the resolver runs it.
  const pinOpts = { saltMatchesExistingRows: true };
  const pinPlan = planOrKeyMaterial(EMPTY_ROW, saltOld, pinOpts);
  if (pinPlan.mode !== "derive-and-pin") {
    throw new Error(`fixture: expected derive-and-pin, got ${pinPlan.mode}`);
  }
  const kOld = await deriveOrMekBytes(PW_OLD, USER_ID, pinPlan.saltContext);
  const kOldAgain = await deriveOrMekBytes(PW_OLD, USER_ID, pinPlan.saltContext);
  const pinned: OrKeyMaterialRow = {
    enc_or_mek_ciphertext: await wrapOrMekWithVaultMek(kOld, vaultMekBefore),
    or_subkey_salt: pinPlan.saltContext,
    or_key_epoch: pinPlan.epoch,
  };

  // A row sealed under the material as it stands before the change.
  const credsOld = await deriveOrCredsKeyFromMek(kOld, pinPlan.saltContext);
  const sealed = await encryptText(SEALED_PLAINTEXT, credsOld);

  // The password change, in the shipped order: mint a new salt, re-wrap the
  // SAME key bytes under the new password, carry the pinned columns across
  // untouched.
  const saltNew = randomBytesB64(16);
  const encAfter = await wrapMek(PW_NEW, saltNew);
  const mekAfter = await unwrapMek(encAfter, PW_NEW, saltNew);

  // The pre-fix path, kept for the negative control: derive again after the
  // rotation, against whatever the salt now is.
  const kAfter = await deriveOrMekBytes(PW_NEW, USER_ID, saltNew);

  fixture = {
    saltOld,
    saltNew,
    encBefore,
    encAfter,
    mekBefore,
    mekAfter,
    vaultMekBefore,
    kOld,
    kOldAgain,
    kAfter,
    pinned,
    sealed,
  };
}, 600_000);

describe("Orange Rails key material across a kdf_salt rotation", () => {
  it("C1 DERIVE: the shipped derivation is 32 bytes and reproducible", () => {
    expect(fixture.kOld).toHaveLength(32);
    expect(toHex(fixture.kOldAgain)).toBe(toHex(fixture.kOld));
  });

  it("C2 PIN: the row holds the sealed key and the salt it was pinned to", async () => {
    expect(fixture.pinned.or_subkey_salt).toBe(fixture.saltOld);
    expect(fixture.pinned.or_key_epoch).toBe(CURRENT_OR_KEY_EPOCH);

    const ct = fixture.pinned.enc_or_mek_ciphertext as string;
    const unwrapped = await unwrapOrMekWithVaultMek(ct, fixture.vaultMekBefore);
    expect(toHex(unwrapped)).toBe(toHex(fixture.kOld));
  });

  it("C2 PIN: what is stored is genuinely sealed, not open to another key", async () => {
    const otherMek = await importMekFromRaw(crypto.getRandomValues(new Uint8Array(32)));
    const ct = fixture.pinned.enc_or_mek_ciphertext as string;
    await expect(unwrapOrMekWithVaultMek(ct, otherMek)).rejects.toThrow();
  });

  /**
   * The load-bearing assertion of the whole design. If this ever fails the
   * pin is decorative: wrapping under a key that itself moves with the
   * password protects nothing, and the ticket becomes a design escalation
   * rather than a test fix.
   */
  it("C3 SURVIVAL: the vault key is byte-identical across the rotation", () => {
    expect(toHex(fixture.mekAfter)).toBe(toHex(fixture.mekBefore));
  });

  it("C3 SURVIVAL: and the rotation was real, not a no-op", () => {
    expect(fixture.saltNew).not.toBe(fixture.saltOld);
    expect(fixture.encAfter).not.toBe(fixture.encBefore);
  });

  it("C4 UNWRAP: the pinned material still opens after the rotation", async () => {
    const vaultMekAfter = await importMekFromRaw(fixture.mekAfter);
    const opts = { saltMatchesExistingRows: true };
    const plan = planOrKeyMaterial(fixture.pinned, fixture.saltNew, opts);
    expect(plan.mode).toBe("unwrap");
    if (plan.mode !== "unwrap") throw new Error("unreachable");

    // The PINNED salt, not the one now in force. Both halves have to be
    // pinned: the subkeys take the salt as their HKDF salt context, so a
    // pinned key under a rotated salt still moves all four subkeys.
    expect(plan.saltContext).toBe(fixture.saltOld);

    const recovered = await unwrapOrMekWithVaultMek(plan.ciphertext, vaultMekAfter);
    expect(toHex(recovered)).toBe(toHex(fixture.kOld));
  });

  it("C4 UNWRAP: a payload sealed before the change still opens after it", async () => {
    await expect(openSealedAfterRotation(true)).resolves.toBe(SEALED_PLAINTEXT);
  });

  it("C4 UNWRAP: a pinned account recovers too, not only an unlock", async () => {
    await expect(openSealedAfterRotation(false)).resolves.toBe(SEALED_PLAINTEXT);
  });

  /**
   * The pre-fix path, run in process. This is what the code did before the
   * pin existed: derive again, against whatever the salt now is. It produces
   * a well formed 32-byte key and reports success, which is exactly why the
   * loss was silent.
   */
  it("C5 CONTROL: deriving after the rotation yields a DIFFERENT key", () => {
    expect(fixture.kAfter).toHaveLength(32);
    expect(toHex(fixture.kAfter)).not.toBe(toHex(fixture.kOld));
  });

  it("C5 CONTROL: and that key opens none of the rows sealed before it", async () => {
    const creds = await deriveOrCredsKeyFromMek(fixture.kAfter, fixture.saltNew);
    await expect(decryptText(fixture.sealed, creds)).rejects.toThrow();
  });

  /**
   * Pinning the key alone would not have been enough. Even the CORRECT key
   * bytes, run through HKDF under the rotated salt, produce a subkey that
   * opens nothing. That is why `or_subkey_salt` is stored alongside the
   * sealed key rather than read from the row's current kdf_salt.
   */
  it("C5 CONTROL: the right key under the rotated salt opens nothing", async () => {
    const creds = await deriveOrCredsKeyFromMek(fixture.kOld, fixture.saltNew);
    await expect(decryptText(fixture.sealed, creds)).rejects.toThrow();
  });

  /**
   * The fix's own answer to the same situation. An account that was never
   * pinned and has just had its salt rotated cannot reproduce the old key,
   * and nothing can repair it, so the only honest outcome is a refusal.
   */
  it("C5 CONTROL: with nothing pinned and the salt rotated, it refuses", () => {
    const opts = { saltMatchesExistingRows: false };
    const plan = planOrKeyMaterial(EMPTY_ROW, fixture.saltNew, opts);
    expect(plan.mode).toBe("refuse");
  });
});
