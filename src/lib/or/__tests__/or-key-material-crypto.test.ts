/**
 * Does the pinned Orange Rails key material actually survive a kdf_salt
 * rotation? (OWM-T0391, under the P0 OWM-T0176)
 *
 * WHAT IS UNDER TEST, and what is not. The sibling suite
 * `or-key-material.test.ts` covers `planOrKeyMaterial`, which is a pure
 * decision function that holds no crypto: it answers "derive, unwrap or
 * refuse" and nothing else. It therefore cannot say whether the plan it
 * returns actually opens anything. This suite runs the real shipped
 * primitives, with no mocks and no local copies of the crypto, and asserts
 * the key-recovery property the pin design exists to provide.
 *
 * THE PROPERTY. The design (DL-1506) pins the Orange Rails MEK by WRAPPING it
 * under the vault MEK rather than deriving it from kdf_salt. That protects
 * nothing unless the vault MEK is itself byte-identical either side of a
 * password change. C3 below is that assertion, and it is the load-bearing one:
 * if it fails, the pin is decorative and every account already pinned is
 * exposed too.
 *
 * NO BROWSER, DELIBERATELY. The property is key recovery over the shipped
 * primitives. It needs no UI, no fixture account and no credentials, so it
 * runs in CI on every push instead of waiting on an end-to-end environment
 * that does not exist for authenticated flows.
 *
 * WHY THE NEGATIVE CONTROL MATTERS. C5 reproduces the PRE-FIX path in
 * process: derive again after the rotation, against the new salt. It asserts
 * that the resulting key is a different key and opens none of the rows sealed
 * before the change. Without it, this suite would pass just as happily with
 * the fix reverted, which is the exact shape of guard test that reports
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

import { CURRENT_OR_KEY_EPOCH, planOrKeyMaterial, type OrKeyMaterialRow } from "../or-key-material";

const USER_ID = "11111111-2222-3333-4444-555555555555";
const OLD_PASSWORD = "old-password-correct-horse-14c";
const NEW_PASSWORD = "new-password-battery-staple-14c";

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
  oldSalt: string;
  newSalt: string;
  encMekBefore: string;
  encMekAfter: string;
  mekBeforeRotation: Uint8Array;
  mekAfterRotation: Uint8Array;
  vaultMekBefore: CryptoKey;
  kOld: Uint8Array;
  kDerivedAfter: Uint8Array;
  pinnedRow: OrKeyMaterialRow;
  sealedPayload: string;
}

let fixture!: Fixture;

/**
 * Argon2id is deliberately expensive (64 MiB, 3 iterations), and this sequence
 * needs seven derivations. They are done once here rather than per test, so
 * the assertions below are near-instant and the cost is paid a single time.
 */
beforeAll(async () => {
  const oldSalt = randomBytesB64(16);

  // A vault as `createVault` writes one: a RANDOM MEK, wrapped under the
  // password. The MEK is not derived from the password, which is the property
  // C3 is about to depend on.
  const mekBytes = crypto.getRandomValues(new Uint8Array(32));
  const encMekBefore = await strategy.wrapMekWithPassword(
    mekBytes.buffer as ArrayBuffer,
    OLD_PASSWORD,
    oldSalt,
  );

  // Unlock, before anything rotates.
  const mekBeforeRotation = await strategy.unwrapMekWithPassword(
    encMekBefore,
    OLD_PASSWORD,
    oldSalt,
  );
  const vaultMekBefore = await importMekFromRaw(mekBeforeRotation);

  // C1 and C2: the derive-and-pin branch of `resolveOrKeyMaterial`, in the
  // order it runs there.
  const pinPlan = planOrKeyMaterial(EMPTY_ROW, oldSalt, { saltMatchesExistingRows: true });
  if (pinPlan.mode !== "derive-and-pin") {
    throw new Error(`fixture: expected derive-and-pin, got ${pinPlan.mode}`);
  }
  const kOld = await deriveOrMekBytes(OLD_PASSWORD, USER_ID, pinPlan.saltContext);
  const pinnedRow: OrKeyMaterialRow = {
    enc_or_mek_ciphertext: await wrapOrMekWithVaultMek(kOld, vaultMekBefore),
    or_subkey_salt: pinPlan.saltContext,
    or_key_epoch: pinPlan.epoch,
  };

  // A row sealed under the material as it stands before the change.
  const credsKeyOld = await deriveOrCredsKeyFromMek(kOld, pinPlan.saltContext);
  const sealedPayload = await encryptText(SEALED_PLAINTEXT, credsKeyOld);

  // The password change, in the shipped order: mint a new salt, re-wrap the
  // SAME MEK bytes under the new password, carry the OR columns across
  // untouched.
  const newSalt = randomBytesB64(16);
  const encMekAfter = await strategy.wrapMekWithPassword(
    mekBytes.buffer as ArrayBuffer,
    NEW_PASSWORD,
    newSalt,
  );
  const mekAfterRotation = await strategy.unwrapMekWithPassword(
    encMekAfter,
    NEW_PASSWORD,
    newSalt,
  );

  // The PRE-FIX path, kept for the negative control: derive again after the
  // rotation, against whatever the salt now is.
  const kDerivedAfter = await deriveOrMekBytes(NEW_PASSWORD, USER_ID, newSalt);

  fixture = {
    oldSalt,
    newSalt,
    encMekBefore,
    encMekAfter,
    mekBeforeRotation,
    mekAfterRotation,
    vaultMekBefore,
    kOld,
    kDerivedAfter,
    pinnedRow,
    sealedPayload,
  };
}, 600_000);

describe("Orange Rails key material across a kdf_salt rotation", () => {
  it("C1 DERIVE: the shipped derivation yields 32 bytes and is reproducible for the same inputs", async () => {
    expect(fixture.kOld).toHaveLength(32);
    const again = await deriveOrMekBytes(OLD_PASSWORD, USER_ID, fixture.oldSalt);
    expect(toHex(again)).toBe(toHex(fixture.kOld));
  }, 600_000);

  it("C2 PIN: the row holds wrap(K_old, vaultMEK) and records the salt it was pinned against", async () => {
    expect(fixture.pinnedRow.or_subkey_salt).toBe(fixture.oldSalt);
    expect(fixture.pinnedRow.or_key_epoch).toBe(CURRENT_OR_KEY_EPOCH);

    const unwrapped = await unwrapOrMekWithVaultMek(
      fixture.pinnedRow.enc_or_mek_ciphertext as string,
      fixture.vaultMekBefore,
    );
    expect(toHex(unwrapped)).toBe(toHex(fixture.kOld));
  });

  it("C2 PIN: what is stored is genuinely sealed, not readable by another key", async () => {
    const someoneElsesMek = await importMekFromRaw(crypto.getRandomValues(new Uint8Array(32)));
    await expect(
      unwrapOrMekWithVaultMek(fixture.pinnedRow.enc_or_mek_ciphertext as string, someoneElsesMek),
    ).rejects.toThrow();
  });

  /**
   * The load-bearing assertion of the whole design. If this ever fails, the
   * pin is decorative: wrapping under a MEK that itself moves with the
   * password protects nothing, and the ticket becomes a design escalation
   * rather than a test fix.
   */
  it("C3 MEK SURVIVAL: the vault MEK is byte-identical either side of the rotation", () => {
    expect(toHex(fixture.mekAfterRotation)).toBe(toHex(fixture.mekBeforeRotation));
  });

  it("C3 MEK SURVIVAL: and the rotation was real, not a no-op that would make C3 trivial", () => {
    expect(fixture.newSalt).not.toBe(fixture.oldSalt);
    expect(fixture.encMekAfter).not.toBe(fixture.encMekBefore);
  });

  it("C4 UNWRAP AFTER ROTATION: the pinned material still opens, and still yields K_old", async () => {
    const vaultMekAfter = await importMekFromRaw(fixture.mekAfterRotation);
    const plan = planOrKeyMaterial(fixture.pinnedRow, fixture.newSalt, {
      saltMatchesExistingRows: true,
    });
    expect(plan.mode).toBe("unwrap");
    if (plan.mode !== "unwrap") throw new Error("unreachable");

    // The PINNED salt, not the one now in force. Both halves have to be
    // pinned: the subkeys take the salt as their HKDF salt-context, so a
    // pinned MEK under a rotated salt still moves all four keys.
    expect(plan.saltContext).toBe(fixture.oldSalt);

    const recovered = await unwrapOrMekWithVaultMek(plan.ciphertext, vaultMekAfter);
    expect(toHex(recovered)).toBe(toHex(fixture.kOld));
  });

  it("C4 UNWRAP AFTER ROTATION: a payload sealed before the change still opens after it", async () => {
    const vaultMekAfter = await importMekFromRaw(fixture.mekAfterRotation);
    const plan = planOrKeyMaterial(fixture.pinnedRow, fixture.newSalt, {
      saltMatchesExistingRows: true,
    });
    if (plan.mode !== "unwrap") throw new Error("expected unwrap");

    const recovered = await unwrapOrMekWithVaultMek(plan.ciphertext, vaultMekAfter);
    const credsKey = await deriveOrCredsKeyFromMek(recovered, plan.saltContext);
    await expect(decryptText(fixture.sealedPayload, credsKey)).resolves.toBe(SEALED_PLAINTEXT);
  });

  /**
   * Recovery mints a new salt before it asks for key material, so it passes
   * `saltMatchesExistingRows: false`. A pinned account must still come back,
   * or the fix trades a silent loss for a loud one.
   */
  it("C4 UNWRAP AFTER ROTATION: a pinned account recovers too, not only an unlock", async () => {
    const vaultMekAfter = await importMekFromRaw(fixture.mekAfterRotation);
    const plan = planOrKeyMaterial(fixture.pinnedRow, fixture.newSalt, {
      saltMatchesExistingRows: false,
    });
    if (plan.mode !== "unwrap") throw new Error("expected unwrap");

    const recovered = await unwrapOrMekWithVaultMek(plan.ciphertext, vaultMekAfter);
    const credsKey = await deriveOrCredsKeyFromMek(recovered, plan.saltContext);
    await expect(decryptText(fixture.sealedPayload, credsKey)).resolves.toBe(SEALED_PLAINTEXT);
  });

  /**
   * The pre-fix path, run in process. This is what the code did before the
   * pin existed: derive again, against whatever the salt now is. It produces
   * a well formed 32-byte key and reports success, which is exactly why the
   * loss was silent.
   */
  it("C5 NEGATIVE CONTROL: deriving after the rotation yields a DIFFERENT key", () => {
    expect(fixture.kDerivedAfter).toHaveLength(32);
    expect(toHex(fixture.kDerivedAfter)).not.toBe(toHex(fixture.kOld));
  });

  it("C5 NEGATIVE CONTROL: and that key opens none of the rows sealed before the rotation", async () => {
    const credsKeyWrong = await deriveOrCredsKeyFromMek(fixture.kDerivedAfter, fixture.newSalt);
    await expect(decryptText(fixture.sealedPayload, credsKeyWrong)).rejects.toThrow();
  });

  /**
   * Pinning the MEK alone would not have been enough. Even the CORRECT MEK
   * bytes, run through HKDF under the rotated salt, produce a subkey that
   * opens nothing. This is why `or_subkey_salt` is stored alongside the
   * sealed key rather than read from the row's current kdf_salt.
   */
  it("C5 NEGATIVE CONTROL: the right MEK under the rotated salt still opens nothing", async () => {
    const credsKeyWrongSalt = await deriveOrCredsKeyFromMek(fixture.kOld, fixture.newSalt);
    await expect(decryptText(fixture.sealedPayload, credsKeyWrongSalt)).rejects.toThrow();
  });

  /**
   * The fix's own answer to the same situation. An account that was never
   * pinned and has just had its salt rotated cannot reproduce the old key,
   * and nothing can repair it, so the only honest outcome is a refusal.
   * Deriving here is what made the loss silent.
   */
  it("C5 NEGATIVE CONTROL: with nothing pinned and the salt rotated, the fix refuses", () => {
    const plan = planOrKeyMaterial(EMPTY_ROW, fixture.newSalt, {
      saltMatchesExistingRows: false,
    });
    expect(plan.mode).toBe("refuse");
  });
});
