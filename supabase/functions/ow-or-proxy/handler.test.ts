/**
 * OWM-T0231 / OW-T0231. Before this file, no test could execute
 * ow-or-proxy's request logic at all: index.ts called Deno.serve at module
 * scope, read Deno.env at module scope, and imported supabase-js over an
 * https: URL, none of which vitest (Node) can import. The stealth mint
 * gate's allow/refuse branches had only ever been pattern-matched by a
 * structural audit over the source text (_shared/stealth-gate-wiring.test.ts,
 * OWM-T0534), never actually run.
 *
 * The fix (this ticket, "Option A") lifted the request handling out of
 * index.ts into handler.ts with its dependencies -- the Supabase clients,
 * the gateway URL, the platform key, fetch -- passed in rather than read
 * from module scope. That makes handleOrProxyRequest callable here with a
 * fake reader and a fake fetch, so both directions of the gate can finally
 * be asserted end to end: flag true lets the mint proceed, flag false
 * returns a non-2xx response with the stable code stealth_sync_disabled and
 * no widget token anywhere in the response body.
 *
 * This is an extraction, not a rewrite -- the logic under test is unchanged
 * from what index.ts ran before. A handful of non-gate scenarios (missing
 * config, bad auth, rate limiting, the general subaccount-resolution branch)
 * are covered too, so a future edit to handler.ts cannot silently change
 * behaviour the structural audit was never able to see either.
 *
 * ZKA. Every id, key and payload value here is synthetic test fixture data.
 */
import { describe, expect, it, vi } from "vitest";

import { handleOrProxyRequest, type OrProxyDeps } from "./handler.ts";

const USER_ID = "11111111-2222-3333-4444-555555555555";
const AUTH_HEADER = "Bearer synthetic-test-jwt";

function makeRequest(body?: Record<string, unknown>, headers?: Record<string, string>): Request {
  return new Request("https://example.test/ow-or-proxy", {
    method: "POST",
    headers: { Authorization: AUTH_HEADER, ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** A minimal stand-in for the pieces of a SupabaseClient the handler calls. */
function makeServiceClient(opts: {
  rateCount?: number;
  rateError?: { message: string } | null;
  appFlagRow?: { enabled: unknown } | null;
  appFlagError?: { message: string } | null;
  subaccountId?: string | null;
  upserts?: Array<{ table: string; row: unknown; options: unknown }>;
}) {
  const upserts = opts.upserts ?? [];
  return {
    rpc: vi.fn(async (_name: string, _params: unknown) => ({
      data: opts.rateCount ?? 1,
      error: opts.rateError ?? null,
    })),
    from: (table: string) => ({
      select: (_cols: string) => ({
        eq: (_col: string, _val: unknown) => ({
          maybeSingle: async () => {
            if (table === "app_flags") {
              return { data: opts.appFlagRow ?? null, error: opts.appFlagError ?? null };
            }
            if (table === "user_profiles") {
              return {
                data:
                  opts.subaccountId === undefined
                    ? null
                    : opts.subaccountId === null
                      ? null
                      : { or_subaccount_id: opts.subaccountId },
                error: null,
              };
            }
            return { data: null, error: null };
          },
        }),
      }),
      upsert: async (row: unknown, options: unknown) => {
        upserts.push({ table, row, options });
        return { data: null, error: null };
      },
    }),
  };
}

function makeUserClient(user: { id: string } | null = { id: USER_ID }) {
  return {
    auth: {
      getUser: async () =>
        user ? { data: { user }, error: null } : { data: { user: null }, error: { message: "no" } },
    },
  };
}

function baseDeps(overrides: Partial<OrProxyDeps> = {}): OrProxyDeps {
  return {
    serviceClient: makeServiceClient({}) as unknown as OrProxyDeps["serviceClient"],
    createUserClient: () =>
      makeUserClient() as unknown as ReturnType<OrProxyDeps["createUserClient"]>,
    orSupabaseUrl: "https://api.orangerails.dev",
    orPlatformApiKey: "synthetic-platform-key",
    fetchImpl: vi.fn(async () => new Response(JSON.stringify({}), { status: 200 })),
    ...overrides,
  };
}

describe("the stealth mint gate, executed end to end", () => {
  it("flag true lets the mint proceed and the token reaches the client", async () => {
    const orFetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ widget_token: "synthetic-widget-token-abc" }), {
          status: 200,
        }),
    );
    const deps = baseDeps({
      serviceClient: makeServiceClient({
        appFlagRow: { enabled: true },
      }) as unknown as OrProxyDeps["serviceClient"],
      fetchImpl: orFetch,
    });

    const res = await handleOrProxyRequest(
      makeRequest({ endpoint: "or-link-mint-token", payload: {} }),
      deps,
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.widget_token).toBe("synthetic-widget-token-abc");
    expect(orFetch).toHaveBeenCalledTimes(1);
    const [url, init] = orFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.orangerails.dev/functions/v1/or-link-mint-token");
    expect(JSON.parse(init.body as string)).toEqual({
      app_user_id: USER_ID,
      ttl_seconds: undefined,
    });
  });

  it("flag false refuses with the stable code, 503, and no widget token anywhere in the body", async () => {
    const orFetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ widget_token: "should-never-be-reached" }), { status: 200 }),
    );
    const deps = baseDeps({
      serviceClient: makeServiceClient({
        appFlagRow: { enabled: false },
      }) as unknown as OrProxyDeps["serviceClient"],
      fetchImpl: orFetch,
    });

    const res = await handleOrProxyRequest(
      makeRequest({ endpoint: "or-link-mint-token", payload: {} }),
      deps,
    );

    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.error).toBe("stealth_sync_disabled");
    expect(JSON.stringify(json)).not.toContain("token");
    // Fails closed before any request leaves the function: no partial mint.
    expect(orFetch).not.toHaveBeenCalled();
  });

  it.each([
    ["missing row", null],
    ["null enabled", { enabled: null }],
    ["truthy but not boolean", { enabled: "true" }],
    ["read errored", undefined],
  ] as const)("fails closed when the flag reader sees: %s", async (_label, appFlagRow) => {
    const readError = appFlagRow === undefined ? { message: "synthetic read failure" } : null;
    const orFetch = vi.fn(async () => new Response(JSON.stringify({}), { status: 200 }));
    const deps = baseDeps({
      serviceClient: makeServiceClient({
        appFlagRow: appFlagRow ?? null,
        appFlagError: readError,
      }) as unknown as OrProxyDeps["serviceClient"],
      fetchImpl: orFetch,
    });

    const res = await handleOrProxyRequest(
      makeRequest({ endpoint: "or-link-mint-token", payload: {} }),
      deps,
    );

    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("stealth_sync_disabled");
    expect(orFetch).not.toHaveBeenCalled();
  });
});

describe("general request handling, unchanged by the extraction", () => {
  it("answers OPTIONS without touching any dependency", async () => {
    const deps = baseDeps();
    const res = await handleOrProxyRequest(
      new Request("https://example.test/ow-or-proxy", { method: "OPTIONS" }),
      deps,
    );
    expect(res.status).toBe(200);
  });

  it("rejects a non-POST method", async () => {
    const deps = baseDeps();
    const res = await handleOrProxyRequest(
      new Request("https://example.test/ow-or-proxy", { method: "GET" }),
      deps,
    );
    expect(res.status).toBe(405);
  });

  it("refuses when the platform key is not configured", async () => {
    const deps = baseDeps({ orPlatformApiKey: undefined });
    const res = await handleOrProxyRequest(makeRequest({ endpoint: "or-provision" }), deps);
    expect(res.status).toBe(500);
    expect((await res.json()).error).toContain("OR_PLATFORM_API_KEY");
  });

  it("refuses when the gateway URL is not allowed", async () => {
    const deps = baseDeps({ orSupabaseUrl: null });
    const res = await handleOrProxyRequest(makeRequest({ endpoint: "or-provision" }), deps);
    expect(res.status).toBe(500);
  });

  it("401s with no Authorization header", async () => {
    const deps = baseDeps();
    // Built directly rather than via makeRequest, which always sets one.
    const bare = new Request("https://example.test/ow-or-proxy", {
      method: "POST",
      body: JSON.stringify({ endpoint: "or-provision" }),
    });
    const res = await handleOrProxyRequest(bare, deps);
    expect(res.status).toBe(401);
  });

  it("401s when the JWT does not resolve to a user", async () => {
    const deps = baseDeps({
      createUserClient: () =>
        makeUserClient(null) as unknown as ReturnType<OrProxyDeps["createUserClient"]>,
    });
    const res = await handleOrProxyRequest(makeRequest({ endpoint: "or-provision" }), deps);
    expect(res.status).toBe(401);
  });

  it("429s over the per-hour rate limit and sets Retry-After", async () => {
    const deps = baseDeps({
      serviceClient: makeServiceClient({
        rateCount: 61,
      }) as unknown as OrProxyDeps["serviceClient"],
    });
    const res = await handleOrProxyRequest(makeRequest({ endpoint: "or-provision" }), deps);
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).not.toBeNull();
  });

  it("400s an unknown endpoint", async () => {
    const deps = baseDeps();
    const res = await handleOrProxyRequest(makeRequest({ endpoint: "not-a-real-endpoint" }), deps);
    expect(res.status).toBe(400);
  });

  it("resolves subaccount_id server-side and ignores a client-supplied one", async () => {
    const orFetch = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const deps = baseDeps({
      serviceClient: makeServiceClient({
        subaccountId: "sub_server_resolved",
      }) as unknown as OrProxyDeps["serviceClient"],
      fetchImpl: orFetch,
    });

    const res = await handleOrProxyRequest(
      makeRequest({
        endpoint: "or-connection-list",
        payload: { subaccount_id: "sub_client_supplied_should_be_ignored" },
      }),
      deps,
    );

    expect(res.status).toBe(200);
    const [, init] = orFetch.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string).subaccount_id).toBe("sub_server_resolved");
  });

  it("400s when the caller has never provisioned", async () => {
    const deps = baseDeps({
      serviceClient: makeServiceClient({
        subaccountId: null,
      }) as unknown as OrProxyDeps["serviceClient"],
    });
    const res = await handleOrProxyRequest(makeRequest({ endpoint: "or-connection-list" }), deps);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("not provisioned");
  });

  it("upserts the subaccount mapping on a successful or-provision", async () => {
    const upserts: Array<{ table: string; row: unknown; options: unknown }> = [];
    const orFetch = vi.fn(
      async () => new Response(JSON.stringify({ subaccount_id: "sub_new_123" }), { status: 200 }),
    );
    const deps = baseDeps({
      serviceClient: makeServiceClient({ upserts }) as unknown as OrProxyDeps["serviceClient"],
      fetchImpl: orFetch,
    });

    const res = await handleOrProxyRequest(makeRequest({ endpoint: "or-provision" }), deps);

    expect(res.status).toBe(200);
    expect(upserts).toEqual([
      {
        table: "user_profiles",
        row: { user_id: USER_ID, or_subaccount_id: "sub_new_123" },
        options: { onConflict: "user_id" },
      },
    ]);
  });
});
