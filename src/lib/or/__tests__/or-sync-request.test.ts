/**
 * or-sync request contract tests.
 *
 * WHAT THESE DEFEND. or-sync is the only path that takes the credentials key
 * and the transactions key out of the vault. The behaviour being pinned is
 * that a connection which does not belong on this path never gets that far:
 * no export, no request, no key anywhere.
 *
 * WHY THE ASSERTIONS ARE ABOUT ABSENCE. The defect this module exists to make
 * unreachable (OWM-T0530) was not a wrong branch body. Both keys were exported
 * and posted for a private connection, and or-sync then answered 400. A 400 is
 * not a defence: it is raised on the far side, after the body carrying the keys
 * has already left the browser. So "was it rejected" is the wrong question and
 * "did anything leave" is the right one.
 */

import { describe, it, expect, vi } from "vitest";
import {
  requestOrSync,
  OrSyncRouteRefusal,
  type OrSyncConnection,
  type OrSyncKeyHandover,
} from "../or-sync-request";

/**
 * A handover whose three surfaces are all spies, so a test can assert that
 * nothing was called rather than that something else was.
 */
function spyHandover(response: unknown = { synced: 0, connections: [] }) {
  return {
    exportCredentialsKey: vi.fn(async () => "creds-key-b64"),
    exportTransactionsKey: vi.fn(async () => "txns-key-b64"),
    callProxy: vi.fn(async () => response),
  } satisfies OrSyncKeyHandover;
}

/** Every call count this module must be able to hold at zero. */
function callCounts(h: ReturnType<typeof spyHandover>) {
  return {
    creds: h.exportCredentialsKey.mock.calls.length,
    txns: h.exportTransactionsKey.mock.calls.length,
    proxy: h.callProxy.mock.calls.length,
  };
}

describe("requestOrSync", () => {
  it("sends an ordinary Bitcoin source, with both keys and the ids asked for", async () => {
    const h = spyHandover({ synced: 3, connections: [{ connection_id: "c1", synced: 3 }] });
    const res = await requestOrSync("sub-1", [{ id: "c1", provider_type: "blink" }], h);

    expect(res.synced).toBe(3);
    expect(h.callProxy).toHaveBeenCalledTimes(1);
    expect(h.callProxy).toHaveBeenCalledWith("or-sync", {
      subaccount_id: "sub-1",
      connection_ids: ["c1"],
      credentials_key: "creds-key-b64",
      transactions_key: "txns-key-b64",
    });
  });

  it("refuses a private connection without exporting either key", async () => {
    // THE DEFECT, OWM-T0530. This is the assertion the whole module exists
    // for: not that the private handler ran instead, but that nothing left.
    const h = spyHandover();
    await expect(requestOrSync("sub-1", [{ id: "c1", is_stealth: true }], h)).rejects.toBeInstanceOf(
      OrSyncRouteRefusal,
    );
    expect(callCounts(h)).toEqual({ creds: 0, txns: 0, proxy: 0 });
  });

  it("refuses a private connection whatever else the row carries", async () => {
    // The same shapes sync-route.test.ts pins, carried through to the key
    // handover, so a routing rule that stopped agreeing with this function
    // fails here and not only there.
    const privateShapes: OrSyncConnection[] = [
      { id: "a", is_stealth: true },
      { id: "b", is_stealth: true, provider_type: "blink" },
      { id: "c", is_stealth: true, provider_type: "strike" },
      { id: "d", is_stealth: true, provider_type: null },
      { id: "e", is_stealth: true, provider_type: undefined },
    ];
    for (const conn of privateShapes) {
      const h = spyHandover();
      await expect(requestOrSync("sub-1", [conn], h)).rejects.toBeInstanceOf(OrSyncRouteRefusal);
      expect(callCounts(h)).toEqual({ creds: 0, txns: 0, proxy: 0 });
    }
  });

  it("refuses a bank connection without exporting either key", async () => {
    // Bank connections sync through the OPK sealed-box path. They have never
    // been sent here, and this makes that a property of the function rather
    // than of the caller that has always happened to route them away.
    const h = spyHandover();
    await expect(
      requestOrSync("sub-1", [{ id: "c1", provider_type: "quiltt" }], h),
    ).rejects.toBeInstanceOf(OrSyncRouteRefusal);
    expect(callCounts(h)).toEqual({ creds: 0, txns: 0, proxy: 0 });
  });

  it("refuses a whole batch when one member is private, and exports nothing", async () => {
    // The bulk press shape. planSyncAll already holds private connections
    // back, so this is the net under it: one bad member must not carry the
    // keys out on behalf of the good ones. Private is placed LAST on purpose,
    // because a per-item check would have exported for the first two by the
    // time it reached this one.
    const h = spyHandover();
    await expect(
      requestOrSync(
        "sub-1",
        [
          { id: "ok-1", provider_type: "blink" },
          { id: "ok-2", provider_type: "strike" },
          { id: "private-1", is_stealth: true },
        ],
        h,
      ),
    ).rejects.toBeInstanceOf(OrSyncRouteRefusal);
    expect(callCounts(h)).toEqual({ creds: 0, txns: 0, proxy: 0 });
  });

  it("names the route and the connection it refused", async () => {
    // So the console line says why, rather than leaving someone to guess
    // which of several connections in a batch was the bad one.
    const h = spyHandover();
    const err = await requestOrSync("sub-1", [{ id: "c9", is_stealth: true }], h).catch((e) => e);
    expect(err).toBeInstanceOf(OrSyncRouteRefusal);
    expect((err as OrSyncRouteRefusal).route).toBe("private");
    expect((err as OrSyncRouteRefusal).connectionId).toBe("c9");
  });

  it("treats an absent is_stealth as ordinary, and syncs it", async () => {
    // Absent must read as ordinary, never as private. The opposite bug would
    // quietly stop ordinary connections from syncing at all.
    const h = spyHandover();
    await requestOrSync("sub-1", [{ id: "c1" }], h);
    expect(h.callProxy).toHaveBeenCalledTimes(1);
  });

  it("sends nothing and exports nothing for an empty list", async () => {
    // An empty list is not an error, it is nothing to do. Asking or-sync
    // about no connections and interpreting the answer is worse than not
    // asking, and it would still have exported two keys to do it.
    const h = spyHandover();
    const res = await requestOrSync("sub-1", [], h);
    expect(res).toBeUndefined();
    expect(callCounts(h)).toEqual({ creds: 0, txns: 0, proxy: 0 });
  });

  it("cannot be given the kill switch as an input", async () => {
    // Structural, and deliberately not a value assertion. The original defect
    // was `isStealthSyncEnabled() && conn.is_stealth`: the switch decided the
    // PATH, so switching the feature off moved a private connection onto this
    // one. A fourth parameter would read as undefined in every test above and
    // all of them would still pass, so the arity is what gets pinned.
    //
    // If you are here because this failed: the switch does not belong in this
    // function. It decides refuse-or-scan inside handleStealthSync, above that
    // path's own key export. Routing asks only what the connection IS.
    expect(requestOrSync.length).toBe(3);
  });
});
