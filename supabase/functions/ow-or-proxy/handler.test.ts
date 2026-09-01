/**
 * The private wallet kill switch as it is actually WIRED, not as a pure
 * function (OWM-T0534).
 *
 * stealth-flag.test.ts has nine cases and every one of them calls
 * readStealthSyncEnabled directly with a hand written reader. They prove the
 * reader is correct. They cannot prove it is CONSULTED, that the refusal sits
 * on the or-link-mint-token branch rather than another, that it returns the
 * stable code, or that it returns before anything leaves this function. Those
 * are the claims that decay: moving the block below the outbound body
 * assembly, inverting the condition, or repointing the reader at a different
 * row passes all nine of them, passes both typechecks and passes the leak
 * scan.
 *
 * BOTH DIRECTIONS ARE ASSERTED AND THAT IS DELIBERATE. A test that can only
 * ever assert "closed" is indistinguishable from a gate that is stuck closed,
 * and the production flag is false, so nothing else would tell us. Switch on
 * must mint; switch off must refuse.
 *
 * The heaviest assertion here is that callOr is never reached while the switch
 * is off. A refusal that runs after the outbound request has left is a refusal
 * of the response, not of the mint, and the widget token would already exist.
 */

import { describe, expect, it } from "vitest";

import {
  STEALTH_SYNC_DISABLED_ERROR,
  STEALTH_SYNC_DISABLED_MESSAGE,
  STEALTH_SYNC_FLAG_KEY,
} from "../_shared/stealth-flag.ts";
import { handleProxyRequest, type ProxyDeps } from "./handler.ts";

const USER_ID = "user-1";

/** Distinctive on purpose: the refusal assertions search the body for it. */
const WIDGET_TOKEN = "widget-token-must-not-be-minted-while-off";

interface OutboundCall {
  endpoint: string;
  body: Record<string, unknown>;
}

interface Harness {
  deps: ProxyDeps;
  /** Every call that left the function, in order. Empty is the refusal case. */
  outbound: OutboundCall[];
  /** Which app_flags keys were read, so "consulted a flag" is not enough. */
  flagKeysRead: string[];
}

/**
 * `flagRow` is whatever the injected read resolves to, so a test can supply a
 * Supabase shaped answer, a broken one, or a thrown error.
 */
function harness(options: {
  flagRow?: () => Promise<unknown>;
} = {}): Harness {
  const outbound: OutboundCall[] = [];
  const flagKeysRead: string[] = [];

  const deps: ProxyDeps = {
    platformApiKeyConfigured: true,
    gatewayAllowed: true,
    getUser: async () => ({ id: USER_ID }),
    incrementRateLimit: async () => ({ count: 1, error: null }),
    readStealthFlagRow: async (key: string) => {
      flagKeysRead.push(key);
      const read = options.flagRow ?? (async () => ({ data: { enabled: true }, error: null }));
      return await read();
    },
    getSubaccountId: async () => "subaccount-1",
    saveSubaccountId: async () => {},
    callOr: async (endpoint: string, body: Record<string, unknown>) => {
      outbound.push({ endpoint, body });
      return new Response(JSON.stringify({ widget_token: WIDGET_TOKEN, ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  };

  return { deps, outbound, flagKeysRead };
}

function proxyRequest(endpoint: string, payload: Record<string, unknown> = {}): Request {
  return new Request("https://example.test/functions/v1/ow-or-proxy", {
    method: "POST",
    headers: {
      Authorization: "Bearer a-valid-looking-jwt",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ endpoint, payload }),
  });
}

describe("ow-or-proxy: private wallet kill switch on the mint", () => {
  it("mints when the switch is on", async () => {
    const h = harness({ flagRow: async () => ({ data: { enabled: true }, error: null }) });

    const res = await handleProxyRequest(proxyRequest("or-link-mint-token"), h.deps);
    const body = (await res.json()) as { widget_token?: string };

    expect(res.status).toBe(200);
    expect(body.widget_token).toBe(WIDGET_TOKEN);
    expect(h.outbound).toEqual([
      { endpoint: "or-link-mint-token", body: { app_user_id: USER_ID, ttl_seconds: undefined } },
    ]);
  });

  it("refuses with the stable code, and mints nothing, when the switch is off", async () => {
    const h = harness({ flagRow: async () => ({ data: { enabled: false }, error: null }) });

    const res = await handleProxyRequest(proxyRequest("or-link-mint-token"), h.deps);
    const text = await res.text();

    expect(res.status).toBe(503);
    expect(JSON.parse(text)).toEqual({
      error: STEALTH_SYNC_DISABLED_ERROR,
      message: STEALTH_SYNC_DISABLED_MESSAGE,
    });

    // The ordering claim, which is the one review cannot keep proving: the
    // refusal has to happen BEFORE the outbound request is built and sent. If
    // this list is not empty, a token was minted and then discarded.
    expect(h.outbound).toEqual([]);

    // And nothing token shaped came back to the browser on the refusal path.
    expect(text).not.toContain(WIDGET_TOKEN);
    expect(text).not.toContain("widget_token");
  });

  it("refuses when the flag row is missing", async () => {
    // maybeSingle() answers data: null with no error when the key is absent.
    const h = harness({ flagRow: async () => ({ data: null, error: null }) });

    const res = await handleProxyRequest(proxyRequest("or-link-mint-token"), h.deps);

    expect(res.status).toBe(503);
    expect(h.outbound).toEqual([]);
  });

  it("refuses when the flag read throws", async () => {
    const h = harness({
      flagRow: async () => {
        throw new Error("database unreachable");
      },
    });

    const res = await handleProxyRequest(proxyRequest("or-link-mint-token"), h.deps);

    expect(res.status).toBe(503);
    expect(h.outbound).toEqual([]);
  });

  it("consults the private wallet switch and no other row", async () => {
    // Guards against the reader being repointed at another key, which no
    // status code assertion above would notice.
    const h = harness();

    await handleProxyRequest(proxyRequest("or-link-mint-token"), h.deps);

    expect(h.flagKeysRead).toEqual([STEALTH_SYNC_FLAG_KEY]);
  });
});

describe("ow-or-proxy: the switch gates the mint and only the mint", () => {
  it("still proxies an ordinary sync while the switch is off", async () => {
    // The other half of "the refusal is on the right branch". A gate that
    // refused everything would pass every assertion in the block above while
    // taking the whole product down with it.
    const h = harness({ flagRow: async () => ({ data: { enabled: false }, error: null }) });

    const res = await handleProxyRequest(
      proxyRequest("or-sync", { connection_ids: ["conn-1"] }),
      h.deps,
    );

    expect(res.status).toBe(200);
    expect(h.outbound.map((c) => c.endpoint)).toEqual(["or-sync"]);
  });

  it("does not read the switch at all on an endpoint that is not the mint", async () => {
    const h = harness();

    await handleProxyRequest(proxyRequest("or-connection-list"), h.deps);

    expect(h.flagKeysRead).toEqual([]);
  });
});
