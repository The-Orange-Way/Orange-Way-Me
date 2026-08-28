/**
 * Does the Orange Rails key-material rule actually protect real ciphertext?
 *
 * The suite next to this one, or-key-material.test.ts, covers
 * `planOrKeyMaterial` as pure logic: given these three columns, which of the
 * three modes comes back. That is necessary and it is not sufficient. Every
 * assertion in it is on a mode string, so it would stay fully green if the
 * derivation, the wrap, or the HKDF labels moved underneath it, and it can
 * never show that anything is lost when the rule is wrong.
 *
 * This file closes that gap with the real primitives: argon2id through
 * `deriveOrMekBytes`, HKDF through `deriveOrCredsKeyFromMek`, AES-GCM through
 * `encryptText` / `decryptText`, and the real `wrapOrMekWithVaultMek` /
 * `unwrapOrMekWithVaultMek`. Nothing here reimplements crypto.
 *
 * READ THE FIRST TEST BEFORE THE OTHERS. It reproduces the original loss
 * (DL-1506) rather than only checking the fix: a subkey re-derived under a
 * rotated salt refuses to open an envelope that the pre-rotation subkey opens
 * on the same bytes. A verification nobody has seen fail says nothing about
 * its own sensitivity, so the fixture demonstrates the failure it claims to
 * prevent before it claims to prevent it.
 *
 * Cost. Three argon2id derivations at 64 MiB each, roughly half a second
 * apiece. They are memoised across the whole suite rather than repeated per
 * test, which is why the fixture is a promise and not a `beforeAll`.
 */

import { describe, expect, it } from "vitest";

import {
  CURRENT_OR_KEY_EPOCH,
  planOrKeyMaterial,
  type OrKeyMaterialRow,
} from "../or-key-material";
import {
  decryptText,
  deriveOrCredsKeyFromMek,
  deriveOrMekBytes,
  encryptText,
  randomBytesB64,
  unwrapOrMekWithVaultMek,
  wrapOrMekWithVaultMek,
} from "../../vault";

/** Long enough to be a realistic vault password; nothing here depends on it. */
const PASSWORD = "correct-horse-battery-staple-7";
const USER_ID = "11111111-2222-3333-4444-555555555555";

/** Stands in for one synced Orange Rails row sealed under the creds subkey. */
const SEALED_ROW_PLAINTEXT = JSON.stringify({ label: "Chequing", txn: "2026-08-01 -42.00" });

/** Nothing pinned: the shape every account had before the pin was introduced. */
const UNPINNED_ROW: OrKeyMaterialRow = {
  enc_or_mek_ciphertext: null,
  or_subkey_salt: null,
  or_key_epoch: null,
};

interface Fixture {
  /** The vault salt in force when the row below was sealed. */
  saltS1: string;
  /** The salt after a password change or a recovery has rotated it. */
  saltS2: string;
  orMekS1: Uint8Array;
  orMekS2: Uint8Array;
  /** One Orange Rails row, sealed under the S1 creds subkey. */
  envelopeSealedAtS1: string;
  /**
   * The vault MEK. Random and wrapped rather than derived, exactly as the
   * product's own MEK is, which is the property the pin relies on: it survives
   * a password change and is recoverable from the recovery code.
   */
  vaultMek: CryptoKey;
}

let fixturePromise: Promise<Fixture> | null = null;

async function buildFixture(): Promise<Fixture> {
  const saltS1 = randomBytesB64(16);
  const saltS2 = randomBytesB64(16);
  const orMekS1 = await deriveOrMekBytes(PASSWORD, USER_ID, saltS1);
  const orMekS2 = await deriveOrMekBytes(PASSWORD, USER_ID, saltS2);
  const credsKeyS1 = await deriveOrCredsKeyFromMek(orMekS1, saltS1);
  const envelopeSealedAtS1 = await encryptText(SEALED_ROW_PLAINTEXT, credsKeyS1);
  const vaultMek = (await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
    "encrypt",
    "decrypt",
  ])) as CryptoKey;
  return { saltS1, saltS2, orMekS1, orMekS2, envelopeSealedAtS1, vaultMek };
}

/** Memoised so the argon2id cost is paid once for the whole file. */
function fixture(): Promise<Fixture> {
  if (fixturePromise === null) {
    fixturePromise = buildFixture();
  }
  return fixturePromise;
}

const SLOW = 60_000;

describe("Orange Rails key material, against real ciphertext", () => {
  it("reproduces the loss: a subkey re-derived under a rotated salt opens nothing", async () => {
    const f = await fixture();

    // The fixture is capable of SUCCESS. Without this line the refusal below
    // could equally mean the envelope was never openable by anything.
    const credsKeyS1 = await deriveOrCredsKeyFromMek(f.orMekS1, f.saltS1);
    await expect(decryptText(f.envelopeSealedAtS1, credsKeyS1)).resolves.toBe(
      SEALED_ROW_PLAINTEXT,
    );

    // What the code did before the pin existed: rotate the salt, re-derive,
    // carry on. The bytes are well formed and completely unrelated.
    expect(Array.from(f.orMekS2)).not.toEqual(Array.from(f.orMekS1));

    const credsKeyS2 = await deriveOrCredsKeyFromMek(f.orMekS2, f.saltS2);
    await expect(decryptText(f.envelopeSealedAtS1, credsKeyS2)).rejects.toThrow();
  }, SLOW);

  it("refuses instead of deriving when nothing is pinned and the salt just rotated", async () => {
    const f = await fixture();

    // This is the recovery shape: no pin, and a salt minted moments ago. The
    // test above is what "derive anyway" would actually cost the customer.
    const plan = planOrKeyMaterial(UNPINNED_ROW, f.saltS2, { saltMatchesExistingRows: false });
    expect(plan.mode).toBe("refuse");
  }, SLOW);

  it("opens a pinned row regardless of what the current salt is", async () => {
    const f = await fixture();

    const pinned: OrKeyMaterialRow = {
      enc_or_mek_ciphertext: await wrapOrMekWithVaultMek(f.orMekS1, f.vaultMek),
      or_subkey_salt: f.saltS1,
      or_key_epoch: CURRENT_OR_KEY_EPOCH,
    };

    // Current salt is S2 and the caller says the salt has moved. A pinned row
    // does not care, which is the entire point of pinning.
    const plan = planOrKeyMaterial(pinned, f.saltS2, { saltMatchesExistingRows: false });
    if (plan.mode !== "unwrap") {
      throw new Error(`expected mode "unwrap", got "${plan.mode}"`);
    }
    expect(plan.saltContext).toBe(f.saltS1);

    const orMek = await unwrapOrMekWithVaultMek(plan.ciphertext, f.vaultMek);
    expect(Array.from(orMek)).toEqual(Array.from(f.orMekS1));

    const credsKey = await deriveOrCredsKeyFromMek(orMek, plan.saltContext);
    await expect(decryptText(f.envelopeSealedAtS1, credsKey)).resolves.toBe(SEALED_ROW_PLAINTEXT);
  }, SLOW);

  it("derives the SAME key it always did on the unlock path", async () => {
    const f = await fixture();

    // The safe half of the rule. On an unlock the salt has not moved, so
    // deriving reproduces the key the existing rows were sealed under. If this
    // ever fails, the pin is not preserving value, it is minting a new key.
    const plan = planOrKeyMaterial(UNPINNED_ROW, f.saltS1, { saltMatchesExistingRows: true });
    expect(plan).toEqual({
      mode: "derive-and-pin",
      saltContext: f.saltS1,
      epoch: CURRENT_OR_KEY_EPOCH,
    });
    if (plan.mode !== "derive-and-pin") {
      throw new Error(`expected mode "derive-and-pin", got "${plan.mode}"`);
    }

    const orMek = await deriveOrMekBytes(PASSWORD, USER_ID, plan.saltContext);
    const credsKey = await deriveOrCredsKeyFromMek(orMek, plan.saltContext);
    await expect(decryptText(f.envelopeSealedAtS1, credsKey)).resolves.toBe(SEALED_ROW_PLAINTEXT);
  }, SLOW);
});
