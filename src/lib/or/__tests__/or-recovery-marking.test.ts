/**
 * OWM-T0242 / OW-C0640.
 *
 * The Auditor's challenge on OWM-T0242 criterion 3: changeVaultPassword's
 * pin logic (computeOrPinColumns) was covered, recoverWithCode's marking
 * logic was not, and neither was unlock's saltRotatedWhileUnpinned flag. No
 * test called recoverWithCode or exercised its marking write directly;
 * resolveOrKeyMaterial.test.ts only fed the resolver hand-built arguments
 * after that write would already have happened.
 *
 * This asserts the two pure functions those call sites now use directly,
 * against the three row shapes that actually occur: fully unpinned (never
 * established), half-established (a prior unmarked recovery's leftover, the
 * exact shape DEV-0049 exists to stop creating more of), and fully pinned.
 */

import { describe, expect, it } from "vitest";

import {
  isFullyUnpinned,
  recoveryOrMarking,
  saltRotatedWhileUnpinned,
  type OrMarkingSourceRow,
} from "../or-recovery-marking";

const NEVER_ESTABLISHED: OrMarkingSourceRow = {
  enc_or_mek_ciphertext: null,
  or_subkey_salt: null,
  or_key_epoch: null,
};

const HALF_ESTABLISHED: OrMarkingSourceRow = {
  enc_or_mek_ciphertext: null,
  or_subkey_salt: "old-salt-b64",
  or_key_epoch: null,
};

const FULLY_PINNED: OrMarkingSourceRow = {
  enc_or_mek_ciphertext: "wrapped-mek-ciphertext",
  or_subkey_salt: "old-salt-b64",
  or_key_epoch: 1,
};

describe("isFullyUnpinned", () => {
  it("is true only when all three columns are absent", () => {
    expect(isFullyUnpinned(NEVER_ESTABLISHED)).toBe(true);
    expect(isFullyUnpinned(HALF_ESTABLISHED)).toBe(false);
    expect(isFullyUnpinned(FULLY_PINNED)).toBe(false);
  });
});

describe("recoveryOrMarking", () => {
  it("marks a previously fully-unpinned row with the pre-rotation salt", () => {
    expect(recoveryOrMarking(NEVER_ESTABLISHED, "pre-rotation-salt")).toEqual({
      or_subkey_salt: "pre-rotation-salt",
    });
  });

  it("does not re-mark an already half-established row", () => {
    // This is the case DEV-0049 exists to prevent creating more of: a row
    // that some earlier, unmarked recovery already left half-established.
    // recoverWithCode must leave its existing or_subkey_salt alone rather
    // than overwrite it with the salt from THIS recovery.
    expect(recoveryOrMarking(HALF_ESTABLISHED, "this-recoverys-old-salt")).toBeNull();
  });

  it("does nothing to a fully pinned row", () => {
    expect(recoveryOrMarking(FULLY_PINNED, "this-recoverys-old-salt")).toBeNull();
  });
});

describe("saltRotatedWhileUnpinned", () => {
  it("is false for a row that was never established", () => {
    expect(saltRotatedWhileUnpinned(NEVER_ESTABLISHED)).toBe(false);
  });

  it("is true for the half-established shape unlock must not trust", () => {
    expect(saltRotatedWhileUnpinned(HALF_ESTABLISHED)).toBe(true);
  });

  it("is false for a fully pinned row", () => {
    expect(saltRotatedWhileUnpinned(FULLY_PINNED)).toBe(false);
  });
});
