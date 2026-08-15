import { describe, it, expect } from "vitest";
import { resolveSyncRoute } from "../sync-route";

describe("resolveSyncRoute", () => {
  it("routes a Quiltt bank connection to the bank dialog", () => {
    expect(resolveSyncRoute({ provider_type: "quiltt", is_stealth: false }, true)).toBe("bank");
  });

  // DL-1047, the whole point of this test. A stored stealth connection with the
  // entry switched on must reach the OR widget scan path. If this ever returns
  // "orSync" again the connection can never be scanned after the add widget
  // closes, which is the exact regression this ticket fixed.
  it("routes a stealth connection to the widget scan when the entry is enabled", () => {
    expect(resolveSyncRoute({ provider_type: "blink", is_stealth: true }, true)).toBe("stealth");
  });

  it("keeps a stealth connection dark while the entry is disabled", () => {
    expect(resolveSyncRoute({ provider_type: "blink", is_stealth: true }, false)).toBe("orSync");
  });

  it("routes an ordinary Bitcoin connection to or-sync", () => {
    expect(resolveSyncRoute({ provider_type: "blink", is_stealth: false }, true)).toBe("orSync");
  });

  it("treats an absent is_stealth as ordinary", () => {
    expect(resolveSyncRoute({ provider_type: "strike" }, true)).toBe("orSync");
  });

  it("prefers the bank route even for a stealth-flagged Quiltt row", () => {
    expect(resolveSyncRoute({ provider_type: "quiltt", is_stealth: true }, true)).toBe("bank");
  });
});
