/**
 * Does a vault password change pin the Orange Rails material to the salt the
 * existing rows were actually sealed under?
 *
 * THE HAZARD. `changeVaultPassword` plans the Orange Rails pin and then mints
 * a new `kdf_salt` further down the same function. If those two ever swap
 * order, the pin records a salt no sealed row was written against, and every
 * Orange Rails row that account already has stops opening. It looks exactly
 * like success: a well formed 32-byte key, a populated column, no error. That
 * is the same silent shape the pin design (DL-1506) exists to remove, and
 * nothing in the type system, the linter or the five CI checks would notice.
 *
 * WHAT IS ASSERTED, and why it is a value and not a call order. The check is
 * `or_subkey_salt === the salt the row carried before the rotation`. That
 * stays true however the code is arranged and goes false the moment the
 * ordering breaks. An assertion on mock invocation sequence would break on
 * harmless refactors and get deleted, which is how a guard test quietly stops
 * guarding.
 *
 * REAL PRIMITIVES, NO MOCKS. Argon2id, HKDF and the shipped wrap/unwrap are
 * used as they ship. The expensive derivations are done once in `beforeAll`.
 *
 * ZKA. Every input here is synthetic. No plaintext, no address, no txid, no
 * wallet-identifying value and no customer material is involved.
 */

import { beforeAll, describe, expect, it } from "vitest";

import {
  CURRENT_VAULT_KEY_VERSION,
  KEY_DERIVATION_STRATEGIES,
  deriveOrMekBytes,
  importMekFromRaw,
  randomBytesB64,
  unwrapOrMekWithVaultMek,
} from "@/lib/vault";

import { CURRENT_OR_KEY_EPOCH, planOrKeyMaterial } from "../or-key-material";
import { planOrPinForPasswordChange } from "../password-change-pin";
import type { OrPinForPasswordChange, PasswordChangePinRow } from "../password-change-pin";

const USER_ID = "77777777-8888-9999-aaaa-bbbbbbbbbbbb";
const PW_OLD = "old-password-correct-horse-262";
const PW_NEW = "new-password-battery-staple-262";

/** The wrapper every vault written today uses. Read, not assumed. */
const strategy = KEY_DERIVATION_STRATEGIES[CURRENT_VAULT_KEY_VERSION];

const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

/**
 * The UPDATE the password change actually issues, reproduced in the shape
 * `changeVaultPassword` builds it: the rotated salt, plus whatever the pin
 * helper returned spread over the top.
 */
function updatePayload(newSalt: string, pin: OrPinForPasswordChange): Record<string, unknown> {
  return {
    kdf_salt: newSalt,
    kdf_iterations: 600_000,
    enc_mek_ciphertext: "not-under-test",
    vault_key_version: CURRENT_VAULT_KEY_VERSION,
    ...(pin.columns ?? {}),
  };
}

interface Fixture {
  saltOld: string;
  saltNew: string;
  mekBytes: Uint8Array;
  kOld: Uint8Array;
  unpinned: OrPinForPasswordChange;
  alreadyPinned: OrPinForPasswordChange;
  halfStored: OrPinForPasswordChange;
}

let fixture!: Fixture;

beforeAll(async () => {
  const saltOld = randomBytesB64(16);

  // A vault as `createVault` writes one: a RANDOM key wrapped under the
  // password, not derived from it. That is why the MEK survives a rotation.
  const mekRaw = crypto.getRandomValues(new Uint8Array(32));
  const encBefore = await strategy.wrapMekWithPassword(
    mekRaw.buffer as ArrayBuffer,
    PW_OLD,
    saltOld,
  );
  const mekBytes = await strategy.unwrapMekWithPassword(encBefore, PW_OLD, saltOld);

  // The row as `changeVaultPassword` reads it: fetched BEFORE anything
  // rotates, nothing pinned yet.
  const unpinnedRow: PasswordChangePinRow = {
    kdf_salt: saltOld,
    enc_or_mek_ciphertext: null,
    or_subkey_salt: null,
    or_key_epoch: null,
  };

  const unpinned = await planOrPinForPasswordChange({
    row: unpinnedRow,
    currentPassword: PW_OLD,
    userId: USER_ID,
    vaultMekBytes: mekBytes,
  });

  // What the legacy value IS, derived independently of the helper so the
  // assertion compares against the shipped derivation rather than against
  // the helper's own output.
  const kOld = await deriveOrMekBytes(PW_OLD, USER_ID, saltOld);

  const alreadyPinned = await planOrPinForPasswordChange({
    row: {
      kdf_salt: saltOld,
      enc_or_mek_ciphertext: unpinned.columns?.enc_or_mek_ciphertext ?? null,
      or_subkey_salt: unpinned.columns?.or_subkey_salt ?? null,
      or_key_epoch: unpinned.columns?.or_key_epoch ?? null,
    },
    currentPassword: PW_OLD,
    userId: USER_ID,
    vaultMekBytes: mekBytes,
  });

  // One column present and the others missing. Something wrote a partial
  // state, and both possible repairs silently produce a key that opens
  // nothing, so the only honest answer is a refusal.
  const halfStored = await planOrPinForPasswordChange({
    row: {
      kdf_salt: saltOld,
      enc_or_mek_ciphertext: "half-written-ciphertext",
      or_subkey_salt: null,
      or_key_epoch: null,
    },
    currentPassword: PW_OLD,
    userId: USER_ID,
    vaultMekBytes: mekBytes,
  });

  fixture = {
    saltOld,
    saltNew: randomBytesB64(16),
    mekBytes,
    kOld,
    unpinned,
    alreadyPinned,
    halfStored,
  };
}, 600_000);

describe("Orange Rails pin during a vault password change", () => {
  /**
   * The load-bearing assertion of this suite. If the mint ever moves above
   * the plan, this is the line that goes red.
   */
  it("pins to the PRE-rotation salt, not to any salt minted later", () => {
    expect(fixture.unpinned.columns).not.toBeNull();
    expect(fixture.unpinned.columns?.or_subkey_salt).toBe(fixture.saltOld);
    expect(fixture.unpinned.columns?.or_key_epoch).toBe(CURRENT_OR_KEY_EPOCH);
    expect(fixture.unpinned.refusalReason).toBeNull();
  });

  it("the UPDATE rotates kdf_salt while or_subkey_salt stays on the old one", () => {
    const payload = updatePayload(fixture.saltNew, fixture.unpinned);
    expect(payload.kdf_salt).not.toBe(fixture.saltOld);
    expect(payload.or_subkey_salt).toBe(fixture.saltOld);
  });

  it("seals the key the OLD password and OLD salt actually produce", async () => {
    const vaultMek = await importMekFromRaw(fixture.mekBytes);
    const ct = fixture.unpinned.columns?.enc_or_mek_ciphertext as string;
    const recovered = await unwrapOrMekWithVaultMek(ct, vaultMek);
    expect(toHex(recovered)).toBe(toHex(fixture.kOld));
  });

  it("never overwrites a pin that already exists", () => {
    expect(fixture.alreadyPinned.columns).toBeNull();
    expect(fixture.alreadyPinned.refusalReason).toBeNull();

    const payload = updatePayload(fixture.saltNew, fixture.alreadyPinned);
    expect(Object.keys(payload).filter((k) => k.startsWith("or_"))).toHaveLength(0);
    expect(payload).not.toHaveProperty("enc_or_mek_ciphertext");
  });

  it("refuses a half-stored row rather than deriving over it", () => {
    expect(fixture.halfStored.columns).toBeNull();
    expect(fixture.halfStored.refusalReason).toBeTruthy();
  });

  /**
   * The negative control, and the reason the extraction was worth doing.
   * This is what the pre-extraction shape did when the salt was handed in by
   * the caller after the mint: a pin recorded against a salt no row was
   * sealed under. The helper cannot be made to do it, because it reads the
   * salt off the row rather than taking one.
   */
  it("CONTROL: planning against a post-rotation salt pins the wrong one", () => {
    const plan = planOrKeyMaterial(
      { enc_or_mek_ciphertext: null, or_subkey_salt: null, or_key_epoch: null },
      fixture.saltNew,
      { saltMatchesExistingRows: true },
    );
    expect(plan.mode).toBe("derive-and-pin");
    if (plan.mode !== "derive-and-pin") throw new Error("unreachable");
    expect(plan.saltContext).toBe(fixture.saltNew);
    expect(plan.saltContext).not.toBe(fixture.saltOld);
  });

  it("CONTROL: the rotation under test is real, not a no-op", () => {
    expect(fixture.saltNew).not.toBe(fixture.saltOld);
    expect(PW_NEW).not.toBe(PW_OLD);
  });
});
