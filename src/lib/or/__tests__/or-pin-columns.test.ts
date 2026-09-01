/**
 * Does the Orange Rails pin record the salt the existing rows were sealed
 * under, or whatever salt happens to be in play when it runs?
 *
 * WHAT IS UNDER TEST. `computeOrPinColumns`, the helper extracted out of
 * `changeVaultPassword`. During a password change the pin must be computed
 * against the PRE rotation `kdf_salt`, because that is the salt the four
 * Orange Rails subkeys were established against. Pinning anything else
 * produces a well formed key that opens none of the customer's already synced
 * rows, reports success, and shows nothing on screen to say so.
 *
 * WHY THE ASSERTIONS ARE ABOUT VALUES. An earlier shape of this test asserted
 * that the plan ran before the salt was minted. That kind of assertion breaks
 * on harmless edits and gets deleted. These assertions say what must be TRUE
 * of the columns that get written, so they hold however the code is arranged
 * and fail the moment the pin moves off the old salt.
 *
 * THE NEGATIVE CONTROL IS IN THE SUITE, not only in a CI run. The key derived
 * against a different salt is computed here and asserted to be different from
 * the one that got sealed. Without that, this file would pass just as happily
 * against a helper that pinned the wrong salt in a way that merely looked
 * self consistent.
 *
 * ZKA. Every input is synthetic. No plaintext, no address, no txid, no wallet
 * identifying value and no customer material is involved.
 */

import { beforeAll, describe, expect, it } from "vitest";

import {
  deriveOrMekBytes,
  importMekFromRaw,
  randomBytesB64,
  unwrapOrMekWithVaultMek,
} from "@/lib/vault";

import { CURRENT_OR_KEY_EPOCH } from "../or-key-material";
import { computeOrPinColumns, type OrPinSourceRow } from "../or-pin-columns";

const USER_ID = "11111111-2222-3333-4444-555555555555";
const PASSWORD = "old-password-correct-horse-14c";

const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

/** A row for an account that has never pinned: all three OR columns null. */
const unpinnedRow = (kdfSalt: string): OrPinSourceRow => ({
  kdf_salt: kdfSalt,
  enc_or_mek_ciphertext: null,
  or_subkey_salt: null,
  or_key_epoch: null,
});

interface Fixture {
  saltOld: string;
  saltNew: string;
  /** Raw vault MEK bytes, as `mekBytesRef.current` holds them. */
  mekBytes: Uint8Array;
  /** What the pin MUST contain: derived against the salt on the row. */
  kAgainstOld: Uint8Array;
  /** The pre fix outcome: derived against a salt minted by the change. */
  kAgainstNew: Uint8Array;
  /** The columns the helper actually produced for the unpinned row. */
  columns: Awaited<ReturnType<typeof computeOrPinColumns>>;
}

let fixture!: Fixture;

/**
 * Argon2id is deliberately expensive, so the three derivations this suite
 * needs are paid once here rather than per test.
 */
beforeAll(async () => {
  const saltOld = randomBytesB64(16);
  const saltNew = randomBytesB64(16);

  // A vault MEK as `createVault` writes one: random, wrapped rather than
  // derived, which is why it is unchanged by a password change.
  const mekBytes = crypto.getRandomValues(new Uint8Array(32));

  const kAgainstOld = await deriveOrMekBytes(PASSWORD, USER_ID, saltOld);
  const kAgainstNew = await deriveOrMekBytes(PASSWORD, USER_ID, saltNew);

  const columns = await computeOrPinColumns({
    row: unpinnedRow(saltOld),
    password: PASSWORD,
    userId: USER_ID,
    mekBytes,
  });

  fixture = { saltOld, saltNew, mekBytes, kAgainstOld, kAgainstNew, columns };
}, 120_000);

describe("computeOrPinColumns", () => {
  it("pins the salt already on the row, not one minted during the change", () => {
    expect(fixture.columns).not.toBeNull();
    expect(fixture.columns?.or_subkey_salt).toBe(fixture.saltOld);
    expect(fixture.columns?.or_subkey_salt).not.toBe(fixture.saltNew);
    expect(fixture.columns?.or_key_epoch).toBe(CURRENT_OR_KEY_EPOCH);
  });

  it("seals the key derived against the pre rotation salt, not merely labels it", async () => {
    // The label alone is not enough. Open what was sealed and compare bytes.
    const vaultMek = await importMekFromRaw(fixture.mekBytes);
    const sealedKey = await unwrapOrMekWithVaultMek(
      fixture.columns?.enc_or_mek_ciphertext ?? "",
      vaultMek,
    );

    expect(toHex(sealedKey)).toBe(toHex(fixture.kAgainstOld));
    // The negative control. Deriving against a salt minted by the password
    // change gives a different 32 bytes, which is the whole defect.
    expect(toHex(sealedKey)).not.toBe(toHex(fixture.kAgainstNew));
  });

  it("leaves the caller's MEK bytes intact, because the caller still needs them", () => {
    // changeVaultPassword re-wraps these same bytes under the new password
    // after the pin is computed. Zeroing the caller's copy here would break
    // the password change itself.
    expect(fixture.mekBytes.some((b) => b !== 0)).toBe(true);
  });

  it("writes no OR column at all for a row that is already pinned", async () => {
    const pinned: OrPinSourceRow = {
      kdf_salt: fixture.saltOld,
      enc_or_mek_ciphertext: fixture.columns?.enc_or_mek_ciphertext ?? "",
      or_subkey_salt: fixture.saltOld,
      or_key_epoch: CURRENT_OR_KEY_EPOCH,
    };

    const columns = await computeOrPinColumns({
      row: pinned,
      password: PASSWORD,
      userId: USER_ID,
      mekBytes: fixture.mekBytes,
    });

    // Null means the caller spreads nothing, so an existing pin is never
    // overwritten by a password change.
    expect(columns).toBeNull();
  });

  it("refuses a half stored row rather than repairing it", async () => {
    const halfStored: OrPinSourceRow = {
      kdf_salt: fixture.saltOld,
      enc_or_mek_ciphertext: null,
      or_subkey_salt: fixture.saltOld,
      or_key_epoch: CURRENT_OR_KEY_EPOCH,
    };

    await expect(
      computeOrPinColumns({
        row: halfStored,
        password: PASSWORD,
        userId: USER_ID,
        mekBytes: fixture.mekBytes,
      }),
    ).resolves.toBeNull();
  });

  it("refuses when the row carries no salt to pin against", async () => {
    await expect(
      computeOrPinColumns({
        row: unpinnedRow(""),
        password: PASSWORD,
        userId: USER_ID,
        mekBytes: fixture.mekBytes,
      }),
    ).resolves.toBeNull();
  });
});
