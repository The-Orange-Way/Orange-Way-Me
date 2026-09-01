/**
 * The scan door of the stealth kill switch.
 *
 * Every case below is a value a real caller can hand this function, not a
 * hypothetical: the string "true" is what an env var read produces, undefined
 * is the flag before the app_flags row resolves, null is a missing row, and 1
 * is what a numeric column would give. A truthiness check passes three of
 * those four, which is why they are asserted by value.
 */

import { describe, it, expect } from "vitest";
import {
  planStealthScan,
  StealthScanDisabledError,
  STEALTH_SCAN_DISABLED_MESSAGE,
} from "../scan-gate";

describe("planStealthScan", () => {
  it("allows a scan when the flag is the boolean true", () => {
    expect(planStealthScan({ stealthSyncEnabled: true })).toEqual({ allowed: true });
  });

  it("refuses when the flag is false", () => {
    const decision = planStealthScan({ stealthSyncEnabled: false });
    expect(decision.allowed).toBe(false);
    expect(decision).toMatchObject({ reason: "stealth-disabled" });
  });

  it.each([
    ["undefined, the flag before the row resolves", undefined],
    ["null, a missing flag row", null],
    ['the string "true", an env var read', "true"],
    ["the string 'false'", "false"],
    ["the number 1", 1],
    ["an empty object", {}],
  ])("fails closed on %s", (_label, value) => {
    expect(planStealthScan({ stealthSyncEnabled: value }).allowed).toBe(false);
  });

  it("says something the customer can act on, and does not claim data is lost", () => {
    const decision = planStealthScan({ stealthSyncEnabled: false });
    if (decision.allowed) throw new Error("expected a refusal");
    expect(decision.message).toBe(STEALTH_SCAN_DISABLED_MESSAGE);
    expect(decision.message).toMatch(/temporarily unavailable/i);
    expect(decision.message).toMatch(/not affected/i);
  });
});

describe("StealthScanDisabledError", () => {
  it("carries the customer-facing message by default", () => {
    expect(new StealthScanDisabledError().message).toBe(STEALTH_SCAN_DISABLED_MESSAGE);
  });

  it("is distinguishable from an ordinary launch failure", () => {
    const err: unknown = new StealthScanDisabledError();
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(StealthScanDisabledError);
    expect(new Error("Popup blocked")).not.toBeInstanceOf(StealthScanDisabledError);
  });
});
