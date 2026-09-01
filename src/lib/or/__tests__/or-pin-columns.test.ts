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
 * THE THIRD POPULATION, ASSERTED HERE RATHER THAN ARGUED ABOUT. An account
 * that changed its vault password BEFORE the pin shipped rotated its kdf_salt
 * with all three Orange Rails columns still null. For that row the salt in
 * force is no longer the salt its already synced rows were sealed under, and
 * nothing stored can tell the two apart, so the helper derives and pins
 * against the salt it can see. That is deliberate, and it loses nothing that
 * was not already lost: deriveOrMekBytes takes the PASSWORD as well as the
 * salt, so the key that sealed those rows stopped being reproducible at the
 * earlier password change, whatever gets pinned now. The two cases at the
 * bottom of this file state that in assertions, so the next reader finds a
 * decision instead of an accident. Whether a refusal would be the better
 * answer for that population is OWM-T0233's question, not this file's.
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
  /**
   * The columns produced for a row that rotated while unpinned: kdf_salt is
   * the salt that rotation minted, and all three columns are still null.
   */
  rotatedWhileUnpinned: Awaited<ReturnType<typeof computeOrPinColumns>>;
}

let fixture!: Fixture;

/**
 * Argon2id is deliberately expensive, so the four derivations this suite
 * needs are paid once here rather than per test: two reference keys, and one
 * inside each of the two computeOrPinColumns calls below.
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

  // The account that rotated while unpinned. Same shape as the row above, but
  // the salt on it is the one a password change already minted, so it is not
  // the salt the rows this account already synced were sealed under.
  //
  // The password is held constant across the fixture on purpose: it isolates
  // the salt, which is the variable under test. In the real population the
  // password changed too, which is exactly why the old key was already
  // unreproducible before this helper ever ran.
  const rotatedWhileUnpinned = await computeOrPinColumns({
    row: unpinnedRow(saltNew),
    password: PASSWORD,
    userId: USER_ID,
    mekBytes,
  });

  fixture = {
    saltOld,
    saltNew,
    mekBytes,
    kAgainstOld,
    kAgainstNew,
    columns,
    rotatedWhileUnpinned,
  };
  // Raised from 120s with the fourth Argon2id derivation this block now pays
  // for. The work is deliberately expensive; the timeout is not the subject.
}, 180_000);

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

  it("still pins a row that rotated while unpinned, against the salt it can see", () => {
    // Nothing stored distinguishes this row from one that never rotated, so
    // the helper cannot refuse it selectively even in principle. Asserting the
    // outcome makes the limit visible rather than leaving it to a comment.
    expect(fixture.rotatedWhileUnpinned).not.toBeNull();
    expect(fixture.rotatedWhileUnpinned?.or_subkey_salt).toBe(fixture.saltNew);
    expect(fixture.rotatedWhileUnpinned?.or_subkey_salt).not.toBe(fixture.saltOld);
    expect(fixture.rotatedWhileUnpinned?.or_key_epoch).toBe(CURRENT_OR_KEY_EPOCH);
  });

  it("seals for that row a key that does not open what was sealed before the rotation", async () => {
    const vaultMek = await importMekFromRaw(fixture.mekBytes);
    const sealedKey = await unwrapOrMekWithVaultMek(
      fixture.rotatedWhileUnpinned?.enc_or_mek_ciphertext ?? "",
      vaultMek,
    );

    // The bytes are the ones the current salt produces, and they are NOT the
    // bytes that opened the pre rotation rows. Said out loud in a test so that
    // "a re-sync is needed for anything synced earlier" is a documented
    // consequence of pinning here, not a surprise found in production.
    expect(toHex(sealedKey)).toBe(toHex(fixture.kAgainstNew));
    expect(toHex(sealedKey)).not.toBe(toHex(fixture.kAgainstOld));
  });
});
