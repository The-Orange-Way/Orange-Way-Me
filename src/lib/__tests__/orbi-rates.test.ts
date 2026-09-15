/**
 * @vitest-environment node
 *
 * OWM-T0159: historical conversion must fetch a public annual rate series,
 * never one request shaped by a transaction or the household's selections.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const createClient = vi.fn();

vi.mock("@supabase/supabase-js", () => ({ createClient }));

function mockORBI(rows: unknown[]) {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    in: vi.fn(),
    gte: vi.fn(),
    lt: vi.fn(),
    order: vi.fn(),
    range: vi.fn().mockResolvedValue({ data: rows, error: null }),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.in.mockReturnValue(query);
  query.gte.mockReturnValue(query);
  query.lt.mockReturnValue(query);
  query.order.mockReturnValue(query);

  const client = { from: vi.fn().mockReturnValue(query) };
  createClient.mockReturnValue(client);
  return { client, query };
}

describe("fetchBTCRateSeries", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("VITE_ORBI_SUPABASE_URL", "https://orbi.invalid");
    vi.stubEnv("VITE_ORBI_SUPABASE_ANON_KEY", "public-test-key");
    createClient.mockReset();
  });

  it("requests a fixed full-year, full-fiat daily matrix and groups it locally", async () => {
    const { query } = mockORBI([
      {
        id: "usd-1",
        rate: "65000.50",
        tier: "A",
        bucket_ts: "2026-01-01T00:00:00.000Z",
        provider_count: 3,
        composite: true,
        target_currency: "USD",
      },
      {
        id: "cad-1",
        rate: 88000,
        tier: "B",
        bucket_ts: "2026-01-01T00:00:00.000Z",
        provider_count: 2,
        composite: false,
        target_currency: "CAD",
      },
    ]);

    const { fetchBTCRateSeries, ORBI_RATE_TARGETS } = await import("../orbi-rates");
    const series = await fetchBTCRateSeries(2026);

    expect(query.in).toHaveBeenCalledWith("target_currency", [...ORBI_RATE_TARGETS]);
    expect(query.eq).toHaveBeenCalledWith("granularity", "1d");
    expect(query.gte).toHaveBeenCalledWith("bucket_ts", "2026-01-01T00:00:00.000Z");
    expect(query.lt).toHaveBeenCalledWith("bucket_ts", "2027-01-01T00:00:00.000Z");
    expect(series?.USD).toEqual([
      {
        id: "usd-1",
        rate: 65000.5,
        tier: "A",
        bucketTs: "2026-01-01T00:00:00.000Z",
        providerCount: 3,
        composite: true,
      },
    ]);
    expect(series?.CAD).toHaveLength(1);
    expect(series?.EUR).toEqual([]);
    expect(series?.GBP).toEqual([]);
  });

  it("deduplicates repeated annual requests in the client cache", async () => {
    const { query } = mockORBI([]);
    const { fetchBTCRateSeries } = await import("../orbi-rates");

    const [first, second] = await Promise.all([fetchBTCRateSeries(2025), fetchBTCRateSeries(2025)]);
    const third = await fetchBTCRateSeries(2025);

    expect(first).toBe(second);
    expect(second).toBe(third);
    expect(query.range).toHaveBeenCalledTimes(1);
  });

  it("does not query ORBI for an invalid calendar year", async () => {
    mockORBI([]);
    const { fetchBTCRateSeries } = await import("../orbi-rates");

    await expect(fetchBTCRateSeries(2026.5)).resolves.toBeNull();
    expect(createClient).not.toHaveBeenCalled();
  });
});
