import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../rate-series-cache", () => ({
  getRate: vi.fn(),
}));

import { getRate } from "../rate-series-cache";
import { convertToHouseholdCurrencies } from "../currency-conversion-bridge";

const mockGetRate = vi.mocked(getRate);
const DATE = new Date("2026-06-01T00:00:00.000Z");

// currency units per 1 BTC, same convention as rate-series-cache/orbi-rates
const RATES: Record<string, number> = {
  USD: 50_000,
  EUR: 40_000,
  GBP: 25_000,
};

beforeEach(() => {
  mockGetRate.mockReset();
  mockGetRate.mockImplementation(async (currency: string) => RATES[currency]);
});

describe("convertToHouseholdCurrencies normal conversion", () => {
  it("bridges native through BTC to both selections and matches hand-computed cross rates", async () => {
    // amount=100 USD -> BTC = 100/50000 = 0.002 BTC
    // -> EUR = 0.002 * 40000 = 80, -> GBP = 0.002 * 25000 = 50
    const result = await convertToHouseholdCurrencies(100, "USD", DATE, "EUR", "GBP");
    expect(result.selection1).toEqual({ value: 80 });
    expect(result.selection2).toEqual({ value: 50 });
  });
});

describe("convertToHouseholdCurrencies missing leg", () => {
  it("marks only the currency with a missing rate unavailable; the other still resolves", async () => {
    mockGetRate.mockImplementation(async (currency: string) => {
      if (currency === "EUR") return undefined;
      return RATES[currency];
    });

    const result = await convertToHouseholdCurrencies(100, "USD", DATE, "EUR", "GBP");
    expect(result.selection1).toEqual({ unavailable: true });
    expect(result.selection2).toEqual({ value: 50 });
  });

  it("marks a selection unavailable when the NATIVE currency's own rate is missing", async () => {
    mockGetRate.mockImplementation(async (currency: string) => {
      if (currency === "USD") return undefined;
      return RATES[currency];
    });

    const result = await convertToHouseholdCurrencies(100, "USD", DATE, "EUR", "GBP");
    expect(result.selection1).toEqual({ unavailable: true });
    expect(result.selection2).toEqual({ unavailable: true });
  });
});

describe("convertToHouseholdCurrencies native equals a selection", () => {
  it("skips the bridge and every rate lookup for the matching selection", async () => {
    const result = await convertToHouseholdCurrencies(100, "USD", DATE, "USD", "GBP");
    expect(result.selection1).toEqual({ value: 100 });
    expect(result.selection2).toEqual({ value: 50 });

    // The GBP leg legitimately needs getRate("USD", ...) to build its own BTC
    // bridge, so "getRate was never called with USD" is not the property to
    // check. The property is that the matching (USD) leg added ZERO extra
    // lookups on top of what the GBP leg alone required: one call for the
    // native rate, one for GBP's own rate, and nothing more.
    expect(
      mockGetRate.mock.calls.length,
      "getRate was called more than twice. The USD selection matched the native " +
        "currency and should not have added any lookup of its own on top of what " +
        "the GBP leg's bridge already needed.",
    ).toBe(2);
  });

  it("makes zero rate lookups when BOTH selections match the native currency", async () => {
    const result = await convertToHouseholdCurrencies(100, "USD", DATE, "USD", "USD");
    expect(result.selection1).toEqual({ value: 100 });
    expect(result.selection2).toEqual({ value: 100 });
    expect(
      mockGetRate.mock.calls.length,
      "getRate was called even though both selections matched the native currency; " +
        "neither leg needs a bridge.",
    ).toBe(0);
  });
});
