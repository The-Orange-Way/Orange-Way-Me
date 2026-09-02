import { describe, expect, it } from "vitest";

import { dispatchSync } from "../sync-dispatch";
import type { SyncRouteCandidate } from "../sync-route";

const PRIVATE: SyncRouteCandidate = { provider_type: "blink", is_stealth: true };
const ORDINARY: SyncRouteCandidate = { provider_type: "blink", is_stealth: false };
const BANK: SyncRouteCandidate = { provider_type: "quiltt", is_stealth: false };
/** Older response shape. An absent field must read as ordinary, never as private. */
const NO_FIELD: SyncRouteCandidate = { provider_type: "strike" };

/**
 * A stand in for the real effects, which records what was ISSUED rather than
 * which function was called.
 *
 * The or-sync handler builds the same request body the component builds, keys
 * included, because the property under test is that no request carrying key
 * material is issued for a private connection. "handleStealthSync was called"
 * would pass just as well with a second, unnoticed call to or-sync sitting
 * next to it; "nothing was issued" cannot.
 */
function recorder() {
  const calls: string[] = [];
  const issued: Array<Record<string, unknown>> = [];
  return {
    calls,
    issued,
    handlers: {
      bank: (conn: SyncRouteCandidate) => {
        calls.push(`bank:${conn.provider_type}`);
      },
      private: (conn: SyncRouteCandidate) => {
        calls.push(`private:${conn.provider_type}`);
      },
      orSync: (conn: SyncRouteCandidate) => {
        calls.push(`orSync:${conn.provider_type}`);
        issued.push({
          connection_ids: [conn.provider_type],
          credentials_key: "exported-credentials-key",
          transactions_key: "exported-transactions-key",
        });
      },
    },
  };
}

const carriesKeyMaterial = (body: Record<string, unknown>) =>
  "credentials_key" in body || "transactions_key" in body;

describe("dispatchSync", () => {
  it("issues NO key carrying request for a private connection", async () => {
    const r = recorder();
    await dispatchSync(PRIVATE, r.handlers);
    expect(r.issued.filter(carriesKeyMaterial)).toEqual([]);
    expect(r.issued).toEqual([]);
  });

  it("sends a private connection to the private handler and nowhere else", async () => {
    const r = recorder();
    const route = await dispatchSync(PRIVATE, r.handlers);
    expect(route).toBe("private");
    expect(r.calls).toEqual(["private:blink"]);
  });

  /**
   * The kill switch, covered by arity rather than by a value.
   *
   * The defect this whole chain came from was a switch ANDed into the routing
   * decision, so an OFF switch selected the key exporting branch instead of
   * refusing. The fix was to give the decision no access to the switch at all.
   * A test that passed the flag both ways would be testing a parameter that
   * must not exist; pinning the arity tests the thing that actually holds, and
   * it fails the moment a flag parameter comes back.
   */
  it("cannot be given the kill switch as an input, in either state", () => {
    expect(dispatchSync.length).toBe(2);
  });

  it("sends an ordinary Bitcoin source to or-sync, which is the path that exports keys", async () => {
    const r = recorder();
    const route = await dispatchSync(ORDINARY, r.handlers);
    expect(route).toBe("or-sync");
    expect(r.calls).toEqual(["orSync:blink"]);
    expect(r.issued.filter(carriesKeyMaterial)).toHaveLength(1);
  });

  it("sends a bank connection to the bank dialog and issues nothing", async () => {
    const r = recorder();
    const route = await dispatchSync(BANK, r.handlers);
    expect(route).toBe("bank");
    expect(r.calls).toEqual(["bank:quiltt"]);
    expect(r.issued).toEqual([]);
  });

  it("treats a connection with no is_stealth field as ordinary, not private", async () => {
    const r = recorder();
    expect(await dispatchSync(NO_FIELD, r.handlers)).toBe("or-sync");
  });

  it("runs exactly one handler for every shape, so no press can take two paths", async () => {
    for (const conn of [PRIVATE, ORDINARY, BANK, NO_FIELD]) {
      const r = recorder();
      await dispatchSync(conn, r.handlers);
      expect(r.calls).toHaveLength(1);
    }
  });

  it("awaits an async handler before it returns, so the caller cannot race the effect", async () => {
    const order: string[] = [];
    const route = await dispatchSync(PRIVATE, {
      bank: () => {
        order.push("bank");
      },
      private: async () => {
        await Promise.resolve();
        order.push("private-finished");
      },
      orSync: () => {
        order.push("orSync");
      },
    });
    order.push("dispatch-returned");
    expect(route).toBe("private");
    expect(order).toEqual(["private-finished", "dispatch-returned"]);
  });
});
