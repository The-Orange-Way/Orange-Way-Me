/**
 * @vitest-environment node
 *
 * Tests for openOrConnect() — OW's entry point into OR's hosted
 * /connect widget. The function does three things worth covering:
 *
 *   1. Mints a widget_token via ow-or-proxy.
 *   2. Builds the /connect URL (with or without provider, fragment-carries
 *      cred_key / txn_key / widget_token).
 *   3. Resolves / rejects on postMessage / popup-close / popup-blocked.
 *
 * We don't drive a real popup; window.open is stubbed. The real cross-
 * origin postMessage flow is covered by the OR repo's own connect.tsx
 * tests + a manual smoke step documented in the PR body.
 *
 * Vitest runs in the "node" environment for this repo, so we wire a
 * minimal `window` shim onto globalThis (EventTarget + open/setInterval/
 * clearInterval/removeEventListener/addEventListener/location). No
 * jsdom dependency required.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { OR_LINK_SUCCESS, OR_LINK_SUCCESS_STEALTH } from "./__fixtures__/or-connect-messages";

// openOrConnect reads the stealth kill switch out of app_flags before it does
// anything else and refuses when that read fails (OWM-T0478), so this mock has
// to answer it. Every case below is about what happens once the gate has
// passed: minting, URL building, and how the promise settles. The switch being
// OFF is covered in widget-stealth-gate.test.ts.
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({
        data: { session: { access_token: "test-jwt" } },
      }),
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: vi.fn().mockResolvedValue({ data: { enabled: true }, error: null }),
        }),
      }),
    }),
  },
}));

// Vite-style env replacement: stub `import.meta.env` keys the widget reads.
vi.stubEnv("VITE_SUPABASE_URL", "https://ow.local");
vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "pub-key");
vi.stubEnv("VITE_OR_CONNECT_URL", "https://connect.orangerails.com/connect");

const ORG_ID = "user-uuid-1234";
const CRED_KEY = "Y3JlZF9rZXlfYjY0X29wYXF1ZQ==";
const TXN_KEY = "dHhuX2tleV9iNjRfb3BhcXVl";

interface MockPopup {
  closed: boolean;
  close: () => void;
}

// ── Minimal window shim ──────────────────────────────────────────────
// vitest "node" env has no `window`. We synthesise one backed by a real
// EventTarget so addEventListener / dispatchEvent work, plus the few
// helpers the widget calls (open, setInterval, clearInterval, location).
function installWindowShim(): { popup: MockPopup; openedUrls: string[]; restore: () => void } {
  const openedUrls: string[] = [];
  const popup: MockPopup = {
    closed: false,
    close: vi.fn(() => {
      popup.closed = true;
    }),
  };

  const target = new EventTarget();
  const prev = (globalThis as { window?: unknown }).window;

  const win = {
    addEventListener: target.addEventListener.bind(target),
    removeEventListener: target.removeEventListener.bind(target),
    dispatchEvent: target.dispatchEvent.bind(target),
    open: vi.fn((url: string) => {
      openedUrls.push(String(url));
      return popup;
    }),
    // Resolve globalThis lazily so vi.useFakeTimers(), installed by a case
    // AFTER this shim, is the timer the widget actually calls. Binding here
    // would capture the real timer and defeat advanceTimersByTimeAsync.
    setInterval: (...a: Parameters<typeof setInterval>) => globalThis.setInterval(...a),
    clearInterval: (...a: Parameters<typeof clearInterval>) => globalThis.clearInterval(...a),
    setTimeout: (...a: Parameters<typeof setTimeout>) => globalThis.setTimeout(...a),
    clearTimeout: (...a: Parameters<typeof clearTimeout>) => globalThis.clearTimeout(...a),
    location: { origin: "https://orangeway.local" },
  };

  (globalThis as unknown as { window: typeof win }).window = win;

  return {
    popup,
    openedUrls,
    restore: () => {
      if (prev === undefined) {
        delete (globalThis as { window?: unknown }).window;
      } else {
        (globalThis as { window?: unknown }).window = prev;
      }
    },
  };
}

function postSuccess(payload: Record<string, unknown>): void {
  const win = (globalThis as { window: EventTarget }).window;
  win.dispatchEvent(
    Object.assign(new Event("message"), {
      data: { type: "or-link-success", ...payload },
      origin: "https://connect.orangerails.com",
    }) as unknown as Event,
  );
}

function postCancel(): void {
  const win = (globalThis as { window: EventTarget }).window;
  win.dispatchEvent(
    Object.assign(new Event("message"), {
      data: { type: "or-link-cancel" },
      origin: "https://connect.orangerails.com",
    }) as unknown as Event,
  );
}

describe("openOrConnect", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  let shim: ReturnType<typeof installWindowShim>;

  beforeEach(() => {
    shim = installWindowShim();
    fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({ widget_token: "widget-tok-abc" }), { status: 200 }),
      );
    vi.resetModules();
  });

  afterEach(() => {
    shim.restore();
    vi.restoreAllMocks();
  });

  it("mints a widget token via ow-or-proxy with the org_id and resolves on or-link-success", async () => {
    const { openOrConnect } = await import("../widget");

    const pending = openOrConnect({
      orgId: ORG_ID,
      credKeyB64: CRED_KEY,
      txnKeyB64: TXN_KEY,
    });
    // Let the await chain inside openOrConnect flush so fetch + open run.
    await new Promise((r) => setTimeout(r, 0));

    // mint-token POST went through.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [urlArg, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(String(urlArg)).toBe("https://ow.local/functions/v1/ow-or-proxy");
    expect(init.method).toBe("POST");
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({
      endpoint: "or-link-mint-token",
      org_id: ORG_ID,
    });

    // Popup got the constructed URL. No VITE_OR_PLATFORM_SLUG is stubbed
    // here, so this pins the fallback rather than a deployed value.
    expect(shim.openedUrls).toHaveLength(1);
    const url = new URL(shim.openedUrls[0]);
    expect(url.origin).toBe("https://connect.orangerails.com");
    expect(url.searchParams.get("platform")).toBe("orangeway-me");
    expect(url.searchParams.get("app_user_id")).toBe(ORG_ID);
    expect(url.searchParams.has("provider")).toBe(false); // omitted → OR picker

    const frag = new URLSearchParams(url.hash.slice(1));
    expect(frag.get("widget_token")).toBe("widget-tok-abc");
    expect(frag.get("cred_key")).toBe(CRED_KEY);
    expect(frag.get("txn_key")).toBe(TXN_KEY);

    // Drive a success message.
    postSuccess({
      connection_id: OR_LINK_SUCCESS.connection_id,
      subaccount_id: OR_LINK_SUCCESS.subaccount_id,
      source_wallets: OR_LINK_SUCCESS.source_wallets,
    });
    const result = await pending;
    expect(result).toMatchObject({
      type: "or-link-success",
      connection_id: OR_LINK_SUCCESS.connection_id,
      subaccount_id: OR_LINK_SUCCESS.subaccount_id,
    });
    expect(shim.popup.close).toHaveBeenCalled();
  });

  it("passes provider in the query string when supplied (deep-link mode)", async () => {
    const { openOrConnect } = await import("../widget");

    const pending = openOrConnect({
      orgId: ORG_ID,
      provider: "blink",
      credKeyB64: CRED_KEY,
      txnKeyB64: TXN_KEY,
    });
    await new Promise((r) => setTimeout(r, 0));
    const url = new URL(shim.openedUrls[0]);
    expect(url.searchParams.get("provider")).toBe("blink");
    postSuccess({ connection_id: "c", subaccount_id: "s", source_wallets: [] });
    await pending;
  });

  it("rejects when the widget posts or-link-cancel", async () => {
    const { openOrConnect } = await import("../widget");
    const pending = openOrConnect({
      orgId: ORG_ID,
      credKeyB64: CRED_KEY,
      txnKeyB64: TXN_KEY,
    });
    await new Promise((r) => setTimeout(r, 0));
    postCancel();
    await expect(pending).rejects.toThrow(/cancel/i);
  });

  it("rejects when window.open returns null (popup blocked)", async () => {
    // Re-stub open to simulate blocked popup.
    const win = (globalThis as unknown as { window: { open: ReturnType<typeof vi.fn> } }).window;
    win.open.mockReturnValueOnce(null);
    const { openOrConnect } = await import("../widget");
    await expect(
      openOrConnect({ orgId: ORG_ID, credKeyB64: CRED_KEY, txnKeyB64: TXN_KEY }),
    ).rejects.toThrow(/popup blocked/i);
  });

  it("rejects when ow-or-proxy returns a non-200 for mint-token", async () => {
    fetchSpy.mockResolvedValueOnce(new Response("rate limited", { status: 429 }));
    const { openOrConnect } = await import("../widget");
    await expect(
      openOrConnect({ orgId: ORG_ID, credKeyB64: CRED_KEY, txnKeyB64: TXN_KEY }),
    ).rejects.toThrow(/or-link-mint-token failed.*429/);
  });

  it("ignores postMessage from foreign origins", async () => {
    const { openOrConnect } = await import("../widget");
    const pending = openOrConnect({
      orgId: ORG_ID,
      credKeyB64: CRED_KEY,
      txnKeyB64: TXN_KEY,
    });
    await new Promise((r) => setTimeout(r, 0));

    // Attacker-origin message must NOT resolve the promise.
    const win = (globalThis as { window: EventTarget }).window;
    win.dispatchEvent(
      Object.assign(new Event("message"), {
        data: { type: "or-link-success", connection_id: "evil" },
        origin: "https://attacker.example",
      }) as unknown as Event,
    );

    // Promise still pending. Mark popup closed; poll loop will reject.
    shim.popup.closed = true;
    await expect(pending).rejects.toThrow(/closed before completion/i);
  });

  it("rejects after the hang guard when no terminal message ever arrives", async () => {
    vi.useFakeTimers();
    try {
      const { openOrConnect } = await import("../widget");
      const pending = openOrConnect({
        orgId: ORG_ID,
        credKeyB64: CRED_KEY,
        txnKeyB64: TXN_KEY,
      });

      // Track settlement without leaving an unhandled rejection when the
      // guard fires below.
      let state: "pending" | "resolved" | "rejected" = "pending";
      let error: unknown;
      pending.then(
        () => {
          state = "resolved";
        },
        (e) => {
          state = "rejected";
          error = e;
        },
      );

      // Flush the mint fetch + window.open chain.
      await vi.advanceTimersByTimeAsync(0);
      expect(shim.openedUrls).toHaveLength(1);

      // 1s short of the guard: no terminal message, popup still open,
      // promise still pending. This is the hang the guard has to catch.
      await vi.advanceTimersByTimeAsync(149000);
      expect(state).toBe("pending");

      // Crossing 150s the guard rejects and closes the popup.
      await vi.advanceTimersByTimeAsync(2000);
      expect(state).toBe("rejected");
      expect((error as Error).message).toMatch(/timed out/i);
      expect(shim.popup.close).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  // Kept last: it stubs an env var the other cases read as unset.
  it("names the platform from VITE_OR_PLATFORM_SLUG when the build sets one", async () => {
    // Every deployed build gets its slug from .github/workflows/deploy.yml,
    // so the override is the path that has to be right. The slug must name
    // the same OR platform the environment's API key authenticates as: the
    // token is minted with the key and then claimed by this slug, and a
    // mismatch fails the claim as a 401 on the token.
    vi.stubEnv("VITE_OR_PLATFORM_SLUG", "orangeway-me-dev");
    vi.resetModules();
    const { openOrConnect } = await import("../widget");

    const pending = openOrConnect({
      orgId: ORG_ID,
      credKeyB64: CRED_KEY,
      txnKeyB64: TXN_KEY,
    });
    await new Promise((r) => setTimeout(r, 0));
    const url = new URL(shim.openedUrls[0]);
    expect(url.searchParams.get("platform")).toBe("orangeway-me-dev");

    postSuccess({ connection_id: "c", subaccount_id: "s", source_wallets: [] });
    await pending;

    // widget.ts treats "" as unset (`||`, not `??`), so this hands the
    // fallback back to any case that runs after this one. unstubAllEnvs
    // would also drop the module-level stubs the other cases need.
    vi.stubEnv("VITE_OR_PLATFORM_SLUG", "");
  });
});

// Contract conformance (DL-1114). Every assertion below runs against what
// openOrConnect RESOLVES WITH, never against the fixture on its own. An
// earlier revision of this block compared the fixture to an object built
// inside the test, which could not fail: no consumer code ran, so the guards
// stayed green even if widget.ts stopped forwarding the fields entirely. A
// test that cannot fail reads as coverage and is the exact condition DL-1114
// exists to remove.
describe("or-link-success contract, through the consumer (DL-1114)", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  let shim: ReturnType<typeof installWindowShim>;

  beforeEach(() => {
    shim = installWindowShim();
    fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({ widget_token: "widget-tok-abc" }), { status: 200 }),
      );
    vi.resetModules();
  });

  afterEach(() => {
    shim.restore();
    vi.restoreAllMocks();
  });

  // Posts the fixture verbatim, as the sender would, and returns whatever
  // openOrConnect hands back. `postRaw` bypasses postSuccess() because that
  // helper injects `type` itself; here the fixture must supply it, so a
  // fixture whose type ever drifts fails rather than being papered over.
  async function resolveWith(fixture: Record<string, unknown>) {
    const { openOrConnect } = await import("../widget");
    const pending = openOrConnect({ orgId: ORG_ID, credKeyB64: CRED_KEY, txnKeyB64: TXN_KEY });
    await new Promise((r) => setTimeout(r, 0));
    const win = (globalThis as { window: EventTarget }).window;
    win.dispatchEvent(
      Object.assign(new Event("message"), {
        data: fixture,
        origin: "https://connect.orangerails.com",
      }) as unknown as Event,
    );
    return pending;
  }

  it("forwards every field of the real sender payload to the caller", async () => {
    const result = await resolveWith({ ...OR_LINK_SUCCESS });

    // Goes red if widget.ts starts reshaping the payload instead of passing
    // the sender's object through, which is what it does today.
    expect(result.type).toBe("or-link-success");
    expect(result.connection_id).toBe(OR_LINK_SUCCESS.connection_id);
    expect(result.subaccount_id).toBe(OR_LINK_SUCCESS.subaccount_id);
    expect(result.source_wallets).toHaveLength(1);
    expect(result.source_wallets[0]).toMatchObject({
      id: OR_LINK_SUCCESS.source_wallets[0].id,
      external_wallet_id: OR_LINK_SUCCESS.source_wallets[0].external_wallet_id,
      currency: OR_LINK_SUCCESS.source_wallets[0].currency,
      label: OR_LINK_SUCCESS.source_wallets[0].label,
    });
  });

  it("subaccount_id survives the consumer, the field the old inline literal omitted", async () => {
    // The specific regression DL-1114 is about. The pre-fixture test posted
    // { connection_id: "conn-1", subaccount_id: "sub-1" } that it invented,
    // so it could not have caught the sender adding or renaming a field.
    // Asserting on the resolved value means dropping subaccount_id anywhere
    // between the message handler and the caller turns this red.
    const result = await resolveWith({ ...OR_LINK_SUCCESS });
    expect(result).toHaveProperty("subaccount_id");
    expect(result.subaccount_id).toBe(OR_LINK_SUCCESS.subaccount_id);
  });

  it("stealth payload reaches the caller with source_wallets empty, not absent", async () => {
    // Empty and absent are different downstream: the import bridge branches on
    // length, and `undefined.length` throws. Driving it through the consumer
    // proves the distinction survives, which asserting on the fixture cannot.
    const result = await resolveWith({ ...OR_LINK_SUCCESS_STEALTH });
    expect(result.source_wallets).toBeDefined();
    expect(Array.isArray(result.source_wallets)).toBe(true);
    expect(result.source_wallets).toEqual([]);
  });
});
