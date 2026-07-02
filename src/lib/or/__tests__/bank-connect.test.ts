/**
 * @vitest-environment node
 *
 * Tests for openBankPopup(), specifically the active-discovery poll
 * added alongside the existing OR_QUILTT_LINK_COMPLETE postMessage
 * listener (see the doc comment on openBankPopup in ../bank-connect.ts
 * for the production failure mode this covers: some bank OAuth
 * redirects sever window.opener, so the postMessage never arrives even
 * though the bank link succeeded server-side).
 *
 * The poll snapshots the user's accounts once when the popup opens and
 * only resolves when an account appears that WASN'T in that snapshot.
 * Several tests below exist specifically to pin that behavior: a
 * returning user linking a second bank already has accounts from their
 * first one, and an earlier version of this poll resolved as soon as it
 * saw ANY account, which meant it could close the popup on a
 * pre-existing account before the new bank finished linking.
 *
 * Vitest runs in the "node" environment for this repo, so we wire a
 * minimal `window` shim onto globalThis, same pattern as widget.test.ts.
 * Fake timers give us deterministic control over the 500ms popup-close
 * watch and the 3000ms discovery poll.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const invokeMock = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: invokeMock },
  },
}));

vi.stubEnv("VITE_OR_CONNECT_URL", "https://orangerails.com/connect");

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
    // Bound AFTER vi.useFakeTimers() runs in beforeEach, so these point at
    // the faked implementations and our advanceTimersByTimeAsync calls
    // actually drive openBankPopup's intervals.
    setInterval: globalThis.setInterval.bind(globalThis),
    clearInterval: globalThis.clearInterval.bind(globalThis),
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

function postMessage(data: Record<string, unknown>, origin = "https://orangerails.com"): void {
  const win = (globalThis as { window: EventTarget }).window;
  win.dispatchEvent(Object.assign(new Event("message"), { data, origin }) as unknown as Event);
}

function accountsResponse(ids: string[]) {
  return {
    data: { accounts: ids.map((id) => ({ id, name: id })) },
    error: null,
  };
}

describe("openBankPopup", () => {
  let shim: ReturnType<typeof installWindowShim>;

  beforeEach(() => {
    vi.useFakeTimers();
    shim = installWindowShim();
    invokeMock.mockReset();
  });

  afterEach(() => {
    shim.restore();
    vi.useRealTimers();
  });

  it("resolves on OR_QUILTT_LINK_COMPLETE without the poll ever mattering", async () => {
    invokeMock.mockResolvedValueOnce(accountsResponse([])); // baseline snapshot

    const { openBankPopup } = await import("../bank-connect");
    const pending = openBankPopup("https://orangerails.com/connect/quiltt#x=1");

    postMessage({ type: "OR_QUILTT_LINK_COMPLETE", quilttConnectionId: "conn-1" });
    const result = await pending;

    expect(result).toMatchObject({ type: "OR_QUILTT_LINK_COMPLETE", quilttConnectionId: "conn-1" });
    expect(shim.popup.close).toHaveBeenCalled();
    // Only the baseline snapshot fires (taken the instant the popup opens);
    // the postMessage settles the promise before any 3s poll tick occurs.
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });

  it("does NOT resolve on a pre-existing account, only on a genuinely new one (the multi-bank regression)", async () => {
    invokeMock
      .mockResolvedValueOnce(accountsResponse(["acc-old"])) // baseline: user already has one bank
      .mockResolvedValueOnce(accountsResponse(["acc-old"])) // tick @3s: still just the old one
      .mockResolvedValueOnce(accountsResponse(["acc-old"])) // tick @6s: still just the old one
      .mockResolvedValueOnce(accountsResponse(["acc-old", "acc-new"])); // tick @9s: new bank landed

    const { openBankPopup } = await import("../bank-connect");
    const pending = openBankPopup("https://orangerails.com/connect/quiltt#x=1");

    await vi.advanceTimersByTimeAsync(3000);
    await vi.advanceTimersByTimeAsync(3000);
    expect(shim.popup.close).not.toHaveBeenCalled(); // must NOT have fired on acc-old alone

    await vi.advanceTimersByTimeAsync(3000);
    const result = await pending;

    expect(result.quilttConnectionId).toBe("");
    expect(result.discoveredAccounts).toEqual([{ id: "acc-new", name: "acc-new" }]);
    // The pre-existing account must never appear in discoveredAccounts.
    expect(result.discoveredAccounts?.some((a) => a.id === "acc-old")).toBe(false);
    expect(shim.popup.close).toHaveBeenCalled();
  });

  it("resolves via the poll when postMessage never arrives and the user had no prior accounts", async () => {
    invokeMock
      .mockResolvedValueOnce(accountsResponse([])) // baseline: brand new user, nothing yet
      .mockResolvedValueOnce(accountsResponse([])) // tick @3s: nothing yet
      .mockResolvedValueOnce(accountsResponse(["acc-1"])); // tick @6s: linked

    const { openBankPopup } = await import("../bank-connect");
    const pending = openBankPopup("https://orangerails.com/connect/quiltt#x=1");

    // No postMessage ever fires in this test, simulating the OAuth
    // redirect severing window.opener.
    await vi.advanceTimersByTimeAsync(3000);
    expect(invokeMock).toHaveBeenCalledWith(
      "owm-or-discover-quiltt",
      expect.objectContaining({ body: { quilttConnectionId: "" } }),
    );

    await vi.advanceTimersByTimeAsync(3000);
    const result = await pending;

    expect(result).toMatchObject({ type: "OR_QUILTT_LINK_COMPLETE", quilttConnectionId: "" });
    expect(result.discoveredAccounts).toEqual([{ id: "acc-1", name: "acc-1" }]);
    expect(shim.popup.close).toHaveBeenCalled();
  });

  it("keeps polling silently through discovery errors until the link succeeds", async () => {
    invokeMock
      .mockResolvedValueOnce(accountsResponse([])) // baseline
      .mockResolvedValueOnce({ data: null, error: { message: "no accounts after retries" } }) // tick @3s: errors
      .mockResolvedValueOnce(accountsResponse(["acc-1"])); // tick @6s: succeeds

    const { openBankPopup } = await import("../bank-connect");
    const pending = openBankPopup("https://orangerails.com/connect/quiltt#x=1");

    await vi.advanceTimersByTimeAsync(3000); // errors, swallowed
    await vi.advanceTimersByTimeAsync(3000); // succeeds
    const result = await pending;

    expect(result.quilttConnectionId).toBe("");
    expect(invokeMock).toHaveBeenCalledTimes(3);
  });

  it("stops polling and rejects when the popup is closed before completion", async () => {
    invokeMock.mockResolvedValue(accountsResponse([]));

    const { openBankPopup } = await import("../bank-connect");
    const pending = openBankPopup("https://orangerails.com/connect/quiltt#x=1");

    // Attach the rejection assertion BEFORE advancing timers so the
    // rejection has a handler the instant it fires, avoiding a spurious
    // unhandled-rejection warning from the fake-timer microtask queue.
    const assertion = expect(pending).rejects.toThrow(/closed before completion/i);
    shim.popup.closed = true;
    await vi.advanceTimersByTimeAsync(500);
    await assertion;

    // No further discovery calls should fire once settled, advancing
    // well past another poll tick must not invoke again.
    const callsAtReject = invokeMock.mock.calls.length;
    await vi.advanceTimersByTimeAsync(3000);
    expect(invokeMock.mock.calls.length).toBe(callsAtReject);
  });

  it("ignores postMessage from foreign origins and still settles via the poll", async () => {
    invokeMock
      .mockResolvedValueOnce(accountsResponse([])) // baseline
      .mockResolvedValueOnce(accountsResponse(["acc-1"])); // tick @3s

    const { openBankPopup } = await import("../bank-connect");
    const pending = openBankPopup("https://orangerails.com/connect/quiltt#x=1");

    postMessage(
      { type: "OR_QUILTT_LINK_COMPLETE", quilttConnectionId: "evil" },
      "https://attacker.example",
    );
    await vi.advanceTimersByTimeAsync(3000);

    const result = await pending;
    expect(result.quilttConnectionId).toBe(""); // came from the poll, not the attacker message
  });

  it("gives up after the max poll attempts instead of polling forever", async () => {
    invokeMock.mockResolvedValue(accountsResponse([])); // baseline + every tick: nothing, forever

    const { openBankPopup } = await import("../bank-connect");
    const pending = openBankPopup("https://orangerails.com/connect/quiltt#x=1");
    // Swallow the eventual rejection assertion race: attach a no-op catch
    // so advancing past the cap doesn't produce an unhandled rejection
    // before we get to assert on it below.
    pending.catch(() => {});

    // 200 attempts * 3000ms = 600000ms, plus the baseline call which
    // doesn't count as an attempt. Advance well past the cap.
    await vi.advanceTimersByTimeAsync(3000 * 205);

    const callsAfterCap = invokeMock.mock.calls.length;
    // 1 baseline + up to 200 poll attempts, never more even though we
    // advanced past 200 ticks worth of time.
    expect(callsAfterCap).toBeLessThanOrEqual(202);
    await vi.advanceTimersByTimeAsync(3000 * 5);
    expect(invokeMock.mock.calls.length).toBe(callsAfterCap); // polling has stopped

    // The promise itself is still pending (popup never closed, no
    // postMessage arrived); it will resolve/reject via the other two
    // paths, not this test's concern. Close the popup to clean up.
    shim.popup.closed = true;
    await vi.advanceTimersByTimeAsync(500);
    await expect(pending).rejects.toThrow(/closed before completion/i);
  });
});
