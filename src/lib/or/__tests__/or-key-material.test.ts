/**
 * DL-1506.
 *
 * The bug: a vault password change regenerates kdf_salt, every Orange Rails
 * subkey is derived from it, so all four change and every row sealed under the
 * old ones is orphaned. The customer sees transactions quietly stop being
 * readable.
 *
 * The rule under test is the one that makes that stop happening: once the key
 * material is pinned, neither the password nor the current salt may influence
 * it again. The most important assertions here are the REFUSALS, because the
 * dangerous answer is never an error, it is a confident derive that produces a
 * key opening nothing.
 */

import { describe, expect, it } from "vitest";

import { planOrKeyMaterial, type OrKeyMaterialRow } from "../or-key-material";

const UNPINNED: OrKeyMaterialRow = {
  enc_or_mek_ciphertext: null,
  or_subkey_salt: null,
};

const PINNED: OrKeyMaterialRow = {
  enc_or_mek_ciphertext: "c2VhbGVk",
  or_subkey_salt: "salt-at-pin-time",
};

describe("planOrKeyMaterial", () => {
  describe("a vault that has never pinned its Orange Rails key material", () => {
    it("derives, and pins against the salt in force right now", () => {
      const plan = planOrKeyMaterial(UNPINNED, "current-salt");
      expect(plan).toEqual({ mode: "derive-and-pin", saltContext: "current-salt" });
    });

    it("refuses rather than pinning against nothing", () => {
      const plan = planOrKeyMaterial(UNPINNED, "");
      expect(plan.mode).toBe("refuse");
    });
  });

  describe("a vault that has pinned it, which is the case the fix exists for", () => {
    it("unwraps instead of deriving", () => {
      const plan = planOrKeyMaterial(PINNED, "current-salt");
      expect(plan).toEqual({
        mode: "unwrap",
        ciphertext: "c2VhbGVk",
        saltContext: "salt-at-pin-time",
      });
    });

    it("IGNORES the current salt entirely, which is the whole fix", () => {
      // This is the assertion that would have caught the original bug. After a
      // password change the salt is different, and the answer must not be.
      const before = planOrKeyMaterial(PINNED, "salt-before-password-change");
      const after = planOrKeyMaterial(PINNED, "salt-after-password-change");
      expect(after).toEqual(before);
      if (after.mode !== "unwrap") throw new Error("expected unwrap");
      expect(after.saltContext).toBe("salt-at-pin-time");
    });

    it("still unwraps when there is no current salt at all", () => {
      expect(planOrKeyMaterial(PINNED, "").mode).toBe("unwrap");
    });
  });

  describe("half-pinned states refuse, and never repair themselves quietly", () => {
    it("refuses a sealed key with no pinned salt", () => {
      const plan = planOrKeyMaterial(
        { enc_or_mek_ciphertext: "c2VhbGVk", or_subkey_salt: null },
        "current-salt",
      );
      expect(plan.mode).toBe("refuse");
      if (plan.mode !== "refuse") throw new Error("expected refuse");
      expect(plan.reason).toMatch(/salt is missing/i);
    });

    it("refuses a pinned salt with no sealed key", () => {
      const plan = planOrKeyMaterial(
        { enc_or_mek_ciphertext: null, or_subkey_salt: "salt-at-pin-time" },
        "current-salt",
      );
      expect(plan.mode).toBe("refuse");
      if (plan.mode !== "refuse") throw new Error("expected refuse");
      expect(plan.reason).toMatch(/no sealed key/i);
    });

    it("never answers derive-and-pin for a half-pinned row", () => {
      // Deriving here is the tempting repair and it is the wrong one: if the
      // salt has already rotated, the derived key opens nothing and nothing
      // says so.
      const a = planOrKeyMaterial(
        { enc_or_mek_ciphertext: "c2VhbGVk", or_subkey_salt: null },
        "current-salt",
      );
      const b = planOrKeyMaterial(
        { enc_or_mek_ciphertext: null, or_subkey_salt: "pinned" },
        "current-salt",
      );
      expect(a.mode).not.toBe("derive-and-pin");
      expect(b.mode).not.toBe("derive-and-pin");
    });
  });

  describe("empty strings are treated as absent, not as values", () => {
    it("treats an empty ciphertext as not pinned", () => {
      const plan = planOrKeyMaterial(
        { enc_or_mek_ciphertext: "", or_subkey_salt: null },
        "current-salt",
      );
      expect(plan.mode).toBe("derive-and-pin");
    });

    it("treats an empty pinned salt as not pinned", () => {
      const plan = planOrKeyMaterial(
        { enc_or_mek_ciphertext: "", or_subkey_salt: "" },
        "current-salt",
      );
      expect(plan.mode).toBe("derive-and-pin");
    });
  });
});
