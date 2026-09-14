/**
 * or-sync request contract tests.
 *
 * The credentials key is still needed transiently by Orange Rails. The
 * transactions key is deliberately absent: `format: orangeway-me` selects a
 * response sink, and the client requires positive format evidence in the
 * response before it accepts any plaintext draft.
 */

import { describe, it, expect, vi } from "vitest";
import {
  requestOrSync,
  OrSyncRouteRefusal,
  OrSyncSinkContractError,
  OR_SYNC_FORMAT,
  type OrSyncConnection,
  type OrSyncHandover,
} from "../or-sync-request";

function sinkResponse(overrides: Record<string, unknown> = {}) {
  return {
    synced: 0,
    connections: [],
    rows: {},
    metadata: { format: OR_SYNC_FORMAT, requires_encryption: [] },
    ...overrides,
  };
}

function spyHandover(response: unknown = sinkResponse()) {
  return {
    exportCredentialsKey: vi.fn(async () => "creds-key-b64"),
    callProxy: vi.fn(async (_endpoint: string, _payload: Record<string, unknown>) => response),
  } satisfies OrSyncHandover;
}

function callCounts(h: ReturnType<typeof spyHandover>) {
  return {
    creds: h.exportCredentialsKey.mock.calls.length,
    proxy: h.callProxy.mock.calls.length,
  };
}

describe("requestOrSync", () => {
  it("sends an ordinary source through the sink without transactions_key", async () => {
    const h = spyHandover(
      sinkResponse({ synced: 3, connections: [{ connection_id: "c1", synced: 3 }] }),
    );
    const res = await requestOrSync("sub-1", [{ id: "c1", provider_type: "blink" }], h);

    expect(res.synced).toBe(3);
    expect(h.callProxy).toHaveBeenCalledWith("or-sync", {
      subaccount_id: "sub-1",
      connection_ids: ["c1"],
      credentials_key: "creds-key-b64",
      format: OR_SYNC_FORMAT,
    });
    expect(h.callProxy.mock.calls[0]?.[1]).not.toHaveProperty("transactions_key");
  });

  it("requires response evidence that Orange Rails took the sink branch", async () => {
    const h = spyHandover({
      synced: 1,
      connections: [{ connection_id: "c1", synced: 1 }],
      rows: {},
      metadata: { format: "legacy", requires_encryption: [] },
    });

    await expect(
      requestOrSync("sub-1", [{ id: "c1", provider_type: "blink" }], h),
    ).rejects.toBeInstanceOf(OrSyncSinkContractError);
    expect(h.callProxy.mock.calls[0]?.[1]).not.toHaveProperty("transactions_key");
  });

  it("does not attach a plaintext response to a sink contract error", async () => {
    const privateValue = "merchant-private-value";
    const h = spyHandover({ rows: { transactions: [{ enc_description: privateValue }] } });
    const err = await requestOrSync("sub-1", [{ id: "c1", provider_type: "blink" }], h).catch(
      (cause) => cause,
    );

    expect(err).toBeInstanceOf(OrSyncSinkContractError);
    expect(String(err)).not.toContain(privateValue);
    expect(err).not.toHaveProperty("body");
  });

  it("refuses a private connection before exporting credentials", async () => {
    const h = spyHandover();
    await expect(
      requestOrSync("sub-1", [{ id: "c1", is_stealth: true }], h),
    ).rejects.toBeInstanceOf(OrSyncRouteRefusal);
    expect(callCounts(h)).toEqual({ creds: 0, proxy: 0 });
  });

  it("refuses every private row shape before exporting credentials", async () => {
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
      expect(callCounts(h)).toEqual({ creds: 0, proxy: 0 });
    }
  });

  it("refuses a bank connection before exporting credentials", async () => {
    const h = spyHandover();
    await expect(
      requestOrSync("sub-1", [{ id: "c1", provider_type: "quiltt" }], h),
    ).rejects.toBeInstanceOf(OrSyncRouteRefusal);
    expect(callCounts(h)).toEqual({ creds: 0, proxy: 0 });
  });

  it("refuses a whole batch when one member is private", async () => {
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
    expect(callCounts(h)).toEqual({ creds: 0, proxy: 0 });
  });

  it("names the route and connection it refused", async () => {
    const h = spyHandover();
    const err = await requestOrSync("sub-1", [{ id: "c9", is_stealth: true }], h).catch(
      (cause) => cause,
    );
    expect(err).toBeInstanceOf(OrSyncRouteRefusal);
    expect((err as OrSyncRouteRefusal).route).toBe("private");
    expect((err as OrSyncRouteRefusal).connectionId).toBe("c9");
  });

  it("treats absent is_stealth as ordinary", async () => {
    const h = spyHandover();
    await requestOrSync("sub-1", [{ id: "c1" }], h);
    expect(h.callProxy).toHaveBeenCalledTimes(1);
  });

  it("sends and exports nothing for an empty list", async () => {
    const h = spyHandover();
    const res = await requestOrSync("sub-1", [], h);
    expect(res).toEqual(sinkResponse());
    expect(callCounts(h)).toEqual({ creds: 0, proxy: 0 });
  });

  it("cannot be given the kill switch as an input", () => {
    expect(requestOrSync.length).toBe(3);
  });
});
