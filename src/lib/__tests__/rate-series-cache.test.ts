import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../orbi-rates", () => ({
  fetchRateMatrix: vi.fn(),
}));

import { fetchRateMatrix } from "../orbi-rates";
import { getRate, primeRateRange, __resetRateCacheForTests } from "../rate-series-cache";

const mockFetchRateMatrix = vi.mocked(fetchRateMatrix);

beforeEach(() => {
  __resetRateCacheForTests();
  mockFetchRateMatrix.mockReset();
});

describe("getRate cache hit", () => {
  it("does not call fetchRateMatrix again on the second lookup for the same currency/date", async () => {
    mockFetchRateMatrix.mockResolvedValue([
      { targetCurrency: "USD", rate: 65_000, bucketTs: "2026-06-15T00:00:00.000Z" },
    ]);

    const date = new Date("2026-06-15T12:00:00.000Z");
    const first = await getRate("USD", date);
    const second = await getRate("USD", date);

    expect(first).toBe(65_000);
    expect(second).toBe(65_000);
    expect(
      mockFetchRateMatrix.mock.calls.length,
      "getRate refetched on the second lookup for a currency/date it already has cached.",
    ).toBe(1);
  });
});

describe("getRate cache miss", () => {
  it("triggers a fetch scoped only to a date range, with no currency/account/household/user identifier", async () => {
    mockFetchRateMatrix.mockResolvedValue([
      { targetCurrency: "EUR", rate: 60_000, bucketTs: "2026-03-10T00:00:00.000Z" },
    ]);

    const result = await getRate("EUR", new Date("2026-03-10T09:00:00.000Z"));

    expect(result).toBe(60_000);
    expect(mockFetchRateMatrix.mock.calls.length).toBe(1);
    const args = mockFetchRateMatrix.mock.calls[0];
    expect(
      args.length,
      "fetchRateMatrix was called with more than (startDate, endDate, [granularity]). " +
        "An extra argument here is exactly the shape a currency, account, household or " +
        "user identifier would take.",
    ).toBeLessThanOrEqual(3);
    for (const arg of args.slice(0, 2)) {
      expect(arg instanceof Date, "the range bounds must be Date objects, not an id string").toBe(
        true,
      );
    }
  });

  it("primeRateRange dedupes a concurrent request for the same range", async () => {
    mockFetchRateMatrix.mockResolvedValue([
      { targetCurrency: "CAD", rate: 90_000, bucketTs: "2026-01-05T00:00:00.000Z" },
    ]);
    const start = new Date("2026-01-01T00:00:00.000Z");
    const end = new Date("2026-01-31T23:59:59.000Z");

    await Promise.all([primeRateRange(start, end), primeRateRange(start, end)]);

    expect(
      mockFetchRateMatrix.mock.calls.length,
      "two concurrent primeRateRange calls for the identical range issued more than one request.",
    ).toBe(1);
  });
});

describe("getRate missing rate", () => {
  it("returns undefined for a date outside the fetched range, never a substituted value", async () => {
    mockFetchRateMatrix.mockResolvedValue([]);

    const result = await getRate("GBP", new Date("2026-07-04T00:00:00.000Z"));

    expect(
      result,
      "a rate that does not exist must come back as undefined, never a guessed or " +
        "substituted number.",
    ).toBeUndefined();
  });
});
