/**
 * Single-connection Sync routing, contract tests.
 *
 * The behaviour these exist to prevent: pressing Sync on a private connection
 * while the private-wallet switch is OFF, and having the press fall through to
 * the ordinary `or-sync` path, which exports the credentials key and the
 * transactions key into the body of a request the server then rejects.
 */

import { describe, it, expect } from "vitest";
import { planSyncRoute, PRIVATE_SYNC_DISABLED_MESSAGE } from "../sync-route";

describe("planSyncRoute", () => {
  it("REGRESSION: refuses a private connection when the switch is off", () => {
    // The defect, stated as a test. The old condition was
    // `switchOn && isPrivate`, so this case short-circuited to false and fell
    // through to the or-sync branch with both vault keys in the body.
    expect(planSyncRoute({ is_stealth: true }, { stealthSyncEnabled: false })).toEqual({
      kind: "private-refused",
    });
  });

  it("scans a private connection when the switch is on", () => {
    expect(planSyncRoute({ is_stealth: true }, { stealthSyncEnabled: true })).toEqual({
      kind: "private-scan",
    });
  });

  it("sends an ordinary connection to or-sync in either switch state", () => {
    // The switch is about private wallets only. It must not change anything
    // for an ordinary Bitcoin source, in either direction.
    expect(planSyncRoute({ is_stealth: false }, { stealthSyncEnabled: true })).toEqual({
      kind: "or-sync",
    });
    expect(planSyncRoute({ is_stealth: false }, { stealthSyncEnabled: false })).toEqual({
      kind: "or-sync",
    });
  });

  it("treats an absent is_stealth as ordinary, never as private", () => {
    // Same rule as planSyncAll. An older response shape must not be
    // reclassified as private and quietly refused.
    expect(planSyncRoute({}, { stealthSyncEnabled: false })).toEqual({ kind: "or-sync" });
    expect(planSyncRoute({}, { stealthSyncEnabled: true })).toEqual({ kind: "or-sync" });
  });

  it("routes a bank connection to the bank dialog whatever the switch says", () => {
    expect(
      planSyncRoute({ provider_type: "quiltt" }, { stealthSyncEnabled: false }),
    ).toEqual({ kind: "bank" });
    expect(planSyncRoute({ provider_type: "quiltt" }, { stealthSyncEnabled: true })).toEqual({
      kind: "bank",
    });
  });

  it("never routes a private connection to or-sync, in any state", () => {
    // THE PROPERTY THAT MAKES THE KEY EXPORT UNREACHABLE. `or-sync` is the
    // only route in handleSync that calls exportOrCredsKey and exportOrTxnsKey
    // and puts their results in a request body. If a private connection can
    // never resolve to that route, no press on a private connection can export
    // key material, whatever a later reader does to the order of the branches.
    //
    // Written as the full cross product rather than as the cases above
    // repeated: a routing bug that only appears for one combination is exactly
    // what shipped last time.
    for (const stealthSyncEnabled of [true, false]) {
      for (const provider_type of ["quiltt", "blink", "strike", undefined]) {
        const route = planSyncRoute({ is_stealth: true, provider_type }, { stealthSyncEnabled });
        expect(route.kind).not.toBe("or-sync");
      }
    }
  });

  it("says nothing was sent when it refuses", () => {
    // A customer, and a support conversation, must be able to tell this
    // refusal apart from a request that went out and failed.
    expect(PRIVATE_SYNC_DISABLED_MESSAGE).toContain("Nothing was sent");
  });
});
