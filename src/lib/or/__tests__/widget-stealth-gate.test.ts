/**
 * @vitest-environment node
 *
 * The stealth kill switch must close BOTH doors (OWM-T0478).
 *
 * It only ever closed the sync door. The add path never read the flag, so a
 * feature everyone believed was off still let a customer pick xpub or Sparrow
 * out of the hosted catalogue, and every one of those seals another envelope
 * under the credentials namespace key. These tests exist so that check cannot
 * quietly disappear in a later refactor, which is exactly how it went missing
 * the first time.
 *
 * The real src/lib/stealth/runtimeFlags module is used, not a mock of it. A
 * mocked flag would prove the gate reads SOMETHING; driving the actual module
 * through its failure modes proves the gate is closed when the switch cannot
 * be read at all.
 *
 * Vitest runs in the "node" environment for this repo, so we wire a minimal
 * `window` shim onto globalThis, same pattern as bank-connect.test.ts. Real
 * timers throughout: both paths settle on a posted message, so nothing here
 * waits on the 500ms close watch or the 150s hang guard.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const maybeSingle = vi.fn();
const getSession = vi.fn();
const invokeMock = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }),
    auth: { getSession },
    functions: { invoke: invokeMock },
  },
}));

vi.stubEnv("VITE_OR_CONNECT_URL", "https://connect.orangerails.com/connect");
vi.stubEnv("VITE_SUPABASE_URL", "https://supabase.test");
vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "anon-key");

const KEYS = { orgId: "user-1", credKeyB64: "Y3JlZA==", txnKeyB64: "dHhu" };

const FLAG_ON = { data: { enabled: true }, error: null };
const FLAG_OFF = { data: { enabled: false }, error: null };

// A Quiltt bundle is supplied so buildBankPopupUrl takes its fast path
// (straight to /connect/quiltt), which is the route the bank dialog actually
// uses and the one that must survive the switch being off.
const QUICK_CONNECT = {
  orPlatformUserId: "or-user-1",
  widget_token: "widget-tok",
  expires_at: "2099-01-01T00:00:00Z",
  quilttBundle: {
    session_token: "sess-tok",
    connector_id: "conn-id",
    platform_slug: "orangeway",
    app_user_id: "app-user-1",
  },
};

interface MockPopup {
  closed: boolean;
  close: () => void;
}

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
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
    location: { origin: "https://orangeway.test" },
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

function postMessage(
  data: Record<string, unknown>,
  origin = "https://connect.orangerails.com",
): void {
  const win = (globalThis as { window: EventTarget }).window;
  win.dispatchEvent(Object.assign(new Event("message"), { data, origin }) as unknown as Event);
}

/** Let the mint round trip and the window.open that follows it actually run. */
async function settleMicrotasks(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

let shim: ReturnType<typeof installWindowShim>;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  shim = installWindowShim();
  maybeSingle.mockReset();
  getSession.mockReset();
  invokeMock.mockReset();
  getSession.mockResolvedValue({ data: { session: { access_token: "access-tok" } } });
  fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ widget_token: "widget-tok" }),
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  shim.restore();
  vi.unstubAllGlobals();
});

// runtimeFlags keeps `loaded` at module scope, so every case re-imports
// through vi.resetModules() to get a fresh, unloaded instance.
async function freshWidget() {
  vi.resetModules();
  return await import("../widget");
}

describe("openOrConnect refuses while the stealth kill switch is off", () => {
  it("refuses on a row that says disabled, without minting a token or opening a window", async () => {
    maybeSingle.mockResolvedValue(FLAG_OFF);
    const { openOrConnect, StealthCatalogueDisabledError } = await freshWidget();

    await expect(openOrConnect(KEYS)).rejects.toBeInstanceOf(StealthCatalogueDisabledError);

    // The two assertions that matter. Remove the check in openOrConnect and
    // both of these fire: a disabled add path must cost no round trip and must
    // never hand the vault keys to the provider in a URL fragment.
    expect(fetchMock).not.toHaveBeenCalled();
    expect(shim.openedUrls).toHaveLength(0);
  });

  it("refuses when the flag query returns an error", async () => {
    maybeSingle.mockResolvedValue({ data: null, error: { message: "boom" } });
    const { openOrConnect, StealthCatalogueDisabledError } = await freshWidget();
    await expect(openOrConnect(KEYS)).rejects.toBeInstanceOf(StealthCatalogueDisabledError);
    expect(shim.openedUrls).toHaveLength(0);
  });

  it("refuses when the flag query throws", async () => {
    maybeSingle.mockRejectedValue(new Error("network down"));
    const { openOrConnect, StealthCatalogueDisabledError } = await freshWidget();
    await expect(openOrConnect(KEYS)).rejects.toBeInstanceOf(StealthCatalogueDisabledError);
    expect(shim.openedUrls).toHaveLength(0);
  });

  it("refuses when the query succeeds with no row at all", async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null });
    const { openOrConnect, StealthCatalogueDisabledError } = await freshWidget();
    await expect(openOrConnect(KEYS)).rejects.toBeInstanceOf(StealthCatalogueDisabledError);
    expect(shim.openedUrls).toHaveLength(0);
  });

  it("opens the catalogue when a successful read says enabled", async () => {
    // The positive control. Without it every assertion above would pass
    // against a gate that refused unconditionally, and the tests would prove
    // nothing about the switch actually working.
    maybeSingle.mockResolvedValue(FLAG_ON);
    const { openOrConnect } = await freshWidget();

    const pending = openOrConnect(KEYS);
    await settleMicrotasks();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(shim.openedUrls).toHaveLength(1);
    expect(shim.openedUrls[0]).toContain("https://connect.orangerails.com/connect?");

    postMessage({ type: "or-link-cancel" });
    await expect(pending).rejects.toThrow("User cancelled");
  });
});

describe("the bank route is untouched by the stealth kill switch", () => {
  it("still opens its popup with the flag OFF", async () => {
    // bank-connect.ts does not import widget.ts, so the gate cannot reach it.
    // This is the test that notices if a later edit moves the gate somewhere
    // that can, which is the single largest risk in this change.
    maybeSingle.mockResolvedValue(FLAG_OFF);
    invokeMock.mockResolvedValue({ data: { accounts: [] }, error: null });

    vi.resetModules();
    const { buildBankPopupUrl, openBankPopup } = await import("../bank-connect");

    const url = buildBankPopupUrl({
      quickConnect: QUICK_CONNECT,
      credKeyB64: KEYS.credKeyB64,
      txnKeyB64: KEYS.txnKeyB64,
    });
    expect(url).toContain("https://connect.orangerails.com/connect/quiltt#");

    const pending = openBankPopup(url);
    expect(shim.openedUrls).toEqual([url]);

    postMessage({ type: "OR_QUILTT_LINK_CANCEL" });
    await expect(pending).rejects.toThrow("User cancelled");
  });
});
