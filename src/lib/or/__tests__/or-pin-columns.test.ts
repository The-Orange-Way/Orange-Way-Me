/**
 * The Orange Rails pin must be computed against the PRE-rotation vault salt.
 *
 * WHAT IS UNDER TEST. `computeOrPinColumns` is the step a vault password
 * change runs before it mints a new `kdf_salt`. The four Orange Rails subkeys
 * are derived with the salt as HKDF salt-context, so material pinned against
 * the NEW salt would be a well formed key that opens none of the rows the
 * account has already sealed, while every screen reports success. That is the
 * defect DL-1506 exists to remove, and this suite is what keeps it removed.
 *
 * WHY THE ASSERTIONS ARE ON VALUES. The correctness of the password change
 * used to rest on one invisible property: the pin was computed before the new
 * salt was minted. Nothing in the type system, the linter or CI could see it.
 * Asserting on mock call order would lock the arrangement of the code rather
 * than its result, break on harmless edits, and eventually be deleted. So
 * every assertion here is about a value that reaches the update payload.
 *
 * WHY THERE IS A NEGATIVE CONTROL. A guard that cannot fail is
 * indistinguishable from no guard. The control below reproduces the fault in
 * process, by handing the helper a row that already carries a rotated salt,
 * and asserts the material it produces opens nothing.
 *
 * NO MOCKED CRYPTO. Real Argon2id, real HKDF, real AES-GCM, through the
 * shipped functions. The sibling suite `or-key-material-crypto.test.ts`
 * already proves those run in this repository's node test environment.
 *
 * ZKA. Every input is synthetic. No plaintext, no address, no txid, no
 * wallet-identifying value and no customer material is involved.
 */

import { beforeAll, describe, expect, it, vi } from "vitest";

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
} from "@/lib/vault";

import { CURRENT_OR_KEY_EPOCH } from "../or-key-material";
import { computeOrPinColumns } from "../or-pin-columns";
import type { OrPinColumns, OrPinSourceRow } from "../or-pin-columns";

const USER_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const PASSWORD = "current-vault-password-correct-horse";

/** Stands in for a row this account sealed BEFORE the password change. */
const SEALED_PLAINTEXT = "orange-rails-payload-sealed-before-the-password-change";

/** The wrapper every vault written today uses. Read, not assumed. */
const strategy = KEY_DERIVATION_STRATEGIES[CURRENT_VAULT_KEY_VERSION];

const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

interface Fixture {
  /** The salt on the row, the one existing sealed rows were written under. */
  saltOld: string;
  /** The salt a password change would mint. The helper must never see it. */
  saltNew: string;
  mekBytes: Uint8Array;
  vaultMek: CryptoKey;
  /** The Orange Rails MEK the account's existing rows were sealed under. */
  kOld: Uint8Array;
  sealed: string;
  unpinned: OrPinSourceRow;
  pinned: OrPinSourceRow;
  columns: OrPinColumns;
}

let f!: Fixture;

/**
 * Argon2id is deliberately expensive, and this fixture needs several
 * derivations. They are paid once here so the assertions below are instant.
 */
beforeAll(async () => {
  const saltOld = randomBytesB64(16);
  const saltNew = randomBytesB64(16);

  // A vault as createVault writes one: a RANDOM key, wrapped under the
  // password rather than derived from it. That is why the MEK survives a
  // password change, which is what the pin design rests on.
  const mekRaw = crypto.getRandomValues(new Uint8Array(32));
  const encMek = await strategy.wrapMekWithPassword(mekRaw.buffer as ArrayBuffer, PASSWORD, saltOld);
  const mekBytes = await strategy.unwrapMekWithPassword(encMek, PASSWORD, saltOld);
  const vaultMek = await importMekFromRaw(mekBytes);

  // The account has already synced: a row sealed under the key that the
  // password and the CURRENT salt produce.
  const kOld = await deriveOrMekBytes(PASSWORD, USER_ID, saltOld);
  const credsOld = await deriveOrCredsKeyFromMek(kOld, saltOld);
  const sealed = await encryptText(SEALED_PLAINTEXT, credsOld);

  const unpinned: OrPinSourceRow = {
    kdf_salt: saltOld,
    enc_or_mek_ciphertext: null,
    or_subkey_salt: null,
    or_key_epoch: null,
  };

  const columns = await computeOrPinColumns({
    row: unpinned,
    password: PASSWORD,
    userId: USER_ID,
    mekBytes,
  });
  if (!columns) {
    throw new Error("expected pin columns for a row with nothing pinned yet");
  }

  const pinned: OrPinSourceRow = {
    kdf_salt: saltOld,
    enc_or_mek_ciphertext: columns.enc_or_mek_ciphertext,
    or_subkey_salt: columns.or_subkey_salt,
    or_key_epoch: columns.or_key_epoch,
  };

  f = { saltOld, saltNew, mekBytes, vaultMek, kOld, sealed, unpinned, pinned, columns };
}, 180_000);

describe("computeOrPinColumns", () => {
  it("pins the salt the row already carries", () => {
    expect(f.columns.or_subkey_salt).toBe(f.saltOld);
    expect(f.columns.or_subkey_salt).not.toBe(f.saltNew);
    expect(f.columns.or_key_epoch).toBe(CURRENT_OR_KEY_EPOCH);
  });

  it("takes no salt argument, so a rotated salt cannot be handed to it", () => {
    // One parameter, the input object. If someone adds a salt argument this
    // goes red, which is the point: the ordering hazard would be back.
    expect(computeOrPinColumns.length).toBe(1);
  });

  it("pins material that still opens a row sealed before the password change", async () => {
    const recovered = await unwrapOrMekWithVaultMek(f.columns.enc_or_mek_ciphertext, f.vaultMek);
    expect(toHex(recovered)).toBe(toHex(f.kOld));

    const creds = await deriveOrCredsKeyFromMek(recovered, f.columns.or_subkey_salt);
    await expect(decryptText(f.sealed, creds)).resolves.toBe(SEALED_PLAINTEXT);
  });

  it("NEGATIVE CONTROL: pinning against a rotated salt produces a key that opens nothing", async () => {
    // The fault this helper makes unrepresentable, reproduced by handing it a
    // row that already carries the rotated salt. Without this the suite would
    // pass just as happily with the fix reverted.
    const rotatedFirst: OrPinSourceRow = { ...f.unpinned, kdf_salt: f.saltNew };
    const wrong = await computeOrPinColumns({
      row: rotatedFirst,
      password: PASSWORD,
      userId: USER_ID,
      mekBytes: f.mekBytes,
    });
    if (!wrong) {
      throw new Error("expected pin columns for a row with nothing pinned yet");
    }

    expect(wrong.or_subkey_salt).toBe(f.saltNew);
    const recovered = await unwrapOrMekWithVaultMek(wrong.enc_or_mek_ciphertext, f.vaultMek);
    expect(toHex(recovered)).not.toBe(toHex(f.kOld));

    const creds = await deriveOrCredsKeyFromMek(recovered, wrong.or_subkey_salt);
    await expect(decryptText(f.sealed, creds)).rejects.toThrow();
  }, 180_000);

  it("writes no OR column for a row that is already pinned", async () => {
    await expect(
      computeOrPinColumns({
        row: f.pinned,
        password: PASSWORD,
        userId: USER_ID,
        mekBytes: f.mekBytes,
      }),
    ).resolves.toBeNull();
  });

  it("refuses a half stored row, writes no column, and logs the reason only", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const halfStored: OrPinSourceRow = { ...f.unpinned, or_subkey_salt: f.saltOld };
      await expect(
        computeOrPinColumns({
          row: halfStored,
          password: PASSWORD,
          userId: USER_ID,
          mekBytes: f.mekBytes,
        }),
      ).resolves.toBeNull();

      expect(warn).toHaveBeenCalledTimes(1);
      const logged = (warn.mock.calls[0] ?? []).map((arg) => String(arg)).join(" ");
      expect(logged).not.toContain(f.saltOld);
      expect(logged).not.toContain(f.columns.enc_or_mek_ciphertext);
    } finally {
      warn.mockRestore();
    }
  });
});
