import { describe, expect, it, vi } from "vitest";

import { dispatchSync, type SyncRouteHandlers } from "../sync-dispatch";
import type { SyncRoute } from "../sync-route";

/**
 * These tests exist to make a DELETION fail, not to raise a coverage number.
 * The mapping they pin used to live as three inline `if` blocks in
 * ConnectionsPage.handleSync, where deleting any one of them broke nothing in
 * the repository (OWM-T0590). Judge every case below by asking which mutation
 * it catches; a case that catches none is not worth its runtime.
 */

/** Fresh spies per case, so a leftover call count cannot pass a later test. */
function handlers(): SyncRouteHandlers & {
  bank: ReturnType<typeof vi.fn>;
  private: ReturnType<typeof vi.fn>;
  orSync: ReturnType<typeof vi.fn>;
} {
  return {
    bank: vi.fn(),
    private: vi.fn(),
    orSync: vi.fn(),
  };
}

describe("dispatchSync", () => {
  it("sends a private route to the private handler and to nothing else", async () => {
    const h = handlers();

    await dispatchSync("private", h);

    expect(h.private).toHaveBeenCalledTimes(1);
    expect(h.orSync).not.toHaveBeenCalled();
    expect(h.bank).not.toHaveBeenCalled();
  });

  it("never reaches the or-sync handler for a private route", async () => {
    // Stated separately from the case above even though that case already
    // asserts it. This is the one property the private arm exists for: or-sync
    // is the only path that exports vault keys, so a private connection
    // arriving there is the OWM-T0530 defect restored. A test whose name says
    // what must never happen survives a later edit that "simplifies" the case
    // above into a bare "the private handler ran".
    const h = handlers();

    await dispatchSync("private", h);

    expect(h.orSync).not.toHaveBeenCalled();
  });

  it("sends a bank route to the bank handler and to nothing else", async () => {
    const h = handlers();

    await dispatchSync("bank", h);

    expect(h.bank).toHaveBeenCalledTimes(1);
    expect(h.private).not.toHaveBeenCalled();
    expect(h.orSync).not.toHaveBeenCalled();
  });

  it("sends an ordinary route to the or-sync handler and to nothing else", async () => {
    const h = handlers();

    await dispatchSync("or-sync", h);

    expect(h.orSync).toHaveBeenCalledTimes(1);
    expect(h.private).not.toHaveBeenCalled();
    expect(h.bank).not.toHaveBeenCalled();
  });

  it("waits for an async handler to finish before it resolves", async () => {
    // The caller's loading state and its finally block depend on this. A
    // fire-and-forget dispatch would make a slow or failed sync look instant.
    const order: string[] = [];
    let release: (() => void) | null = null;
    const h = handlers();
    h.orSync.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          release = () => {
            order.push("handler finished");
            resolve();
          };
        }),
    );

    const pending = dispatchSync("or-sync", h).then(() => {
      order.push("dispatch resolved");
    });

    expect(order).toEqual([]);
    release!();
    await pending;

    expect(order).toEqual(["handler finished", "dispatch resolved"]);
  });

  it("lets a handler's rejection reach the caller", async () => {
    // The caller catches and shows the error toast. Swallowing it here would
    // report a failed sync as a successful one.
    const h = handlers();
    h.private.mockRejectedValue(new Error("scan failed"));

    await expect(dispatchSync("private", h)).rejects.toThrow("scan failed");
  });

  it("refuses an unrecognised route instead of falling through to or-sync", async () => {
    // Fail closed. or-sync is the only handler that exports keys, so it must
    // never be where an unplanned value lands. The typecheck catches a new
    // SyncRoute with no arm; this catches a value arriving from outside the
    // type system.
    const h = handlers();

    await expect(dispatchSync("wallet-of-satoshi" as unknown as SyncRoute, h)).rejects.toThrow(
      /no handler for sync route/,
    );
    expect(h.bank).not.toHaveBeenCalled();
    expect(h.private).not.toHaveBeenCalled();
    expect(h.orSync).not.toHaveBeenCalled();
  });

  it("cannot be given the kill switch as an input", () => {
    // ARITY PIN, deliberate, do not remove as noise. The OWM-T0530 defect was
    // the private wallet kill switch being ANDed into the choice of PATH: with
    // the switch off a private connection fell through to the branch that
    // exports two vault keys. sync-route.ts carries the same pin for the same
    // reason. The switch belongs INSIDE the private handler, above any key
    // export, never in the router. No assertion about a return value can catch
    // a third parameter reappearing; this can.
    expect(dispatchSync.length).toBe(2);
  });
});
