import { describe, expect, it } from "vitest";
import { OrNamespaceDisabledError } from "@/lib/or/or-key-material";
import { humanizeError, humanizeOrDisabledReason } from "@/lib/friendly-error";

describe("humanizeOrDisabledReason", () => {
  it("tells the customer to re-sync when the vault salt rotated unpinned", () => {
    const reason =
      "Orange Rails key material was never pinned for this account and the vault salt has just changed, so the key that opened existing rows cannot be reproduced. Anything synced before this point needs a re-sync.";

    const message = humanizeOrDisabledReason(reason);

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
    const reason =
      "Orange Rails key material was never pinned for this account and the vault salt has just changed, so the key that opened existing rows cannot be reproduced. Anything synced before this point needs a re-sync.";
    const err = new OrNamespaceDisabledError(reason);

    const message = humanizeError(err, "We couldn't reach our encryption service.");

    expect(message).toBe(humanizeOrDisabledReason(reason));
    expect(message).toContain("re-sync");
    expect(message).not.toBe("We couldn't reach our encryption service.");
  });
});
