/**
 * The stealth kill switch must fail CLOSED (DL-1466).
 *
 * This module used to fall back to the build-time constant, which prod shipped
 * as `true`. The gate therefore read true until the app_flags row resolved, and
 * stayed true permanently if that read failed. Measured on production: a 507ms
 * window on a cold load, unbounded on a query error.
 *
 * These tests exist because a fail-closed path nobody has watched go red is a
 * claim, not a fix. Each one drives a different way the read can let us down
 * and asserts the same thing: the gate reads false.
 *
 * maybeSingle() is the last call in the chain, so each test swaps only that.
 * The module keeps `loaded` at module scope, so every test re-imports through
 * vi.resetModules() to get a fresh, unloaded instance.
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
    maybeSingle.mockResolvedValue({ data: { enabled: false }, error: null });
    const m = await freshModule();
    await m.loadRuntimeFlags();
    expect(m.isStealthSyncEnabled()).toBe(false);
  });

  it("is ON only when a successful read returns enabled true", async () => {
    // The positive control. Without this, every assertion above would still
    // pass against a module that hardcoded false, and the tests would prove
    // nothing about the switch actually working.
    maybeSingle.mockResolvedValue({ data: { enabled: true }, error: null });
    const m = await freshModule();
    await m.loadRuntimeFlags();
    expect(m.isStealthSyncEnabled()).toBe(true);
  });

  it("does not re-read on a second call, and keeps the first answer", async () => {
    maybeSingle.mockResolvedValue({ data: { enabled: true }, error: null });
    const m = await freshModule();
    await m.loadRuntimeFlags();
    await m.loadRuntimeFlags();
    expect(maybeSingle).toHaveBeenCalledTimes(1);
    expect(m.isStealthSyncEnabled()).toBe(true);
  });
});
