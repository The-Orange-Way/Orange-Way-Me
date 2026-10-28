import { describe, it, expect } from "vitest";
import { friendlyProviderName } from "../ConnectionsPage";

describe("friendlyProviderName", () => {
  it("shows descriptor_stealth as Private wallet, not the raw slug", () => {
    expect(friendlyProviderName("descriptor_stealth")).toBe("Private wallet");
  });

  it("still shows xpub_stealth as Private wallet (unchanged sibling case)", () => {
    expect(friendlyProviderName("xpub_stealth")).toBe("Private wallet");
  });

  it("falls back to a capitalised slug for a genuinely unknown provider", () => {
    expect(friendlyProviderName("some_new_provider")).toBe("Some_new_provider");
  });
});
