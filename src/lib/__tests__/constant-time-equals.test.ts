import { describe, expect, it } from "vitest";
import { constantTimeEquals } from "../vault";

// The "constant-time" property is hard to assert at the unit-test level
// because JS engines have non-deterministic JIT effects. These tests cover
// the correctness contract: given the same inputs the helper returns the
// same boolean as `===`. The timing property is enforced by code-review.

describe("constantTimeEquals", () => {
  it("returns true for identical strings", () => {
    expect(constantTimeEquals("", "")).toBe(true);
    expect(constantTimeEquals("a", "a")).toBe(true);
    expect(constantTimeEquals("BITBOOKS_PERSONAL_VAULT_V1", "BITBOOKS_PERSONAL_VAULT_V1")).toBe(
      true,
    );
  });

  it("returns false for different strings of equal length", () => {
    expect(constantTimeEquals("abc", "abd")).toBe(false);
    expect(constantTimeEquals("foo", "bar")).toBe(false);
  });

  it("returns false for strings of different lengths", () => {
    expect(constantTimeEquals("", "a")).toBe(false);
    expect(constantTimeEquals("abc", "abcd")).toBe(false);
    expect(constantTimeEquals("abcd", "abc")).toBe(false);
  });

  it("handles unicode correctly via charCodeAt", () => {
    expect(constantTimeEquals("héllo", "héllo")).toBe(true);
    expect(constantTimeEquals("hello", "héllo")).toBe(false);
  });

  it("does not short-circuit on the first differing byte", () => {
    // If the implementation short-circuited, the iteration count would
    // differ between these two cases. We can't measure timing here, but
    // we can at least verify correctness on the boundary cases.
    expect(constantTimeEquals("a000000000", "b000000000")).toBe(false);
    expect(constantTimeEquals("000000000a", "000000000b")).toBe(false);
  });
});
