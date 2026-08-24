import { describe, expect, it } from "vitest";

import {
  CURRENT_OR_KEY_EPOCH,
  OrNamespaceDisabledError,
  planOrKeyMaterial,
  type OrKeyMaterialRow,
} from "../or-key-material";

const EMPTY: OrKeyMaterialRow = {
  enc_or_mek_ciphertext: null,
  or_subkey_salt: null,
  or_key_epoch: null,
};

const PINNED: OrKeyMaterialRow = {
  enc_or_mek_ciphertext: "sealed-blob",
  or_subkey_salt: "salt-at-pin-time",
  or_key_epoch: CURRENT_OR_KEY_EPOCH,
};

describe("planOrKeyMaterial", () => {
  it("derives and pins when nothing is stored yet", () => {
    expect(planOrKeyMaterial(EMPTY, "current-salt")).toEqual({
      mode: "derive-and-pin",
      saltContext: "current-salt",
      epoch: CURRENT_OR_KEY_EPOCH,
    });
  });

  it("pins against the CURRENT salt, because that is what today's rows were sealed under", () => {
    const plan = planOrKeyMaterial(EMPTY, "todays-salt");
    expect(plan.mode).toBe("derive-and-pin");
    if (plan.mode !== "derive-and-pin") throw new Error("unreachable");
    expect(plan.saltContext).toBe("todays-salt");
  });

  it("unwraps when the pair is stored, and uses the PINNED salt not the current one", () => {
    expect(planOrKeyMaterial(PINNED, "some-newer-salt")).toEqual({
      mode: "unwrap",
      ciphertext: "sealed-blob",
      saltContext: "salt-at-pin-time",
    });
  });

  /**
   * The whole defect in one assertion. A password change rotates kdf_salt.
   * Before this change, that rotation moved all four Orange Rails subkeys and
   * orphaned every row sealed under the old ones. Once pinned, the plan must
   * be identical on both sides of a rotation.
   */
  it("returns the same plan before and after the salt rotates", () => {
    expect(planOrKeyMaterial(PINNED, "salt-before")).toEqual(
      planOrKeyMaterial(PINNED, "salt-after"),
    );
  });

  it("refuses a generation it does not understand rather than unwrapping it", () => {
    const plan = planOrKeyMaterial({ ...PINNED, or_key_epoch: CURRENT_OR_KEY_EPOCH + 1 }, "s");
    expect(plan.mode).toBe("refuse");
  });

  it("refuses an OLDER generation too, because a skipped migration is not a no-op", () => {
    const plan = planOrKeyMaterial({ ...PINNED, or_key_epoch: 0 }, "s");
    expect(plan.mode).toBe("refuse");
  });

  it("names both generations in the refusal so the mismatch is diagnosable", () => {
    const plan = planOrKeyMaterial({ ...PINNED, or_key_epoch: 7 }, "s");
    if (plan.mode !== "refuse") throw new Error("expected refuse");
    expect(plan.reason).toContain("7");
    expect(plan.reason).toContain(String(CURRENT_OR_KEY_EPOCH));
  });

  it("refuses when the sealed key is present without its salt", () => {
    const plan = planOrKeyMaterial(
      { enc_or_mek_ciphertext: "sealed-blob", or_subkey_salt: null, or_key_epoch: 1 },
      "current-salt",
    );
    expect(plan.mode).toBe("refuse");
  });

  it("refuses when the salt is present without the sealed key", () => {
    const plan = planOrKeyMaterial(
      { enc_or_mek_ciphertext: null, or_subkey_salt: "pinned-salt", or_key_epoch: 1 },
      "current-salt",
    );
    expect(plan.mode).toBe("refuse");
  });

  it("refuses when the generation is present without the pair", () => {
    const plan = planOrKeyMaterial({ ...EMPTY, or_key_epoch: 1 }, "current-salt");
    expect(plan.mode).toBe("refuse");
  });

  it("says which parts are missing, so a half-pinned row is diagnosable", () => {
    const plan = planOrKeyMaterial(
      { enc_or_mek_ciphertext: "sealed-blob", or_subkey_salt: null, or_key_epoch: null },
      "current-salt",
    );
    if (plan.mode !== "refuse") throw new Error("expected refuse");
    expect(plan.reason).toContain("its salt");
    expect(plan.reason).toContain("its generation");
  });

  /**
   * Deriving is the ONE thing a half-pinned row must never fall back to. After
   * a rotation it produces a key that opens nothing while looking exactly like
   * success, which is the original defect wearing the fix's clothes.
   */
  it("never falls back to deriving from a half-pinned row", () => {
    for (const row of [
      { enc_or_mek_ciphertext: "x", or_subkey_salt: null, or_key_epoch: null },
      { enc_or_mek_ciphertext: null, or_subkey_salt: "y", or_key_epoch: null },
      { enc_or_mek_ciphertext: null, or_subkey_salt: null, or_key_epoch: 1 },
      { enc_or_mek_ciphertext: "x", or_subkey_salt: "y", or_key_epoch: null },
    ]) {
      expect(planOrKeyMaterial(row, "current-salt").mode).toBe("refuse");
    }
  });

  it("treats empty strings as absent, not as a pinned value", () => {
    expect(
      planOrKeyMaterial(
        { enc_or_mek_ciphertext: "", or_subkey_salt: "", or_key_epoch: null },
        "current-salt",
      ).mode,
    ).toBe("derive-and-pin");
  });

  it("refuses to pin when there is no current salt to pin against", () => {
    expect(planOrKeyMaterial(EMPTY, "").mode).toBe("refuse");
  });

  it("does not treat a non-finite generation as present", () => {
    expect(planOrKeyMaterial({ ...EMPTY, or_key_epoch: Number.NaN }, "s").mode).toBe(
      "derive-and-pin",
    );
  });

  /**
   * The unpinned half of the same defect the pinned half above already covers.
   *
   * Recovery mints a new salt before it asks for key material. When a row was
   * never pinned there is nothing to unwrap, and deriving against the new salt
   * produces 32 bytes that open none of the rows the customer already has. It
   * looks like success at every layer, which is what made the original loss
   * silent. Nor can recovery repair it: reproducing the old key needs the OLD
   * password, and recovery exists precisely because that is gone.
   */
  it("refuses when nothing is pinned and the salt has just rotated", () => {
    const plan = planOrKeyMaterial(EMPTY, "brand-new-salt", {
      saltMatchesExistingRows: false,
    });
    expect(plan.mode).toBe("refuse");
  });

  it("says in the refusal that earlier transactions need a re-sync", () => {
    const plan = planOrKeyMaterial(EMPTY, "brand-new-salt", {
      saltMatchesExistingRows: false,
    });
    expect(plan.mode === "refuse" && plan.reason).toMatch(/re-sync/i);
  });

  /**
   * A rotated salt is only fatal when there is nothing pinned. An account that
   * WAS pinned recovers normally, because the pinned blob is sealed under the
   * vault MEK and recovery reaches that MEK through the recovery code. This is
   * the case that must keep working, or the fix trades one silent loss for a
   * loud one.
   */
  it("still unwraps a pinned row even though the salt has rotated", () => {
    expect(planOrKeyMaterial(PINNED, "brand-new-salt", { saltMatchesExistingRows: false })).toEqual(
      {
        mode: "unwrap",
        ciphertext: "sealed-blob",
        saltContext: "salt-at-pin-time",
      },
    );
  });

  it("derives and pins when the salt is explicitly unchanged, as on an unlock", () => {
    expect(planOrKeyMaterial(EMPTY, "current-salt", { saltMatchesExistingRows: true })).toEqual({
      mode: "derive-and-pin",
      saltContext: "current-salt",
      epoch: CURRENT_OR_KEY_EPOCH,
    });
  });

  /**
   * Every caller that predates the flag was an unlock or a vault creation, so
   * omitting it has to keep behaving as one. If this ever flips to refusing,
   * unlock stops pinning and the rows it was meant to protect stay exposed.
   */
  it("treats an omitted flag as the unchanged-salt case", () => {
    expect(planOrKeyMaterial(EMPTY, "current-salt", {}).mode).toBe("derive-and-pin");
    expect(planOrKeyMaterial(EMPTY, "current-salt").mode).toBe("derive-and-pin");
  });

  it("refuses a half-pinned row on recovery too, not just on unlock", () => {
    const halfPinned: OrKeyMaterialRow = { ...PINNED, or_subkey_salt: null };
    expect(
      planOrKeyMaterial(halfPinned, "brand-new-salt", { saltMatchesExistingRows: false }).mode,
    ).toBe("refuse");
  });
});

describe("OrNamespaceDisabledError", () => {
  /**
   * Consumers key their disabled-state UI off `instanceof`, never off message
   * text. If this stops holding, a banner built on it silently becomes a broad
   * catch that hides real errors.
   */
  it("is catchable by instanceof and carries the reason separately", () => {
    const err = new OrNamespaceDisabledError("generation 2 is not understood");
    expect(err).toBeInstanceOf(OrNamespaceDisabledError);
    expect(err).toBeInstanceOf(Error);
    expect(err.reason).toBe("generation 2 is not understood");
    expect(err.name).toBe("OrNamespaceDisabledError");
  });

  it("is distinguishable from the vault-locked error", () => {
    expect(new Error("Vault is locked")).not.toBeInstanceOf(OrNamespaceDisabledError);
  });
});
