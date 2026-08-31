import { describe, expect, it } from "vitest";
import {
  OrNamespaceDisabledError,
  planOrKeyMaterial,
  type OrKeyMaterialRow,
} from "@/lib/or/or-key-material";
import { humanizeError, humanizeOrDisabledReason } from "@/lib/friendly-error";

/** A row with nothing pinned yet: every column absent. */
const UNPINNED_ROW: OrKeyMaterialRow = {
  enc_or_mek_ciphertext: null,
  or_subkey_salt: null,
  or_key_epoch: null,
};

/** A row that is half-established: one column present, the others not. */
const PARTIALLY_STORED_ROW: OrKeyMaterialRow = {
  enc_or_mek_ciphertext: "sealed-bytes",
  or_subkey_salt: null,
  or_key_epoch: null,
};

/**
 * Drives planOrKeyMaterial and returns its refuse reason, or fails the test
 * with a clear message if the plan was not a refusal. Keeps the two tests
 * below reading as "the reason planOrKeyMaterial actually returns", not "a
 * reason someone typed expecting it to match".
 */
function refuseReason(row: OrKeyMaterialRow, saltMatchesExistingRows: boolean): string {
  const plan = planOrKeyMaterial(row, "current-salt", { saltMatchesExistingRows });
  if (plan.mode !== "refuse") {
    throw new Error(`expected planOrKeyMaterial to refuse, got mode "${plan.mode}"`);
  }
  return plan.reason;
}

describe("humanizeOrDisabledReason", () => {
  it("tells the customer to re-sync when the vault salt rotated unpinned", () => {
    const reason = refuseReason(UNPINNED_ROW, false);

    const message = humanizeOrDisabledReason(reason);

    expect(message).toContain("re-sync");
    expect(message).not.toContain("couldn't reach our encryption service");
  });

  it("falls back to an honest generic message for a refuse reason with no self-serve fix", () => {
    const reason = refuseReason(PARTIALLY_STORED_ROW, true);

    const message = humanizeOrDisabledReason(reason);

    expect(message).not.toContain("re-sync");
    expect(message).not.toContain("couldn't reach our encryption service");
  });
});

describe("humanizeError with OrNamespaceDisabledError", () => {
  it("routes the refuse reason planOrKeyMaterial actually returns through the same re-sync copy", () => {
    const reason = refuseReason(UNPINNED_ROW, false);
    const err = new OrNamespaceDisabledError(reason);

    const message = humanizeError(err, "We couldn't reach our encryption service.");

    expect(message).toBe(humanizeOrDisabledReason(reason));
    expect(message).toContain("re-sync");
    expect(message).not.toBe("We couldn't reach our encryption service.");
  });
});
