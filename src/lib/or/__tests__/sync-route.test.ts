/**
 * Single-connection Sync routing, contract tests.
 *
 * The failure these exist to prevent: pressing Sync on a private wallet while
 * the kill switch is OFF, and having the press export the credentials key and
 * the transactions key to or-sync instead of refusing (OWM-T0530). The switch
 * was ANDed into the routing decision, so switching it off did not close the
 * door, it selected a different door.
 */

import { describe, it, expect } from "vitest";
import { chooseSyncRoute } from "../sync-route";

describe("chooseSyncRoute", () => {
  it("sends a private wallet to the private wallet path", () => {
    expect(chooseSyncRoute({ is_stealth: true })).toBe("private-wallet");
  });

  it("sends a private wallet to the private wallet path whatever the provider says", () => {
    // A private wallet carries a provider_type like any other row. Only
    // "quiltt" is claimed by the bank dialog; nothing else may reroute it.
    expect(chooseSyncRoute({ provider_type: "blink", is_stealth: true })).toBe("private-wallet");
  });

  it("sends a bank connection to the bank dialog", () => {
    expect(chooseSyncRoute({ provider_type: "quiltt" })).toBe("bank-dialog");
  });

  it("sends an ordinary Bitcoin source to or-sync", () => {
    expect(chooseSyncRoute({ provider_type: "blink" })).toBe("or-sync");
    expect(chooseSyncRoute({ provider_type: "blink", is_stealth: false })).toBe("or-sync");
  });

  it("treats an absent or null is_stealth as ordinary", () => {
    // Optional on the wire. Absent must read as ordinary, never as private:
    // the mirror image of the defect above, and just as wrong.
    expect(chooseSyncRoute({})).toBe("or-sync");
    expect(chooseSyncRoute({ is_stealth: null })).toBe("or-sync");
  });

  it("never routes a private wallet to or-sync, in any shape", () => {
    // or-sync selects from the `connections` table and a private wallet is not
    // in it, so this is not a preference, it is the only correct answer. The
    // or-sync branch is also the one that exports both vault keys, which is
    // what makes a wrong answer here expensive rather than merely useless.
    const shapes = [
      { is_stealth: true },
      { provider_type: null, is_stealth: true },
      { provider_type: "", is_stealth: true },
      { provider_type: "strike", is_stealth: true },
    ];
    for (const conn of shapes) {
      expect(chooseSyncRoute(conn)).not.toBe("or-sync");
    }
  });

  it("takes the connection alone, so the kill switch cannot be folded back into the route", () => {
    // This is the assertion that pins the actual defect. The old condition was
    // `isStealthSyncEnabled() && conn.is_stealth`: with the switch off, a
    // private connection fell through to the key-exporting or-sync branch. The
    // fix is that WHERE a connection syncs depends on the connection only, and
    // the switch decides refuse-or-scan inside the private wallet handler,
    // which re-reads it at the press.
    //
    // Nothing else in TypeScript stops a future edit adding a flag parameter
    // and restoring the old shape, so the arity is asserted on purpose. If this
    // line starts failing, read the reasoning above before changing the number.
    expect(chooseSyncRoute.length).toBe(1);
  });
});
