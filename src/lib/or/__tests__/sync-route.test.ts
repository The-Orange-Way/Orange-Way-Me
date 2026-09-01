/**
 * Single-connection Sync routing, contract tests.
 *
 * The behaviour these exist to prevent: pressing Sync on a private connection
 * while the private wallet kill switch is OFF, and having the app export the
 * credentials key and the transactions key to or-sync instead of refusing.
 *
 * That was not a wrong branch BODY, it was a wrong branch CONDITION: the
 * switch was ANDed into the routing test, so switching the feature off moved
 * the connection onto the key-exporting path. The last two tests here are
 * aimed at that shape specifically, not at the values.
 */

import { describe, it, expect } from "vitest";
import { planSyncRoute, type SyncRouteCandidate } from "../sync-route";

describe("planSyncRoute", () => {
  it("sends a bank connection to the bank dialog", () => {
    expect(planSyncRoute({ provider_type: "quiltt" })).toBe("bank");
  });

  it("sends a private connection to the private path", () => {
    expect(planSyncRoute({ is_stealth: true })).toBe("private");
  });

  it("sends an ordinary Bitcoin source to or-sync", () => {
    expect(planSyncRoute({ provider_type: "blink", is_stealth: false })).toBe("or-sync");
  });

  it("treats an absent is_stealth as ordinary", () => {
    // Optional on the wire. Absent must never reclassify a connection as
    // private, which would quietly divert an ordinary sync to the widget.
    expect(planSyncRoute({})).toBe("or-sync");
    expect(planSyncRoute({ provider_type: "strike" })).toBe("or-sync");
  });

  it("keeps bank ahead of private, as the click handler always did", () => {
    // A row carrying both is a shape we have never observed. Pinned so the
    // order is a decision on the record rather than an accident of writing.
    expect(planSyncRoute({ provider_type: "quiltt", is_stealth: true })).toBe("bank");
  });

  it("never routes a private connection to or-sync, in any shape", () => {
    // THE DEFECT. or-sync is the only route that exports vault keys, so this
    // is the assertion that has to hold whatever else changes about the app.
    const privateShapes: SyncRouteCandidate[] = [
      { is_stealth: true },
      { is_stealth: true, provider_type: "blink" },
      { is_stealth: true, provider_type: "strike" },
      { is_stealth: true, provider_type: null },
      { is_stealth: true, provider_type: undefined },
    ];
    for (const conn of privateShapes) {
      expect(planSyncRoute(conn)).not.toBe("or-sync");
    }
  });

  it("cannot be given the kill switch as an input", () => {
    // Structural, and deliberately not a value assertion. The original defect
    // was `isStealthSyncEnabled() && conn.is_stealth`: the switch decided the
    // PATH. No assertion about return values can catch that coming back,
    // because a second parameter would simply be undefined in every test
    // above and every one of them would still pass. The arity is the thing
    // that changes, so the arity is the thing that is pinned.
    //
    // If you are here because this test failed: routing must not consult the
    // switch. The switch belongs inside handleStealthSync, above the key
    // export, where an off switch refuses rather than redirects.
    expect(planSyncRoute.length).toBe(1);
  });
});
