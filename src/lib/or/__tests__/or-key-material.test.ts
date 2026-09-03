import { describe, expect, it } from "vitest";

import {
  CURRENT_OR_KEY_EPOCH,
  OrNamespaceDisabledError,
  planOrKeyMaterial,
  type OrKeyMaterialPlan,
  type OrKeyMaterialRow,
  type PlanOrKeyMaterialOptions,
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

/** The unlock and vault-creation case: the salt has not moved. */
const UNCHANGED: PlanOrKeyMaterialOptions = { saltMatchesExistingRows: true };
/** The recovery case: a new salt was minted before we got here. */
const ROTATED: PlanOrKeyMaterialOptions = { saltMatchesExistingRows: false };

/**
 * A deliberately untyped view of the same function, standing in for a caller
 * that lost its types at a boundary: an untyped JavaScript consumer, or one
 * computing the flag from a lookup that yields `boolean | undefined`. That is
 * the only way this call shape can now occur, and it is exactly the shape that
 * used to fall through to derive-and-pin, so it needs a test the compiler
 * cannot delete.
 */
const planWithoutTypes = planOrKeyMaterial as unknown as (
  row: OrKeyMaterialRow,
  kdfSalt: string,
  options?: Partial<PlanOrKeyMaterialOptions>,
) => OrKeyMaterialPlan;

describe("planOrKeyMaterial", () => {
  it("derives and pins when nothing is stored yet", () => {
    expect(planOrKeyMaterial(EMPTY, "current-salt", UNCHANGED)).toEqual({
      mode: "derive-and-pin",
      saltContext: "current-salt",
      epoch: CURRENT_OR_KEY_EPOCH,
    });
  });

  it("pins against the CURRENT salt, because that is what today's rows were sealed under", () => {
    const plan = planOrKeyMaterial(EMPTY, "todays-salt", UNCHANGED);
    expect(plan.mode).toBe("derive-and-pin");
    if (plan.mode !== "derive-and-pin") throw new Error("unreachable");
    expect(plan.saltContext).toBe("todays-salt");
  });

  it("unwraps when the pair is stored, and uses the PINNED salt not the current one", () => {
    expect(planOrKeyMaterial(PINNED, "some-newer-salt", UNCHANGED)).toEqual({
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
    expect(planOrKeyMaterial(PINNED, "salt-before", UNCHANGED)).toEqual(
      planOrKeyMaterial(PINNED, "salt-after", UNCHANGED),
    );
  });

  it("refuses a generation it does not understand rather than unwrapping it", () => {
    const plan = planOrKeyMaterial(
      { ...PINNED, or_key_epoch: CURRENT_OR_KEY_EPOCH + 1 },
      "s",
      UNCHANGED,
    );
    expect(plan.mode).toBe("refuse");
  });

  it("refuses an OLDER generation too, because a skipped migration is not a no-op", () => {
    const plan = planOrKeyMaterial({ ...PINNED, or_key_epoch: 0 }, "s", UNCHANGED);
    expect(plan.mode).toBe("refuse");
  });

  it("names both generations in the refusal so the mismatch is diagnosable", () => {
    const plan = planOrKeyMaterial({ ...PINNED, or_key_epoch: 7 }, "s", UNCHANGED);
    if (plan.mode !== "refuse") throw new Error("expected refuse");
    expect(plan.reason).toContain("7");
    expect(plan.reason).toContain(String(CURRENT_OR_KEY_EPOCH));
  });

  it("refuses when the sealed key is present without its salt", () => {
    const plan = planOrKeyMaterial(
      { enc_or_mek_ciphertext: "sealed-blob", or_subkey_salt: null, or_key_epoch: 1 },
      "current-salt",
      UNCHANGED,
    );
    expect(plan.mode).toBe("refuse");
  });

  it("refuses when the salt is present without the sealed key", () => {
    const plan = planOrKeyMaterial(
      { enc_or_mek_ciphertext: null, or_subkey_salt: "pinned-salt", or_key_epoch: 1 },
      "current-salt",
      UNCHANGED,
    );
    expect(plan.mode).toBe("refuse");
  });

  it("refuses when the generation is present without the pair", () => {
    const plan = planOrKeyMaterial({ ...EMPTY, or_key_epoch: 1 }, "current-salt", UNCHANGED);
    expect(plan.mode).toBe("refuse");
  });

  it("says which parts are missing, so a half-pinned row is diagnosable", () => {
    const plan = planOrKeyMaterial(
      { enc_or_mek_ciphertext: "sealed-blob", or_subkey_salt: null, or_key_epoch: null },
      "current-salt",
      UNCHANGED,
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
      expect(planOrKeyMaterial(row, "current-salt", UNCHANGED).mode).toBe("refuse");
    }
  });

  it("treats empty strings as absent, not as a pinned value", () => {
    expect(
      planOrKeyMaterial(
        { enc_or_mek_ciphertext: "", or_subkey_salt: "", or_key_epoch: null },
        "current-salt",
        UNCHANGED,
      ).mode,
    ).toBe("derive-and-pin");
  });

  it("refuses to pin when there is no current salt to pin against", () => {
    expect(planOrKeyMaterial(EMPTY, "", UNCHANGED).mode).toBe("refuse");
  });

  it("does not treat a non-finite generation as present", () => {
    expect(planOrKeyMaterial({ ...EMPTY, or_key_epoch: Number.NaN }, "s", UNCHANGED).mode).toBe(
      "derive-and-pin",
    );
  });

  /**
   * PostgREST returns a Postgres `numeric` as a JSON string and only the
   * integer types as a JSON number. The migration declares this column
   * `integer`, so this cannot bite today, but reading a transported number as
   * "nothing is pinned" would send a pinned row down derive-and-pin, which is
   * the silent destruction the whole module exists to prevent. Cheap contract,
   * catastrophic failure if it ever stops holding.
   */
  it("reads a generation that arrives as a string, rather than treating it as absent", () => {
    expect(
      planOrKeyMaterial(
        { ...PINNED, or_key_epoch: String(CURRENT_OR_KEY_EPOCH) },
        "some-newer-salt",
        UNCHANGED,
      ),
    ).toEqual({
      mode: "unwrap",
      ciphertext: "sealed-blob",
      saltContext: "salt-at-pin-time",
    });
  });

  /**
   * `Number.isFinite(1.5)` is true, so a fractional value used to read as a
   * present generation and was then refused as an unknown format, which
   * describes the wrong problem. A non whole number is not a generation, so it
   * reads as absent and the row is reported for what it is: partly stored.
   */
  it("does not treat a fractional generation as a generation", () => {
    const plan = planOrKeyMaterial({ ...PINNED, or_key_epoch: 1.5 }, "s", UNCHANGED);
    if (plan.mode !== "refuse") throw new Error("expected refuse");
    expect(plan.reason).toContain("its generation");
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
    const plan = planOrKeyMaterial(EMPTY, "brand-new-salt", ROTATED);
    expect(plan.mode).toBe("refuse");
  });

  it("says in the refusal that earlier transactions need a re-sync", () => {
    const plan = planOrKeyMaterial(EMPTY, "brand-new-salt", ROTATED);
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
    expect(planOrKeyMaterial(PINNED, "brand-new-salt", ROTATED)).toEqual({
      mode: "unwrap",
      ciphertext: "sealed-blob",
      saltContext: "salt-at-pin-time",
    });
  });

  it("derives and pins when the salt is explicitly unchanged, as on an unlock", () => {
    expect(planOrKeyMaterial(EMPTY, "current-salt", UNCHANGED)).toEqual({
      mode: "derive-and-pin",
      saltContext: "current-salt",
      epoch: CURRENT_OR_KEY_EPOCH,
    });
  });

  /**
   * The defect this ticket exists for. Silence is not a claim that the salt is
   * unchanged. An undefined flag used to fall through to derive-and-pin, which
   * mints a key, pins it as authoritative, reports success, and orphans every
   * row the customer had already synced with nothing on screen to say so.
   */
  it("refuses when the caller did not state whether the salt matches", () => {
    expect(planWithoutTypes(EMPTY, "current-salt", {}).mode).toBe("refuse");
    expect(planWithoutTypes(EMPTY, "current-salt").mode).toBe("refuse");
    expect(
      planWithoutTypes(EMPTY, "current-salt", { saltMatchesExistingRows: undefined }).mode,
    ).toBe("refuse");
  });

  it("says in that refusal that the caller did not state it, so it is diagnosable", () => {
    const plan = planWithoutTypes(EMPTY, "current-salt");
    if (plan.mode !== "refuse") throw new Error("expected refuse");
    expect(plan.reason).toMatch(/did not state/i);
  });

  /**
   * A missing flag must not turn a pinned account into a disabled one. The
   * refusal above is for the derive path only: an account with material
   * pinned needs no statement about the salt, because it is not deriving.
   */
  it("still unwraps a pinned row when the flag is missing", () => {
    expect(planWithoutTypes(PINNED, "some-newer-salt").mode).toBe("unwrap");
  });

  it("refuses a half-pinned row on recovery too, not just on unlock", () => {
    const halfPinned: OrKeyMaterialRow = { ...PINNED, or_subkey_salt: null };
    expect(planOrKeyMaterial(halfPinned, "brand-new-salt", ROTATED).mode).toBe("refuse");
  });

  /**
   * A nullish row is what a failed READ looks like: a denied row, an aborted
   * request, a lookup that matched nothing. It used to throw a TypeError on
   * the first property access. A module whose whole contract is "derive,
   * unwrap or refuse" must answer with one of the three, and a crash is not
   * one of them.
   */
  it("refuses a null row instead of throwing", () => {
    const plan = planWithoutTypes(null as unknown as OrKeyMaterialRow, "current-salt", UNCHANGED);
    expect(plan.mode).toBe("refuse");
  });

  it("refuses an undefined row instead of throwing", () => {
    const plan = planWithoutTypes(
      undefined as unknown as OrKeyMaterialRow,
      "current-salt",
      UNCHANGED,
    );
    expect(plan.mode).toBe("refuse");
  });

  /**
   * The array is the case this guard was widened for, and it is the likely
   * wrong input rather than an exotic one. supabase-js returns `data` as an
   * array for a plain .select(), and only as an object or null when the
   * caller adds .single() or .maybeSingle(). The state where the row is
   * genuinely MISSING is the one that comes back as `[]`, which is precisely
   * the unreadable state this refusal exists for. Every column read off an
   * array is undefined, which is the all-absent shape, so before the plain
   * object check this input minted a key and pinned it as authoritative.
   */
  it("refuses an empty array, which is what a missing row from a plain select looks like", () => {
    const plan = planWithoutTypes([] as unknown as OrKeyMaterialRow, "current-salt", UNCHANGED);
    expect(plan.mode).toBe("refuse");
  });

  /**
   * The other half of the same mistake: `[row]` is what a SUCCESSFUL plain
   * .select() returns. The row is real and present, and reading columns off
   * the wrapper still yields undefined three times, so this must refuse
   * rather than quietly decide the account has nothing stored.
   */
  it("refuses a one element array carrying a real row", () => {
    const plan = planWithoutTypes([PINNED] as unknown as OrKeyMaterialRow, "current-salt", UNCHANGED);
    expect(plan.mode).toBe("refuse");
  });

  /**
   * `typeof x !== "object"` is doing this work, and it is worth pinning: a
   * primitive that arrives where a row was expected is a failed read wearing
   * a different costume, and none of these can answer what is stored.
   */
  it("refuses a non-object row, so a primitive cannot reach derive-and-pin either", () => {
    for (const value of ["a-string", 0, 42, false, true]) {
      expect(planWithoutTypes(value as unknown as OrKeyMaterialRow, "current-salt", UNCHANGED).mode).toBe(
        "refuse",
      );
    }
  });

  /**
   * A row that never arrived and a row that arrived empty must not share an
   * answer. The array cases above all refuse; this asserts the guard did not
   * take the fresh-account path down with them.
   */
  it("says the array was unreadable rather than partly stored", () => {
    const plan = planWithoutTypes([] as unknown as OrKeyMaterialRow, "current-salt", UNCHANGED);
    if (plan.mode !== "refuse") throw new Error("expected refuse");
    expect(plan.reason).toMatch(/could not be read/i);
    expect(plan.reason).not.toMatch(/partly stored/i);
  });

  /**
   * The two refusals send an operator to different places. "Could not be
   * read" means look at access and at the request; "partly stored" means
   * look at the columns. If either sentence drifts into the other's
   * language, the reason string stops being a diagnosis.
   */
  it("words the unreadable refusal apart from the half-stored one", () => {
    const unread = planWithoutTypes(null as unknown as OrKeyMaterialRow, "current-salt", UNCHANGED);
    const halfStored = planOrKeyMaterial(
      { ...PINNED, or_subkey_salt: null },
      "current-salt",
      UNCHANGED,
    );
    if (unread.mode !== "refuse") throw new Error("expected refuse");
    if (halfStored.mode !== "refuse") throw new Error("expected refuse");

    expect(unread.reason).toMatch(/could not be read/i);
    expect(halfStored.reason).toMatch(/partly stored/i);
    expect(unread.reason).not.toMatch(/partly stored/i);
    expect(halfStored.reason).not.toMatch(/could not be read/i);
  });

  /**
   * The guard must refuse a row that never arrived without refusing a row
   * that arrived empty. Those are different facts and only the first is a
   * failure: an empty row is every brand new account.
   */
  it("still derives for a genuinely empty row, so the fresh-account path stays open", () => {
    expect(planOrKeyMaterial(EMPTY, "current-salt", UNCHANGED)).toEqual({
      mode: "derive-and-pin",
      saltContext: "current-salt",
      epoch: CURRENT_OR_KEY_EPOCH,
    });
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
