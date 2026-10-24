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
import {
  dispatchSync,
  planSyncRoute,
  type SyncDispatchHandlers,
  type SyncRouteCandidate,
} from "../sync-route";

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

/**
 * dispatchSync is the other half of the same decision: given a route, run
 * that handler and no other. The defect this pins (OWM-T0590) is not a wrong
 * route from planSyncRoute, it is a missing arm at the call site: delete the
 * private branch from handleSync and the press falls through to requestOrSync.
 * requestOrSync refuses, so no key leaves, but the user gets "Sync failed"
 * instead of the private scan. Injected handlers let a test catch that
 * without rendering ConnectionsPage.
 */
function recordingHandlers(): { ran: string[]; handlers: SyncDispatchHandlers } {
  const ran: string[] = [];
  return {
    ran,
    handlers: {
      bank: () => {
        ran.push("bank");
      },
      private: () => {
        ran.push("private");
      },
      "or-sync": () => {
        ran.push("or-sync");
      },
    },
  };
}

describe("dispatchSync", () => {
  it("runs the private handler and not the or-sync handler for route private", () => {
    // THE DEFECT, OWM-T0590. A private Sync press must not reach the handler
    // that calls requestOrSync. That call still refuses, so this is a UX
    // regression rather than a key leak, but it is the regression the ticket
    // exists to make a failing test.
    const { ran, handlers } = recordingHandlers();
    void dispatchSync("private", handlers);
    expect(ran).toEqual(["private"]);
  });

  it("runs the or-sync handler and not the private handler for route or-sync", () => {
    const { ran, handlers } = recordingHandlers();
    void dispatchSync("or-sync", handlers);
    expect(ran).toEqual(["or-sync"]);
  });

  it("runs the bank handler and neither of the others", () => {
    const { ran, handlers } = recordingHandlers();
    void dispatchSync("bank", handlers);
    expect(ran).toEqual(["bank"]);
  });

  it("returns the private handler's promise so the caller can await the scan", async () => {
    // If dispatchSync forgets to return the handler result, handleSync's
    // `await dispatchSync(...)` resolves before the scan has started, and a
    // test with only sync handlers would still pass.
    const ran: string[] = [];
    await dispatchSync("private", {
      bank: () => {
        ran.push("bank");
      },
      private: async () => {
        await Promise.resolve();
        ran.push("private");
      },
      "or-sync": () => {
        ran.push("or-sync");
      },
    });
    expect(ran).toEqual(["private"]);
  });

  it("cannot be given the kill switch as an input", () => {
    // Same structural pin as planSyncRoute. A third parameter would read as
    // undefined in every test above and all of them would still pass.
    expect(dispatchSync.length).toBe(2);
  });
});
