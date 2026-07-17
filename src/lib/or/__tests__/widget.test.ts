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

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({
        data: { session: { access_token: "test-jwt" } },
      }),
    },
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
    setInterval: globalThis.setInterval.bind(globalThis),
    clearInterval: globalThis.clearInterval.bind(globalThis),
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
    postSuccess({ connection_id: "conn-1", subaccount_id: "sub-1", source_wallets: [] });
    const result = await pending;
    expect(result).toMatchObject({
      type: "or-link-success",
      connection_id: "conn-1",
      subaccount_id: "sub-1",
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
