/**
 * The kill switch has to tell its readers when it settles (OWM-T0478).
 *
 * The value is false until the boot read of app_flags lands, so anything
 * RENDERING on this flag (the add-connection button) needs to hear that the
 * read happened. A one-shot read leaves the button hidden forever on a page
 * that mounted first, which is safe and still a defect.
 *
 * Sibling file runtimeFlags.test.ts covers the fail-closed rule itself. This
 * file covers only the notification, including the two ways it goes wrong
 * silently: firing when nothing changed, and firing after unsubscribe.
 *
 * maybeSingle() is the last call in the chain, so each test swaps only that.
 * `loaded` and the listener set are module scope, so every test re-imports
 * through vi.resetModules() to get a fresh instance.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

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

beforeEach(() => {
  maybeSingle.mockReset();
});

describe("subscribeStealthSyncEnabled", () => {
  it("notifies a subscriber when the read turns the gate on", async () => {
    maybeSingle.mockResolvedValue({ data: { enabled: true }, error: null });
    const m = await freshModule();

    const seen: boolean[] = [];
    m.subscribeStealthSyncEnabled(() => seen.push(m.isStealthSyncEnabled()));

    expect(m.isStealthSyncEnabled()).toBe(false);
    await m.loadRuntimeFlags();

    expect(seen).toEqual([true]);
    expect(m.isStealthSyncEnabled()).toBe(true);
  });

  it("does NOT notify when the read leaves the gate off", async () => {
    // The ordinary production case today: the flag row says false, so the
    // value never changes and no subscriber should be woken.
    maybeSingle.mockResolvedValue({ data: { enabled: false }, error: null });
    const m = await freshModule();

    const listener = vi.fn();
    m.subscribeStealthSyncEnabled(listener);
    await m.loadRuntimeFlags();

    expect(listener).not.toHaveBeenCalled();
    expect(m.isStealthSyncEnabled()).toBe(false);
  });

  it("does not notify after unsubscribe", async () => {
    maybeSingle.mockResolvedValue({ data: { enabled: true }, error: null });
    const m = await freshModule();

    const listener = vi.fn();
    const unsubscribe = m.subscribeStealthSyncEnabled(listener);
    unsubscribe();
    await m.loadRuntimeFlags();

    expect(listener).not.toHaveBeenCalled();
    // The gate itself still flipped: unsubscribing is about who hears it,
    // never about what the flag says.
    expect(m.isStealthSyncEnabled()).toBe(true);
  });

  it("survives a listener that unsubscribes itself while being notified", async () => {
    // Iterating the live set would throw or skip here. The module notifies
    // over a copy; this is the case that proves it.
    maybeSingle.mockResolvedValue({ data: { enabled: true }, error: null });
    const m = await freshModule();

    const second = vi.fn();
    let unsubscribeFirst: (() => void) | null = null;
    unsubscribeFirst = m.subscribeStealthSyncEnabled(() => {
      unsubscribeFirst?.();
    });
    m.subscribeStealthSyncEnabled(second);

    await m.loadRuntimeFlags();

    expect(second).toHaveBeenCalledTimes(1);
  });
});
