// Behavioural, end-to-end test of the ow-or-proxy stealth-sync mint gate.
//
// OWM-T0534 added a structural audit (auditMintGate) that reads
// ow-or-proxy/index.ts source and pattern-matches the wiring: it proves the
// right strings are present in the right order, never that either branch
// actually behaves correctly at runtime. This file is the behavioural
// complement: it calls handleOwOrProxyRequest directly with a fake app_flags
// reader and a fake fetch, and drives both directions of the gate for real.
//
// See OW-T0231 (extracted handler.ts so this file has something importable
// to call: the Deno.serve version in index.ts cannot be loaded by vitest at
// all, since it imports supabase-js from an https: URL and reads Deno.env
// at module scope).

import { describe, expect, it, vi } from "vitest";
import {
  handleOwOrProxyRequest,
  type OwOrProxyDeps,
  type OwOrProxyServiceClient,
} from "./handler.ts";

/** A service client whose app_flags read answers with the given `enabled`
 *  value. Also answers the rate-limit RPC with a low count so the gate under
 *  test is never masked by an unrelated 429 or 500. */
function fakeServiceClient(stealthEnabled: boolean | null): OwOrProxyServiceClient {
  return {
    rpc: vi.fn(async () => ({ data: 1, error: null })),
    from: vi.fn(() => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: stealthEnabled === null ? null : { enabled: stealthEnabled },
            error: null,
          }),
        }),
      }),
      upsert: vi.fn(async () => ({ error: null })),
    })),
  };
}

function fakeDeps(
  stealthEnabled: boolean | null,
  fetchImpl: typeof fetch,
): OwOrProxyDeps {
  return {
    createUserClient: () => ({
      auth: {
        getUser: async () => ({ data: { user: { id: "user-1" } }, error: null }),
      },
    }),
    serviceClient: fakeServiceClient(stealthEnabled),
    orGatewayUrl: "https://api.orangerails.dev",
    orPlatformApiKey: "test-platform-key",
    fetchImpl,
  };
}

function mintRequest(): Request {
  return new Request("https://ow.local/functions/v1/ow-or-proxy", {
    method: "POST",
    headers: { Authorization: "Bearer test-jwt" },
    body: JSON.stringify({ endpoint: "or-link-mint-token", payload: {} }),
  });
}

describe("handleOwOrProxyRequest: or-link-mint-token stealth-sync gate", () => {
  it("flag true: the mint proceeds to the outbound OR call and the widget token comes back", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ widget_token: "widget-token-abc123" }), { status: 200 }),
    );
    const deps = fakeDeps(true, fetchMock as unknown as typeof fetch);

    const res = await handleOwOrProxyRequest(mintRequest(), deps);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const calledUrl = String(fetchMock.mock.calls[0]?.[0]);
    expect(calledUrl).toBe("https://api.orangerails.dev/functions/v1/or-link-mint-token");

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.widget_token).toBe("widget-token-abc123");
  });

  it("flag false: refuses before any outbound call, 503, stable code, no widget token in the body", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ widget_token: "should-never-be-seen" }), { status: 200 }),
    );
    const deps = fakeDeps(false, fetchMock as unknown as typeof fetch);

    const res = await handleOwOrProxyRequest(mintRequest(), deps);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(res.status).toBe(503);

    const json = await res.json();
    expect(json.error).toBe("stealth_sync_disabled");

    const rawBody = JSON.stringify(json);
    expect(rawBody).not.toMatch(/widget[_-]?token/i);
  });

  it("a missing app_flags row also refuses (fails closed, same as flag false)", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({}), { status: 200 }));
    const deps = fakeDeps(null, fetchMock as unknown as typeof fetch);

    const res = await handleOwOrProxyRequest(mintRequest(), deps);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.error).toBe("stealth_sync_disabled");
  });
});
