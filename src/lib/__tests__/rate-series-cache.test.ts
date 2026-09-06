import { describe, it, expect, beforeEach, vi } from "vitest";
import { loadRateSeries, getRate, __resetRateCacheForTests } from "../rate-series-cache";

describe("rate-series-cache", () => {
  beforeEach(() => {
    __resetRateCacheForTests();
  });

  it("caches a loaded range: a second load of the same currency/range triggers no new fetch", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue([{ rate: 65000, bucketTs: "2026-08-19T00:00:00.000Z" }]);
    const start = new Date("2026-08-19T00:00:00.000Z");
    const end = new Date("2026-08-19T23:59:59.000Z");

    await loadRateSeries("USD", start, end, fetcher);
    await loadRateSeries("USD", start, end, fetcher);

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(getRate("USD", start)).toBe(65000);
  });

  it("the fetch request carries only a currency and a date range, nothing else", async () => {
    const fetcher = vi.fn().mockResolvedValue([]);
    const start = new Date("2026-08-19T00:00:00.000Z");
    const end = new Date("2026-08-20T00:00:00.000Z");

    await loadRateSeries("EUR", start, end, fetcher);

    expect(fetcher).toHaveBeenCalledWith("EUR", start, end);
    // Exactly three arguments: currency, start, end. There is no fourth
    // parameter for an account, household, transaction or user id to ride in on.
    expect(fetcher.mock.calls[0]).toHaveLength(3);
  });

  it("returns undefined for a date with no cached rate, never a guess or a substituted value", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue([{ rate: 65000, bucketTs: "2026-08-19T00:00:00.000Z" }]);
    await loadRateSeries("USD", new Date("2026-08-19"), new Date("2026-08-19"), fetcher);

    expect(getRate("USD", new Date("2026-08-20"))).toBeUndefined();
    expect(getRate("GBP", new Date("2026-08-19"))).toBeUndefined();
  });

  it("a currency never loaded returns undefined rather than throwing", () => {
    expect(getRate("JPY", new Date())).toBeUndefined();
  });

  it("BTC to BTC is always 1 and needs no fetch", () => {
    expect(getRate("BTC", new Date())).toBe(1);
  });
});
