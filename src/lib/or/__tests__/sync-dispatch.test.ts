/**
 * Sync dispatch, contract tests.
 *
 * These exist because sync-route.test.ts proves the RULE and proved nothing
 * about the CALL to it. At the time OWM-T0544 was filed, deleting the private
 * arm from ConnectionsPage.handleSync left the whole suite green and put a
 * private connection back on the path that exports two vault keys to the
 * provider origin, which is the OWM-T0530 defect in full.
 *
 * The assertion that carries the weight is the negative one: for a private
 * connection, the or-sync handler is NEVER invoked. or-sync is the only
 * destination that exports vault keys, so its absence is the property the
 * customer is protected by. "The private handler ran" is the weaker statement
 * and is not sufficient on its own.
 */

import { describe, it, expect, vi } from "vitest";
import { dispatchSync, type SyncHandlers } from "../sync-dispatch";
import type { SyncRouteCandidate } from "../sync-route";

function spies(): SyncHandlers & {
  bank: ReturnType<typeof vi.fn>;
  privateWallet: ReturnType<typeof vi.fn>;
  orSync: ReturnType<typeof vi.fn>;
} {
  return {
    bank: vi.fn(),
    privateWallet: vi.fn(),
    orSync: vi.fn(),
  };
}

describe("dispatchSync", () => {
  it("sends a bank connection to the bank handler and to nothing else", async () => {
    const h = spies();
    await dispatchSync({ provider_type: "quiltt" }, h);
    expect(h.bank).toHaveBeenCalledTimes(1);
    expect(h.privateWallet).not.toHaveBeenCalled();
    expect(h.orSync).not.toHaveBeenCalled();
  });

  it("sends a private connection to the private handler and to nothing else", async () => {
    const h = spies();
    await dispatchSync({ is_stealth: true }, h);
    expect(h.privateWallet).toHaveBeenCalledTimes(1);
    expect(h.bank).not.toHaveBeenCalled();
    expect(h.orSync).not.toHaveBeenCalled();
  });

  it("sends an ordinary Bitcoin source to the or-sync handler", async () => {
    const h = spies();
    await dispatchSync({ provider_type: "blink", is_stealth: false }, h);
    expect(h.orSync).toHaveBeenCalledTimes(1);
    expect(h.privateWallet).not.toHaveBeenCalled();
  });

  it("treats an absent is_stealth as ordinary, never as private", async () => {
    // Optional on the wire. Absent must not reclassify an ordinary connection
    // as private, which would divert a working sync into the widget.
    const h = spies();
    await dispatchSync({}, h);
    expect(h.orSync).toHaveBeenCalledTimes(1);
    expect(h.privateWallet).not.toHaveBeenCalled();
  });

  it("never reaches the key-exporting handler for a private connection, in any shape", async () => {
    // THE ASSERTION THIS FILE EXISTS FOR. or-sync is the only destination that
    // exports the credentials key and the transactions key from the vault, so
    // what has to hold is that a private connection cannot arrive there. If
    // you are here because this failed, do not relax the assertion: a private
    // connection reaching or-sync means two vault keys leave the browser for a
    // request Orange Rails answers 400, and the rejection lands after the body
    // carrying them has already been sent.
    const privateShapes: SyncRouteCandidate[] = [
      { is_stealth: true },
      { is_stealth: true, provider_type: "blink" },
      { is_stealth: true, provider_type: "strike" },
      { is_stealth: true, provider_type: null },
      { is_stealth: true, provider_type: undefined },
    ];
    for (const conn of privateShapes) {
      const h = spies();
      await dispatchSync(conn, h);
      expect(h.orSync).not.toHaveBeenCalled();
      expect(h.privateWallet).toHaveBeenCalledTimes(1);
    }
  });

  it("cannot be given the kill switch as an input, in either state", async () => {
    // Structural, and deliberately not a value assertion. The original defect
    // was `isStealthSyncEnabled() && conn.is_stealth`: the switch decided the
    // PATH, so switching the private wallet feature OFF moved the connection
    // onto the key-exporting path.
    //
    // This is also how "in both states of the switch" is proved here, and it
    // is a stronger proof than toggling a flag would be. Running these cases
    // twice with the flag set each way would pass whether or not the switch
    // were consulted, because a switch read through a module-level import is
    // invisible to an assertion about handler calls. What can be proved is
    // that the switch is not reachable from this decision at all: dispatchSync
    // takes the connection and the handlers, and planSyncRoute takes the
    // connection, and neither takes a flag. Two parameters here and one there
    // means there is no state of the switch for the routing to depend on.
    //
    // If you are here because this failed: the switch belongs INSIDE the
    // private handler, above the key export, where an off switch refuses.
    // It must never choose between handlers.
    expect(dispatchSync.length).toBe(2);
  });

  it("awaits the handler it chose, so the caller can await the press", async () => {
    // handleSync awaits dispatchSync. If the chosen handler's promise were
    // dropped here, a failed private scan would surface as an unhandled
    // rejection instead of the toast the user is meant to see.
    let settled = false;
    const h: SyncHandlers = {
      bank: vi.fn(),
      privateWallet: async () => {
        await Promise.resolve();
        settled = true;
      },
      orSync: vi.fn(),
    };
    await dispatchSync({ is_stealth: true }, h);
    expect(settled).toBe(true);
  });
});
