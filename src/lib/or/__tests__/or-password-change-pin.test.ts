/**
 * Does a vault password change pin the OLD salt? (DEV-0044 follow up)
 *
 * WHAT IS UNDER TEST. `computeOrPinForPasswordChange` decides what the three
 * Orange Rails columns become while a password change is in flight. The
 * material must be pinned against the salt the already sealed rows were sealed
 * under, which is the salt still on the row, and NOT against the new salt the
 * change is about to mint.
 *
 * WHY THE ASSERTION IS ON A VALUE AND NOT ON CALL ORDER. Inline, this rested on
 * statement order inside changeVaultPassword: plan first, mint second. Nothing
 * mechanical could see that ordering, so an edit that reversed it would pin
 * material derived from the new salt while asserting it matched rows sealed
 * under the old one, producing a well formed key that opens nothing and reports
 * success. Asserting on order would only re-describe the hazard. Asserting on
 * the value, against a helper that reads the salt off the row and takes no salt
 * argument, is what makes it stay fixed.
 *
 * NOT VACUOUS, BY CONSTRUCTION. The last two cases reproduce the pre fix
 * behaviour in process, deriving against the post rotation salt, and assert
 * that the result opens none of the rows sealed before the change. Without them
 * this suite would pass just as happily with the pin removed, which is the
 * exact shape of guard test that reports success while covering nothing.
 *
 * NO BROWSER, DELIBERATELY. This is a key recovery property over the shipped
 * primitives. It needs no UI, no fixture account and no credentials, so it runs
 * in CI on every push.
 *
 * ZKA. Every input here is synthetic. No plaintext, no address, no txid and no
 * customer material is involved.
 */

import { beforeAll, describe, expect, it, vi } from "vitest";

import {
  decryptText,
  deriveOrCredsKeyFromMek,
  deriveOrMekBytes,
  encryptText,
  importMekFromRaw,
  randomBytesB64,
  unwrapOrMekWithVaultMek,
} from "@/lib/vault";

import { CURRENT_OR_KEY_EPOCH } from "../or-key-material";
import {
  computeOrPinForPasswordChange,
  type OrPasswordChangeRow,
  type OrPinColumns,
} from "../or-password-change-pin";

const USER_ID = "11111111-2222-3333-4444-555555555555";
const PW_OLD = "old-password-correct-horse-14c";

/** Stands in for a row this account synced BEFORE the password change. */
const SEALED_PLAINTEXT = "orange-rails-payload-sealed-before-the-password-change";

const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

interface Fixture {
  saltOld: string;
  saltNew: string;
  mekRaw: Uint8Array;
  vaultMek: CryptoKey;
  kOld: Uint8Array;
  kWrong: Uint8Array;
  sealed: string;
  pinned: OrPinColumns;
}

let fixture!: Fixture;

/**
 * Argon2id is deliberately expensive (64 MiB, 3 iterations) and this sequence
 * needs three derivations. They are done once here, so the assertions below are
 * near instant and the cost is paid a single time.
 */
beforeAll(async () => {
  const saltOld = randomBytesB64(16);
  const saltNew = randomBytesB64(16);

  // A vault as `createVault` writes one: a random key held in memory, not one
  // derived from the password. That is why the pin survives the change.
  const mekRaw = crypto.getRandomValues(new Uint8Array(32));
  const vaultMek = await importMekFromRaw(mekRaw);

  // The material as it stands before the change, and a row sealed under it.
  const kOld = await deriveOrMekBytes(PW_OLD, USER_ID, saltOld);
  const credsOld = await deriveOrCredsKeyFromMek(kOld, saltOld);
  const sealed = await encryptText(SEALED_PLAINTEXT, credsOld);

  // The pre fix behaviour, kept as the negative control: derive against the
  // salt the change is about to mint.
  const kWrong = await deriveOrMekBytes(PW_OLD, USER_ID, saltNew);

  const unpinned: OrPasswordChangeRow = {
    kdf_salt: saltOld,
    enc_or_mek_ciphertext: null,
    or_subkey_salt: null,
    or_key_epoch: null,
  };

  const pinned = await computeOrPinForPasswordChange(unpinned, PW_OLD, USER_ID, mekRaw);
  if (pinned === null) {
    throw new Error("fixture: expected the unpinned row to produce pin columns");
  }

  fixture = { saltOld, saltNew, mekRaw, vaultMek, kOld, kWrong, sealed, pinned };
}, 600_000);

describe("computeOrPinForPasswordChange", () => {
  it("pins the salt that is ON THE ROW, not one minted during the change", () => {
    expect(fixture.pinned.or_subkey_salt).toBe(fixture.saltOld);
    expect(fixture.pinned.or_subkey_salt).not.toBe(fixture.saltNew);
    expect(fixture.pinned.or_key_epoch).toBe(CURRENT_OR_KEY_EPOCH);
  });

  it("seals the key the old salt produces, and seals it to the vault key", async () => {
    const recovered = await unwrapOrMekWithVaultMek(
      fixture.pinned.enc_or_mek_ciphertext,
      fixture.vaultMek,
    );
    expect(toHex(recovered)).toBe(toHex(fixture.kOld));
  });

  it("what it writes still opens a row sealed before the change", async () => {
    const recovered = await unwrapOrMekWithVaultMek(
      fixture.pinned.enc_or_mek_ciphertext,
      fixture.vaultMek,
    );
    const creds = await deriveOrCredsKeyFromMek(recovered, fixture.pinned.or_subkey_salt);
    await expect(decryptText(fixture.sealed, creds)).resolves.toBe(SEALED_PLAINTEXT);
  });

  it("what it writes is genuinely sealed, not open to another key", async () => {
    const otherMek = await importMekFromRaw(crypto.getRandomValues(new Uint8Array(32)));
    await expect(
      unwrapOrMekWithVaultMek(fixture.pinned.enc_or_mek_ciphertext, otherMek),
    ).rejects.toThrow();
  });

  it("writes nothing for a row that is already pinned", async () => {
    const alreadyPinned: OrPasswordChangeRow = {
      // The salt has already moved on this row. The pin does not move with it,
      // which is the whole point of pinning it.
      kdf_salt: fixture.saltNew,
      enc_or_mek_ciphertext: fixture.pinned.enc_or_mek_ciphertext,
      or_subkey_salt: fixture.pinned.or_subkey_salt,
      or_key_epoch: fixture.pinned.or_key_epoch,
    };
    await expect(
      computeOrPinForPasswordChange(alreadyPinned, PW_OLD, USER_ID, fixture.mekRaw),
    ).resolves.toBeNull();
  });

  it("writes nothing, and logs a reason only, for a half stored row", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const halfStored: OrPasswordChangeRow = {
        kdf_salt: fixture.saltOld,
        enc_or_mek_ciphertext: null,
        or_subkey_salt: fixture.saltOld,
        or_key_epoch: CURRENT_OR_KEY_EPOCH,
      };
      await expect(
        computeOrPinForPasswordChange(halfStored, PW_OLD, USER_ID, fixture.mekRaw),
      ).resolves.toBeNull();
      expect(warn).toHaveBeenCalledTimes(1);

      // A refusal says why and nothing more. No password, no key material and
      // no ciphertext may reach a log line.
      const logged = warn.mock.calls[0].map(String).join(" ");
      expect(logged).not.toContain(PW_OLD);
      expect(logged).not.toContain(fixture.pinned.enc_or_mek_ciphertext);
      expect(logged).not.toContain(toHex(fixture.kOld));
    } finally {
      warn.mockRestore();
    }
  });

  /**
   * The pre fix path, run in process. This is what the code did when the plan
   * was computed after the new salt was minted: a well formed 32 byte key that
   * reports success, which is exactly why the loss was silent.
   */
  it("CONTROL: deriving against the post rotation salt yields a DIFFERENT key", () => {
    expect(fixture.kWrong).toHaveLength(32);
    expect(toHex(fixture.kWrong)).not.toBe(toHex(fixture.kOld));
  });

  it("CONTROL: and that key opens none of the rows sealed before the change", async () => {
    const creds = await deriveOrCredsKeyFromMek(fixture.kWrong, fixture.saltNew);
    await expect(decryptText(fixture.sealed, creds)).rejects.toThrow();
  });

  /**
   * Pinning the key alone would not have been enough. Even the CORRECT key
   * bytes, run through HKDF under the rotated salt, produce a subkey that opens
   * nothing. That is why the salt is pinned alongside the sealed key.
   */
  it("CONTROL: the right key under the rotated salt opens nothing", async () => {
    const creds = await deriveOrCredsKeyFromMek(fixture.kOld, fixture.saltNew);
    await expect(decryptText(fixture.sealed, creds)).rejects.toThrow();
  });
});
