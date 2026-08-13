/**
 * @vitest-environment node
 *
 * Tests for launchStealthConnect() the opening handshake for the OR Connect
 * stealth widget. The function opens the popup, waits for READY, then sends
 * OR_STEALTH_INIT carrying return_callback_origin. Covered here:
 *
 *   1. The READY to INIT happy path: INIT is posted to the exact widget
 *      origin and carries return_callback_origin.
 *   2. Popup blocked (window.open returns null).
 *   3. The READY hang guard rejects when no READY ever arrives.
 *   4. The popup closed before READY rejects rather than hanging.
 *
 * No real popup is driven; window.open and postMessage are stubbed onto a
 * node window shim backed by a real EventTarget, matching widget.test.ts in
 * this repo. Vitest runs in the "node" environment, so there is no jsdom.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.stubEnv("VITE_OR_CONNECT_URL", "https://connect.orangerails.com/connect");

const CONNECT_ORIGIN = "https://connect.orangerails.com";
const WIDGET_URL = "https://connect.orangerails.com/connect?platform=orangeway-me";
const OWN_ORIGIN = "https://orangeway.local";

interface MockPopup {
  closed: boolean;
  close: () => void;
  postMessage: (message: unknown, targetOrigin: string) => void;
}

function installWindowShim(): {
  popup: MockPopup;
  openedUrls: string[];
  posted: Array<{ message: unknown; targetOrigin: string }>;
  restore: () => void;
} {
  const openedUrls: string[] = [];
  const posted: Array<{ message: unknown; targetOrigin: string }> = [];
  const popup: MockPopup = {
    closed: false,
    close: vi.fn(() => {
      popup.closed = true;
    }),
    postMessage: vi.fn((message: unknown, targetOrigin: string) => {
      posted.push({ message, targetOrigin });
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
    // after this shim, is the timer the module actually calls.
    setInterval: (...a: Parameters<typeof setInterval>) => globalThis.setInterval(...a),
    clearInterval: (...a: Parameters<typeof clearInterval>) => globalThis.clearInterval(...a),
    setTimeout: (...a: Parameters<typeof setTimeout>) => globalThis.setTimeout(...a),
    clearTimeout: (...a: Parameters<typeof clearTimeout>) => globalThis.clearTimeout(...a),
    location: { origin: OWN_ORIGIN },
  };

  (globalThis as unknown as { window: typeof win }).window = win;

  return {
    popup,
    openedUrls,
    posted,
    restore: () => {
      if (prev === undefined) {
        delete (globalThis as { window?: unknown }).window;
      } else {
        (globalThis as { window?: unknown }).window = prev;
      }
    },
  };
}

/** Dispatch the widget's READY frame, from the widget origin, sourced at the popup. */
function postReady(source: unknown): void {
  const win = (globalThis as { window: EventTarget }).window;
  win.dispatchEvent(
    Object.assign(new Event("message"), {
      data: { type: "OR_STEALTH_READY", protocol_version: 1 },
      origin: CONNECT_ORIGIN,
      source,
    }) as unknown as Event,
  );
}

describe("launchStealthConnect", () => {
  let shim: ReturnType<typeof installWindowShim>;

  beforeEach(() => {
    shim = installWindowShim();
    vi.resetModules();
  });

  afterEach(() => {
    shim.restore();
    vi.restoreAllMocks();
  });

  it("waits for READY, then sends INIT with return_callback_origin to the widget origin", async () => {
    const { launchStealthConnect } = await import("../launch");

    const pending = launchStealthConnect({ url: WIDGET_URL });
    await new Promise((r) => setTimeout(r, 0));

    expect(shim.openedUrls).toEqual([WIDGET_URL]);
    // No INIT before READY: sending it into a widget that has not attached its
    // listener would lose it.
    expect(shim.posted).toHaveLength(0);

    postReady(shim.popup);
    const result = await pending;
    expect(result.channel).toBeDefined();

    // INIT went to the exact widget origin, never "*", and carries the origin.
    expect(shim.posted).toHaveLength(1);
    expect(shim.posted[0].targetOrigin).toBe(CONNECT_ORIGIN);
    expect(shim.posted[0].message).toMatchObject({
      type: "OR_STEALTH_INIT",
      protocol_version: 1,
      return_callback_origin: OWN_ORIGIN,
    });
  });

  it("throws when window.open returns null (popup blocked)", async () => {
    const win = (globalThis as unknown as { window: { open: ReturnType<typeof vi.fn> } }).window;
    win.open.mockReturnValueOnce(null);
    const { launchStealthConnect } = await import("../launch");
    await expect(launchStealthConnect({ url: WIDGET_URL })).rejects.toThrow(/popup blocked/i);
  });

  it("rejects after the hang guard when no READY ever arrives", async () => {
    vi.useFakeTimers();
    try {
      const { launchStealthConnect, STEALTH_READY_TIMEOUT_MS } = await import("../launch");
      const pending = launchStealthConnect({ url: WIDGET_URL });

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

      await vi.advanceTimersByTimeAsync(0);
      expect(shim.openedUrls).toHaveLength(1);

      // Just short of the guard: still pending, no INIT sent.
      await vi.advanceTimersByTimeAsync(STEALTH_READY_TIMEOUT_MS - 1000);
      expect(state).toBe("pending");
      expect(shim.posted).toHaveLength(0);

      // Crossing the guard rejects and closes the popup.
      await vi.advanceTimersByTimeAsync(2000);
      expect(state).toBe("rejected");
      expect((error as Error).message).toMatch(/never became ready/i);
      expect(shim.popup.close).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects when the popup is closed before it becomes ready", async () => {
    const { launchStealthConnect } = await import("../launch");
    const pending = launchStealthConnect({ url: WIDGET_URL });
    await new Promise((r) => setTimeout(r, 0));

    // User closes the blank popup before READY. The poll must reject.
    shim.popup.closed = true;
    await expect(pending).rejects.toThrow(/closed before it became ready/i);
    expect(shim.posted).toHaveLength(0);
  });
});
