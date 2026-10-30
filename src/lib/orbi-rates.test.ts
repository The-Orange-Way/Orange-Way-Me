/**
 * Tests for isBtcRateStale (OWM-T0777: stale BTC price notice).
 *
 * The staleness check compares the ORBI bucket timestamp against
 * STALE_RATE_MAX_MS (30 minutes). The in-memory cache is module-level,
 * so each test group seeds it via refreshLiveBTCRate after mocking fetch
 * to return a rate with a controlled bucketTs.
 */
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

// Stub VITE_SUPABASE_URL so edgeFunctionBase() returns a real URL and
// callEdgeFunction does not short-circuit before reaching our fetch mock.
vi.stubEnv("VITE_SUPABASE_URL", "https://test-project.supabase.co");
vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "test-anon-key");

import { refreshLiveBTCRate, isBtcRateStale, STALE_RATE_MAX_MS } from "./orbi-rates";

// ── helpers ──────────────────────────────────────────────────────────────────

/** Seed the in-memory cache with a rate whose bucketTs is `msAgo` milliseconds in the past. */
async function seedCache(target: string, msAgo: number): Promise<void> {
  const bucketTs = new Date(Date.now() - msAgo).toISOString();
  globalThis.fetch = vi.fn().mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      id: "bucket-test",
      rate: 67_000,
      tier: "A",
      bucketTs,
      providerCount: 3,
      composite: false,
    }),
  } as unknown as Response);
  await refreshLiveBTCRate(target);
}

// ── isBtcRateStale ───────────────────────────────────────────────────────────

describe("isBtcRateStale", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("returns true when no snapshot is cached", () => {
    // A currency with no cache entry at all.
    expect(isBtcRateStale("XYZ_NEVER_SEEDED")).toBe(true);
  });

  it("returns true for a bucket 34 days old", async () => {
    const thirtyFourDaysMs = 34 * 24 * 60 * 60 * 1_000;
    await seedCache("USD", thirtyFourDaysMs);
    expect(isBtcRateStale("USD")).toBe(true);
  });

  it("returns false for a bucket 10 minutes old", async () => {
    const tenMinutesMs = 10 * 60 * 1_000;
    await seedCache("USD", tenMinutesMs);
    expect(isBtcRateStale("USD")).toBe(false);
  });

  it("stale threshold is exactly STALE_RATE_MAX_MS (30 minutes)", () => {
    // Verify the exported constant has the right value.
    expect(STALE_RATE_MAX_MS).toBe(30 * 60 * 1_000);
  });

  it("returns false for a bucket just under the threshold", async () => {
    // One second younger than the limit.
    await seedCache("USD", STALE_RATE_MAX_MS - 1_000);
    expect(isBtcRateStale("USD")).toBe(false);
  });

  it("returns true for a bucket just over the threshold", async () => {
    // One second older than the limit.
    await seedCache("USD", STALE_RATE_MAX_MS + 1_000);
    expect(isBtcRateStale("USD")).toBe(true);
  });
});

// ── Banner logic (without rendering React) ──────────────────────────────────
//
// StaleBtcPriceBanner renders when isBtcRateStale("USD") is true and hides
// when it is false. The tests below confirm the function-level contract that
// drives the banner's visibility.

describe("banner visibility logic via isBtcRateStale", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("banner condition is true (stale) with a 34-day-old bucket", async () => {
    await seedCache("USD", 34 * 24 * 60 * 60 * 1_000);
    const shouldShowBanner = isBtcRateStale("USD");
    expect(shouldShowBanner).toBe(true);
  });

  it("banner condition is false (fresh) with a 10-minute-old bucket", async () => {
    await seedCache("USD", 10 * 60 * 1_000);
    const shouldShowBanner = isBtcRateStale("USD");
    expect(shouldShowBanner).toBe(false);
  });
});
