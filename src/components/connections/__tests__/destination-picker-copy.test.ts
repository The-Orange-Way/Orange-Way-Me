import { describe, it, expect } from "vitest";
import {
  createButtonLabel,
  emptyStateMessage,
  suggestedAccountName,
} from "../destination-picker-copy";

/**
 * DL-1427. A beta tester on a phone could not work out how to create an
 * account. Two things caused it: the only control was a bare "+" glyph whose
 * label was hidden at phone width, and a search that matched nothing said
 * "No accounts yet" with nothing to act on.
 *
 * The founder's scope note turned this from a copy change into a behavioural
 * one: when a search finds nothing, offer to create what was typed, pre-filled,
 * so the customer never types the same name twice.
 */

describe("emptyStateMessage", () => {
  it("names what was searched for, so the customer knows the search ran", () => {
    expect(emptyStateMessage("Strike business")).toBe('No account matches "Strike business".');
  });

  it("falls back to the never-had-any-accounts wording when nothing was typed", () => {
    expect(emptyStateMessage("")).toBe("No accounts yet.");
    expect(emptyStateMessage("   ")).toBe("No accounts yet.");
  });
});

describe("createButtonLabel", () => {
  it("offers to create exactly what was typed", () => {
    expect(createButtonLabel("personal Revolut")).toBe('+ Create "personal Revolut"');
  });

  it("never renders an empty or dangling label", () => {
    for (const input of ["", "   ", "\t\n"]) {
      expect(createButtonLabel(input)).toBe("+ Create a new account");
    }
  });

  it("trims so the label does not carry the customer's stray spaces", () => {
    expect(createButtonLabel("  Cold storage  ")).toBe('+ Create "Cold storage"');
  });
});

describe("suggestedAccountName", () => {
  /**
   * This is the anti-retyping property, and it is the whole point of the
   * ticket. If the customer typed a name, that name is what the create dialog
   * must open with, even though a wallet-derived default exists.
   */
  it("prefers what the customer typed over the wallet-derived default", () => {
    expect(suggestedAccountName("Strike business account", "BTC wallet")).toBe(
      "Strike business account",
    );
  });

  it("uses the wallet default only when nothing was typed", () => {
    expect(suggestedAccountName("", "BTC wallet")).toBe("BTC wallet");
    expect(suggestedAccountName("   ", "BTC wallet")).toBe("BTC wallet");
  });

  it("returns empty when there is neither a search nor a wallet default", () => {
    expect(suggestedAccountName("", "")).toBe("");
  });

  it("trims both sides so the name field never opens with padding", () => {
    expect(suggestedAccountName("  Travel checking ", "BTC wallet")).toBe("Travel checking");
    expect(suggestedAccountName("", "  BTC wallet  ")).toBe("BTC wallet");
  });
});
