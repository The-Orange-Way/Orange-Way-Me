/**
 * Single-connection Sync routing, contract tests.
 *
 * The behaviour these exist to prevent: pressing Sync on a private connection
 * while the private-wallet switch is OFF, and having the press fall through to
 * the ordinary `or-sync` path, which exports the credentials key and the
 * transactions key into the body of a request the server then rejects.
 *
 * Note what is NOT tested here, on purpose. Whether a private wallet is
 * scanned or refused is not a routing decision and is not made by this module:
 * it is made at the door, in handleStealthSync, which re-reads the kill switch
 * at the press. This file pins the property that makes that door the only door
 * there is.
 */

import { describe, it, expect } from "vitest";
import { planSyncRoute } from "../sync-route";

describe("planSyncRoute", () => {
  it("REGRESSION: a private connection routes to the private path, not or-sync", () => {
    // The defect, stated as a test. The condition used to be
    // `switchOn && isPrivate`, so with the switch off this row short-circuited
    // to false and fell through to or-sync with both vault keys in the body.
    expect(planSyncRoute({ is_stealth: true })).toEqual({ kind: "private" });
  });

  it("sends an ordinary connection to or-sync", () => {
    expect(planSyncRoute({ is_stealth: false })).toEqual({ kind: "or-sync" });
  });

  it("treats an absent is_stealth as ordinary, never as private", () => {
    // Same rule as planSyncAll. An older response shape must not be
    // reclassified as private and quietly diverted.
    expect(planSyncRoute({})).toEqual({ kind: "or-sync" });
    expect(planSyncRoute({ provider_type: "blink" })).toEqual({ kind: "or-sync" });
  });

  it("routes a bank connection to the bank dialog", () => {
    expect(planSyncRoute({ provider_type: "quiltt" })).toEqual({ kind: "bank" });
  });

  it("never routes a private connection to or-sync, whatever else the row says", () => {
    // THE PROPERTY THAT KEEPS THE KEYS IN THE BROWSER. `or-sync` is the only
    // route in handleSync that calls exportOrCredsKey and exportOrTxnsKey and
    // puts their results in a request body. A private connection that can
    // never resolve to that route cannot export key material, whatever a later
    // reader does to the order of the branches.
    //
    // Written as a cross product rather than as the single case that broke:
    // a routing bug that only appears for one combination is what shipped last
    // time.
    for (const provider_type of ["quiltt", "blink", "strike", "", undefined]) {
      const route = planSyncRoute({ is_stealth: true, provider_type });
      expect(route.kind).not.toBe("or-sync");
    }
  });
});
