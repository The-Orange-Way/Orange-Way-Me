import { describe, expect, it } from "vitest";
import { friendlyProviderName } from "@/components/connections/ConnectionsPage";

describe("friendlyProviderName", () => {
  it("maps a descriptor-family stealth connection to a human name, not the raw slug", () => {
    const label = friendlyProviderName("descriptor_stealth");

    expect(label).toBe("Private wallet");
    expect(label).not.toContain("Descriptor_stealth");
    expect(label).not.toContain("descriptor_stealth");
  });

  it("keeps the xpub-family stealth label consistent with the descriptor family", () => {
    expect(friendlyProviderName("xpub_stealth")).toBe("Private wallet");
  });

  it("still capitalises an unknown provider slug as the honest fallback", () => {
    expect(friendlyProviderName("some_new_provider")).toBe("Some_new_provider");
  });
});
