/**
 * Tests for isBtcRateStale (OWM-T0777: stale BTC price notice).
 *
 * The staleness check compares the ORBI bucket timestamp against
 * STALE_RATE_MAX_MS (30 minutes). The in-memory cache is module-level,
 * so each test group seeds it via refreshLiveBTCRate after mocking fetch
 * to return a rate with a controlled bucketTs.
 */
import { vi, describe, it, expect, afterEach } from "vitest";

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
    json: async () => [{ id: "bucket-test", rate: 67_000, tier: "A", bucket_ts: bucketTs, provider_count: 3, composite: false }],
  } as unknown as Response);
  await refreshLiveBTCRate(target);
}

/** Seed a FAILED refresh: settledTargets gets the key but liveBTCRates does not. */
async function seedFailedRefresh(target: string): Promise<void> {
  globalThis.fetch = vi.fn().mockResolvedValueOnce({
    ok: false,
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

  it("returns false when refresh has not settled yet (no warning during startup)", () => {
    // A currency that was never passed to refreshLiveBTCRate -- first fetch
    // may still be in flight.  Banner must stay hidden.
    expect(isBtcRateStale("XYZ_NEVER_REFRESHED")).toBe(false);
  });

  it("returns true when refresh completed but returned no rate (static fallback in use)", async () => {
    // Fetch resolves with ok:false; settledTargets has the key but liveBTCRates does not.
    await seedFailedRefresh("XYZ_FAILED_REFRESH");
    expect(isBtcRateStale("XYZ_FAILED_REFRESH")).toBe(true);
  });

  it("returns true for a bucket 34 days old", async () => {
    const thirtyFourDaysMs = 34 * 24 * 60 * 60 * 1_000;
    await seedCache("USD", thirtyFourDaysMs);
    expect(isBtcRateStale("USD")).toBe(true);
  });

  it("returns false for a bucket 10 minutes old", async () => {
    const tenMinutesMs = 10 * 60 * 1_000;
    await seedCache("EUR", tenMinutesMs);
    expect(isBtcRateStale("EUR")).toBe(false);
  });

  it("stale threshold is exactly STALE_RATE_MAX_MS (30 minutes)", () => {
    // Verify the exported constant has the right value.
    expect(STALE_RATE_MAX_MS).toBe(30 * 60 * 1_000);
  });

  it("returns false for a bucket just under the threshold", async () => {
    // One second younger than the limit.
    await seedCache("GBP", STALE_RATE_MAX_MS - 1_000);
    expect(isBtcRateStale("GBP")).toBe(false);
  });

  it("returns true for a bucket just over the threshold", async () => {
    // One second older than the limit.
    await seedCache("CAD", STALE_RATE_MAX_MS + 1_000);
    expect(isBtcRateStale("CAD")).toBe(true);
  });

  it("returns true when snapshot has no bucketTs", async () => {
    // Response omits bucketTs; toORBIRate stores it as "".
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => [{ id: "no-bucket", rate: 67_000, tier: "A", provider_count: 3, composite: false }],
    } as unknown as Response);
    await refreshLiveBTCRate("JPY");
    expect(isBtcRateStale("JPY")).toBe(true);
  });

  it("returns true when bucketTs is not a valid date", async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => [{ id: "bad-bucket", rate: 67_000, tier: "A", bucket_ts: "not-a-date", provider_count: 3, composite: false }],
    } as unknown as Response);
    await refreshLiveBTCRate("CHF");
    expect(isBtcRateStale("CHF")).toBe(true);
  });
});

// ── OR view reader: empty list and one-row cases (OWM-T0472) ─────────────────
//
// fetchLatestBTCRateFromView returns null when the view is empty (price > 2 days
// old). That null is what isBtcRateStale uses to show "price unavailable".
// When the view returns one fresh row, the cache is populated and no banner appears.

describe("OR view reader: orbi_btc_usd_latest", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("empty list (price > 2 days old): refreshLiveBTCRate returns null and isBtcRateStale returns true", async () => {
    // The view returns [] when the latest settled price is older than 2 days.
    // The UI must show "price unavailable" -- never 0, never a stale cached number.
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => [],
    } as unknown as Response);
    const result = await refreshLiveBTCRate("VTEST_EMPTY");
    expect(result).toBeNull();
    expect(isBtcRateStale("VTEST_EMPTY")).toBe(true);
  });

  it("one row (fresh price): rate is cached and isBtcRateStale returns false", async () => {
    // Five-minute-old bucket is well within the 30-minute stale threshold.
    const freshBucketTs = new Date(Date.now() - 5 * 60 * 1_000).toISOString();
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => [
        {
          id: "view-row-1",
          rate: 70_000,
          tier: "C-composite",
          bucket_ts: freshBucketTs,
          provider_count: 4,
          composite: true,
        },
      ],
    } as unknown as Response);
    const result = await refreshLiveBTCRate("VTEST_FRESH");
    expect(result).not.toBeNull();
    expect(result?.rate).toBe(70_000);
    expect(isBtcRateStale("VTEST_FRESH")).toBe(false);
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
    await seedCache("AUD", 34 * 24 * 60 * 60 * 1_000);
    const shouldShowBanner = isBtcRateStale("AUD");
    expect(shouldShowBanner).toBe(true);
  });

  it("banner condition is false (fresh) with a 10-minute-old bucket", async () => {
    await seedCache("NZD", 10 * 60 * 1_000);
    const shouldShowBanner = isBtcRateStale("NZD");
    expect(shouldShowBanner).toBe(false);
  });
});
