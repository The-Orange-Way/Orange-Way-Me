/**
 * The stealth kill switch must fail CLOSED (DL-1466) and must REACH AN OPEN TAB
 * (OWM-T0504). Those are two different properties and this file drives both.
 *
 * FAILS CLOSED. This module used to fall back to the build-time constant, which
 * prod shipped as `true`. The gate therefore read true until the app_flags row
 * resolved, and stayed true permanently if that read failed. Measured on
 * production: a 507ms window on a cold load, unbounded on a query error.
 *
 * REACHES AN OPEN TAB. The read then happened exactly once, at application
 * start, so flipping the row changed what a new page load saw and nothing about
 * a tab that was already open. The switch's latency was "until every open tab
 * reloads", which is unbounded, and the comments in two other files told an
 * operator the opposite.
 *
 * These tests exist because a fail-closed path nobody has watched go red is a
 * claim, not a fix, and because "it refreshes" is a claim until something drives
 * the source of truth from true to false and watches the gate follow.
 *
 * maybeSingle() is the last call in the chain, so each test swaps only that.
 * The module keeps its cache at module scope, so every test re-imports through
 * vi.resetModules() to get a fresh, unread instance.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const maybeSingle = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle }),
      }),
    }),
  },
}));

async function freshModule() {
  vi.resetModules();
  return await import("../runtimeFlags");
}

function rowSays(enabled: boolean) {
  return { data: { enabled }, error: null };
}

beforeEach(() => {
  maybeSingle.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("stealth kill switch fails closed", () => {
  it("is OFF before the read resolves, which is the boot window", async () => {
    const m = await freshModule();
    // loadRuntimeFlags has deliberately not been called yet.
    expect(m.isStealthSyncEnabled()).toBe(false);
  });

  it("is OFF when the query returns an error", async () => {
    maybeSingle.mockResolvedValue({ data: null, error: { message: "boom" } });
    const m = await freshModule();
    await m.loadRuntimeFlags();
    expect(m.isStealthSyncEnabled()).toBe(false);
  });

  it("is OFF when the query throws", async () => {
    maybeSingle.mockRejectedValue(new Error("network down"));
    const m = await freshModule();
    await m.loadRuntimeFlags();
    expect(m.isStealthSyncEnabled()).toBe(false);
  });

  it("is OFF when the query succeeds with no row", async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null });
    const m = await freshModule();
    await m.loadRuntimeFlags();
    expect(m.isStealthSyncEnabled()).toBe(false);
  });

  it("is OFF when the row says enabled false", async () => {
    maybeSingle.mockResolvedValue(rowSays(false));
    const m = await freshModule();
    await m.loadRuntimeFlags();
    expect(m.isStealthSyncEnabled()).toBe(false);
  });

  it("is ON only when a successful read returns enabled true", async () => {
    // The positive control. Without this, every assertion above would still
    // pass against a module that hardcoded false, and the tests would prove
    // nothing about the switch actually working.
    maybeSingle.mockResolvedValue(rowSays(true));
    const m = await freshModule();
    await m.loadRuntimeFlags();
    expect(m.isStealthSyncEnabled()).toBe(true);
  });
});

describe("a refresh can only ever turn the gate off, never on by accident", () => {
  // These are the fail-closed tests for the NEW code path. The read now happens
  // more than once, so every way a read can fail has to be driven again against
  // a gate that is currently true. A refresh that quietly kept the cached true
  // would pass every test in the section below and be worthless in an incident.

  it("a refresh whose query errors drops a true gate to false", async () => {
    maybeSingle.mockResolvedValueOnce(rowSays(true));
    const m = await freshModule();
    await m.loadRuntimeFlags();
    expect(m.isStealthSyncEnabled()).toBe(true);

    maybeSingle.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    await m.refreshRuntimeFlags();
    expect(m.isStealthSyncEnabled()).toBe(false);
  });

  it("a refresh that throws drops a true gate to false", async () => {
    maybeSingle.mockResolvedValueOnce(rowSays(true));
    const m = await freshModule();
    await m.loadRuntimeFlags();
    expect(m.isStealthSyncEnabled()).toBe(true);

    maybeSingle.mockRejectedValueOnce(new Error("network down"));
    await m.refreshRuntimeFlags();
    expect(m.isStealthSyncEnabled()).toBe(false);
  });

  it("a refresh that finds no row drops a true gate to false", async () => {
    maybeSingle.mockResolvedValueOnce(rowSays(true));
    const m = await freshModule();
    await m.loadRuntimeFlags();
    expect(m.isStealthSyncEnabled()).toBe(true);

    maybeSingle.mockResolvedValueOnce({ data: null, error: null });
    await m.refreshRuntimeFlags();
    expect(m.isStealthSyncEnabled()).toBe(false);
  });

  it("a refresh that reads the row again keeps a true gate true", async () => {
    // The positive control for this section: the refresh path must be capable
    // of leaving the gate on, or every assertion above is satisfied by a
    // function that just writes false.
    maybeSingle.mockResolvedValue(rowSays(true));
    const m = await freshModule();
    await m.loadRuntimeFlags();
    await m.refreshRuntimeFlags();
    expect(maybeSingle).toHaveBeenCalledTimes(2);
    expect(m.isStealthSyncEnabled()).toBe(true);
  });
});

describe("the switch reaches a tab that is already open", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // A fixed, non-zero clock. The module treats 0 as "never read", so a clock
    // that starts at the epoch would make a completed read look like no read.
    vi.setSystemTime(new Date("2026-09-01T00:00:00Z"));
  });

  it("a forced read gets the new answer with no reload, which is what a door does", async () => {
    // THE CASE THIS TICKET IS ABOUT. The tab loaded while the switch was on.
    // Operations then turns it off. Nothing reloads. The next press must refuse.
    maybeSingle.mockResolvedValueOnce(rowSays(true));
    const m = await freshModule();
    await m.loadRuntimeFlags();
    expect(m.isStealthSyncEnabled()).toBe(true);

    maybeSingle.mockResolvedValueOnce(rowSays(false));
    await m.refreshRuntimeFlags();

    expect(m.isStealthSyncEnabled()).toBe(false);
    expect(maybeSingle).toHaveBeenCalledTimes(2);
  });

  it("a forced read does not wait for the cached answer to age out", async () => {
    maybeSingle.mockResolvedValueOnce(rowSays(true));
    const m = await freshModule();
    await m.loadRuntimeFlags();

    // No time passes at all between the boot read and the press.
    maybeSingle.mockResolvedValueOnce(rowSays(false));
    await m.refreshRuntimeFlags();

    expect(m.isStealthSyncEnabled()).toBe(false);
  });

  it("keeps the cached answer inside the max age, and re-reads once past it", async () => {
    const m = await freshModule();
    maybeSingle.mockResolvedValue(rowSays(true));
    await m.loadRuntimeFlags();
    await m.loadRuntimeFlags();
    expect(maybeSingle).toHaveBeenCalledTimes(1);
    expect(m.isStealthSyncEnabled()).toBe(true);

    vi.advanceTimersByTime(m.RUNTIME_FLAG_MAX_AGE_MS - 1);
    await m.loadRuntimeFlags();
    expect(maybeSingle).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(2);
    maybeSingle.mockResolvedValue(rowSays(false));
    await m.loadRuntimeFlags();
    expect(maybeSingle).toHaveBeenCalledTimes(2);
    expect(m.isStealthSyncEnabled()).toBe(false);
  });

  it("the background refresh re-reads on the interval without anyone pressing anything", async () => {
    maybeSingle.mockResolvedValue(rowSays(true));
    const m = await freshModule();
    await m.loadRuntimeFlags();
    const stop = m.startRuntimeFlagAutoRefresh();

    maybeSingle.mockResolvedValue(rowSays(false));
    await vi.advanceTimersByTimeAsync(m.RUNTIME_FLAG_MAX_AGE_MS);

    expect(m.isStealthSyncEnabled()).toBe(false);
    stop();
  });

  it("stopping the background refresh really stops it", async () => {
    // Otherwise the interval outlives the page it belongs to, and the only
    // evidence would be a test suite that mysteriously never settles.
    maybeSingle.mockResolvedValue(rowSays(true));
    const m = await freshModule();
    await m.loadRuntimeFlags();
    const stop = m.startRuntimeFlagAutoRefresh();
    stop();

    await vi.advanceTimersByTimeAsync(m.RUNTIME_FLAG_MAX_AGE_MS * 3);
    expect(maybeSingle).toHaveBeenCalledTimes(1);
  });

  it("a backgrounded tab re-reads when it becomes visible again", async () => {
    // A browser is free to throttle an interval in a background tab to once a
    // minute or worse, so the interval alone would leave exactly the long-lived
    // tab this exists for holding the oldest answer.
    const listeners = new Map<string, () => void>();
    const fakeDocument = {
      visibilityState: "hidden",
      addEventListener: (name: string, fn: () => void) => listeners.set(name, fn),
      removeEventListener: (name: string) => listeners.delete(name),
    };
    vi.stubGlobal("document", fakeDocument);

    maybeSingle.mockResolvedValue(rowSays(true));
    const m = await freshModule();
    await m.loadRuntimeFlags();
    const stop = m.startRuntimeFlagAutoRefresh();

    maybeSingle.mockResolvedValue(rowSays(false));

    // Still hidden: the handler fires but must not spend a query.
    listeners.get("visibilitychange")?.();
    await Promise.resolve();
    expect(maybeSingle).toHaveBeenCalledTimes(1);

    fakeDocument.visibilityState = "visible";
    listeners.get("visibilitychange")?.();
    await vi.advanceTimersByTimeAsync(0);

    expect(maybeSingle).toHaveBeenCalledTimes(2);
    expect(m.isStealthSyncEnabled()).toBe(false);

    stop();
    expect(listeners.has("visibilitychange")).toBe(false);
  });

  it("concurrent callers share one read rather than queueing round trips", async () => {
    // Both doors force a read and a background tick can land on top of a press.
    let release: (value: { data: { enabled: boolean }; error: null }) => void = () => {};
    maybeSingle.mockReturnValueOnce(
      new Promise((resolve) => {
        release = resolve;
      }),
    );

    const m = await freshModule();
    const first = m.refreshRuntimeFlags();
    const second = m.refreshRuntimeFlags();
    expect(maybeSingle).toHaveBeenCalledTimes(1);

    release(rowSays(true));
    await Promise.all([first, second]);
    expect(m.isStealthSyncEnabled()).toBe(true);
    expect(maybeSingle).toHaveBeenCalledTimes(1);
  });
});

describe("a gated door is answered by a read that started AFTER the press", () => {
  // OWM-T0587. The plain refresh hands a caller the read that is already
  // running. For the background tick that is exactly right. For a door it means
  // the answer that opens it can predate the press, and the flag flipped off in
  // between is invisible. Only the ON to OFF direction leaks: a read that
  // started before an OFF to ON flip resolves false, which refuses.

  type Row = { data: { enabled: boolean }; error: null };

  /**
   * Wait a real macrotask. Used where the assertion is "the chained read has
   * STARTED", which is a fact about ordering: counting microtasks would couple
   * the test to the number of awaits inside the module and pass for the wrong
   * reason the moment that changes.
   */
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  function pendingRead(): { resolve: (row: Row) => void; promise: Promise<Row> } {
    let resolve: (row: Row) => void = () => {};
    const promise = new Promise<Row>((r) => {
      resolve = r;
    });
    return { resolve, promise };
  }

  it("refuses when the flag is flipped off after a background read was already issued", async () => {
    // The leaking sequence, in order:
    //   t0  the background tick issues its query; the row still says true
    //   t1  operations set stealth_sync_enabled = false
    //   t2  the customer presses Sync, and the door asks for the flag
    //   t3  the PRE-FLIP query resolves true
    // Answering the door with the t0 query opens the gate and the credentials
    // key crosses to the provider origin. The door must get its own read.
    const background = pendingRead();
    maybeSingle.mockReturnValueOnce(background.promise);

    const m = await freshModule();
    const ticked = m.refreshRuntimeFlags(); // t0
    expect(maybeSingle).toHaveBeenCalledTimes(1);

    maybeSingle.mockResolvedValue(rowSays(false)); // t1, the row is off from here on
    const door = m.refreshRuntimeFlagsForDoor(); // t2
    background.resolve(rowSays(true)); // t3, the pre-flip answer arrives

    await ticked;
    await door;

    expect(m.isStealthSyncEnabled()).toBe(false);
    // Two queries: the tick's, and the door's own. Not one shared query.
    expect(maybeSingle).toHaveBeenCalledTimes(2);
  });

  it("the PLAIN refresh, driven the same way, is answered by the pre-flip read", async () => {
    // This is the defect itself, pinned as an executed assertion rather than
    // described in a comment. Identical sequence to the test above, with the
    // only difference being which function the press calls. The plain refresh
    // joins the in-flight query, so the gate ends TRUE on the pre-flip answer
    // and only one query is ever issued. Keep this test: it is the control that
    // proves the test above is measuring the fix and not measuring nothing, and
    // it goes red the day the door starts sharing reads again.
    const background = pendingRead();
    maybeSingle.mockReturnValueOnce(background.promise);

    const m = await freshModule();
    const ticked = m.refreshRuntimeFlags();

    maybeSingle.mockResolvedValue(rowSays(false));
    const press = m.refreshRuntimeFlags();
    background.resolve(rowSays(true));

    await Promise.all([ticked, press]);

    expect(m.isStealthSyncEnabled()).toBe(true);
    expect(maybeSingle).toHaveBeenCalledTimes(1);
  });

  it("costs exactly one query when nothing was already in flight", async () => {
    // The common case. A door that starts its own read has already satisfied
    // "started after the press", so it must not pay for a second one.
    maybeSingle.mockResolvedValue(rowSays(true));
    const m = await freshModule();

    await m.refreshRuntimeFlagsForDoor();

    expect(maybeSingle).toHaveBeenCalledTimes(1);
    expect(m.isStealthSyncEnabled()).toBe(true);
  });

  it("two doors landing on one in-flight read share ONE chained read", async () => {
    // N presses inside one round trip cost one extra query, not N. This is why
    // the fix chains rather than deleting the dedupe outright.
    const background = pendingRead();
    maybeSingle.mockReturnValueOnce(background.promise);

    const m = await freshModule();
    const ticked = m.refreshRuntimeFlags();

    maybeSingle.mockResolvedValue(rowSays(false));
    const doorA = m.refreshRuntimeFlagsForDoor();
    const doorB = m.refreshRuntimeFlagsForDoor();
    background.resolve(rowSays(true));

    await Promise.all([ticked, doorA, doorB]);

    expect(maybeSingle).toHaveBeenCalledTimes(2);
    expect(m.isStealthSyncEnabled()).toBe(false);
  });

  it("a door pressed after the chained read has started chains again", async () => {
    // The subtlety the queued slot has to get right. Once the chained read has
    // begun it is itself a read that started before the NEXT press, so handing
    // it to that press would restore the defect one layer down.
    const background = pendingRead();
    const chained = pendingRead();
    maybeSingle.mockReturnValueOnce(background.promise).mockReturnValueOnce(chained.promise);

    const m = await freshModule();
    const ticked = m.refreshRuntimeFlags();
    const doorA = m.refreshRuntimeFlagsForDoor();
    background.resolve(rowSays(true));
    await ticked;
    await flush();

    // doorA's read is now running: two queries issued, doorA not yet settled.
    expect(maybeSingle).toHaveBeenCalledTimes(2);

    maybeSingle.mockResolvedValue(rowSays(false));
    const doorB = m.refreshRuntimeFlagsForDoor();
    chained.resolve(rowSays(true));

    await Promise.all([doorA, doorB]);

    expect(maybeSingle).toHaveBeenCalledTimes(3);
    expect(m.isStealthSyncEnabled()).toBe(false);
  });
});
