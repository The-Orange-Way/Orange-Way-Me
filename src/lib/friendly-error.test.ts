import { describe, expect, it } from "vitest";
import {
  OrNamespaceDisabledError,
  OR_UNPINNED_SALT_ROTATED_REASON,
  planOrKeyMaterial,
} from "@/lib/or/or-key-material";
import { humanizeError, humanizeOrDisabledReason } from "@/lib/friendly-error";

describe("humanizeOrDisabledReason", () => {
  it("tells the customer to re-sync when the vault salt rotated unpinned", () => {
    const message = humanizeOrDisabledReason(OR_UNPINNED_SALT_ROTATED_REASON);

    expect(message).toContain("re-sync");
    expect(message).not.toContain("couldn't reach our encryption service");
  });

  it("falls back to an honest generic message for a refuse reason with no self-serve fix", () => {
    const reason =
      "Orange Rails key material is partly stored: the sealed key missing, so the subkeys cannot be reproduced.";

    const message = humanizeOrDisabledReason(reason);

    expect(message).not.toContain("re-sync");
    expect(message).not.toContain("couldn't reach our encryption service");
  });
});

describe("humanizeError with OrNamespaceDisabledError", () => {
  it("routes the refuse reason through the same re-sync copy as the direct call", () => {
    const err = new OrNamespaceDisabledError(OR_UNPINNED_SALT_ROTATED_REASON);

    const message = humanizeError(err, "We couldn't reach our encryption service.");

    expect(message).toBe(humanizeOrDisabledReason(OR_UNPINNED_SALT_ROTATED_REASON));
    expect(message).toContain("re-sync");
    expect(message).not.toBe("We couldn't reach our encryption service.");
  });

  it("drives the real refuse producer end to end: unpinned row, rotated salt, real customer copy", () => {
    // No literal reason string here on purpose. This is the assertion that
    // catches a reword at the source (T0396): if the sentence produced by
    // planOrKeyMaterial ever stops containing the phrase
    // humanizeOrDisabledReason matches on, this goes red instead of staying
    // green against a private copy.
    const plan = planOrKeyMaterial(
      { enc_or_mek_ciphertext: null, or_subkey_salt: null, or_key_epoch: null },
      "current-kdf-salt",
      { saltMatchesExistingRows: false },
    );

    expect(plan.mode).toBe("refuse");
    const reason = plan.mode === "refuse" ? plan.reason : "";

    const err = new OrNamespaceDisabledError(reason);
    const message = humanizeError(err, "We couldn't reach our encryption service.");

    expect(message).toContain("re-sync");
    expect(message).not.toBe("We couldn't reach our encryption service.");
  });
});
