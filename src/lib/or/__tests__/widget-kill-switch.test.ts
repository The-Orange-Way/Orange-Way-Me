/**
 * @vitest-environment node
 *
 * The stealth kill switch gates the ADD door, not only the sync door
 * (OWM-T0478).
 *
 * Before this, `stealth_sync_enabled` being off stopped a private connection
 * from SYNCING and did nothing at all to stop a new one being ADDED, so a
 * feature everyone read as off could still seal new envelopes. openOrConnect
 * is the single point every catalogue add passes through, so the refusal
 * lives there and this file is what stops it being removed by accident.
 *
 * What is asserted, and why it is not just "the promise rejects": a rejection
 * would still be produced if the check moved BELOW the token mint, by which
 * point a widget token exists and the vault keys have been written into a
 * URL. So these cases assert the effects - fetch never called, window.open
 * never called - which are only true if the refusal really is the first
 * thing the function does.
 *
 * Window shim and mint mocking follow widget.test.ts; see the long comment
 * there for why the node environment needs one.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const flag = vi.hoisted(() => ({ enabled: false }));

vi.mock("@/lib/stealth/runtimeFlags", () => ({
  isStealthSyncEnabled: () => flag.enabled,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({
        data: { session: { access_token: "test-jwt" } },
      }),
    },
  },
}));

vi.stubEnv("VITE_SUPABASE_URL", "https://ow.local");
vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "pub-key");
vi.stubEnv("VITE_OR_CONNECT_URL", "https://connect.orangerails.com/connect");

const ORG_ID = "user-uuid-1234";
const CRED_KEY = "Y3JlZF9rZXlfYjY0X29wYXF1ZQ==";
const TXN_KEY = "dHhuX2tleV9iNjRfb3BhcXVl";

function installWindowShim(): { openedUrls: string[]; open: ReturnType<typeof vi.fn>; restore: () => void } {
  const openedUrls: string[] = [];
  const popup = { closed: false, close: vi.fn() };
  const target = new EventTarget();
  const prev = (globalThis as { window?: unknown }).window;

  const open = vi.fn((url: string) => {
    openedUrls.push(String(url));
    return popup;
  });

  const win = {
    addEventListener: target.addEventListener.bind(target),
    removeEventListener: target.removeEventListener.bind(target),
    dispatchEvent: target.dispatchEvent.bind(target),
    open,
    setInterval: (...a: Parameters<typeof setInterval>) => globalThis.setInterval(...a),
    clearInterval: (...a: Parameters<typeof clearInterval>) => globalThis.clearInterval(...a),
    setTimeout: (...a: Parameters<typeof setTimeout>) => globalThis.setTimeout(...a),
    clearTimeout: (...a: Parameters<typeof clearTimeout>) => globalThis.clearTimeout(...a),
    location: { origin: "https://orangeway.local" },
  };

  (globalThis as unknown as { window: typeof win }).window = win;

  return {
    openedUrls,
    open,
    restore: () => {
      if (prev === undefined) {
        delete (globalThis as { window?: unknown }).window;
      } else {
        (globalThis as { window?: unknown }).window = prev;
      }
    },
  };
}

describe("openOrConnect is gated on the stealth kill switch", () => {
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

  it("refuses with the flag OFF, mints no token and opens no window", async () => {
    flag.enabled = false;
    const { openOrConnect, SourceCatalogueDisabledError, SOURCE_CATALOGUE_DISABLED_MESSAGE } =
      await import("../widget");

    await expect(
      openOrConnect({ orgId: ORG_ID, credKeyB64: CRED_KEY, txnKeyB64: TXN_KEY }),
    ).rejects.toBeInstanceOf(SourceCatalogueDisabledError);

    // The two that matter: no widget token was minted, and no navigation was
    // opened, so neither vault key was ever written into a URL.
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(shim.open).not.toHaveBeenCalled();
    expect(shim.openedUrls).toEqual([]);

    // The user-facing sentence says the feature is unavailable rather than
    // leaving them with a generic failure.
    expect(SOURCE_CATALOGUE_DISABLED_MESSAGE).toMatch(/temporarily unavailable/i);
  });

  it("refuses the same way when a provider is named, not only for the catalogue", async () => {
    // Naming a provider skips the catalogue UI, and it still hands the same
    // key to the same origin, so it must not be a way around the switch.
    flag.enabled = false;
    const { openOrConnect, SourceCatalogueDisabledError } = await import("../widget");

    await expect(
      openOrConnect({
        orgId: ORG_ID,
        provider: "xpub_stealth",
        credKeyB64: CRED_KEY,
        txnKeyB64: TXN_KEY,
      }),
    ).rejects.toBeInstanceOf(SourceCatalogueDisabledError);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(shim.open).not.toHaveBeenCalled();
  });

  it("opens normally with the flag ON, so the gate is a switch and not a wall", async () => {
    flag.enabled = true;
    const { openOrConnect } = await import("../widget");

    // Left pending on purpose: the popup never posts back in this test. We
    // only care that the function got past the gate and opened the window.
    void openOrConnect({ orgId: ORG_ID, credKeyB64: CRED_KEY, txnKeyB64: TXN_KEY }).catch(
      () => undefined,
    );
    await new Promise((r) => setTimeout(r, 0));

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(shim.open).toHaveBeenCalledTimes(1);
    expect(shim.openedUrls[0]).toContain("cred_key=");
  });
});
