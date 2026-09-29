/**
 * OWM-T0133: the dashboard priced satoshi balances as whole BTC, so net worth
 * read about 94 billion dollars.
 *
 * The read-path fix landed on dev before this file existed and was re-verified
 * present twice (srdev-owm 2026-09-05, developer-owm 2026-09-11). What did NOT
 * exist was any test holding it there: a grep of every __tests__ file on dev on
 * 2026-09-15 found zero assertions about convert() and sats. So the fix could
 * regress silently, which for this bug means a customer's net worth is wrong by
 * a factor of one hundred million.
 *
 * These cases exist to fail loudly if that happens. The static fallback rate is
 * used throughout: convert() falls back to STATIC_BTC_USD when no live ORBI
 * quote is loaded, which is the case in a unit test, so every number here is
 * deterministic.
 */
import { describe, expect, it } from "vitest";

import { convert } from "../fx-rates";

const STATIC_BTC_USD = 65_000;
const SATS_PER_BTC = 1e8;

describe("convert(): a sats balance is priced as sats, never as whole BTC", () => {
  it("prices the exact shape that produced the 94 billion dollar reading", () => {
    // 1,500,000 sats is 0.015 BTC, about 975 dollars at the static rate.
    // Priced wrongly as whole BTC it is 1.5e6 * 65000, about 97.5 BILLION.
    const usd = convert(1_500_000, "sats", "USD");
    expect(usd).toBeCloseTo((1_500_000 / SATS_PER_BTC) * STATIC_BTC_USD, 6);
    expect(usd).toBeLessThan(10_000);
  });

  it("never inflates a sats balance by anything close to 1e8", () => {
    // The regression is multiplicative, so assert the ratio directly rather
    // than a magic number. Any reintroduction lands far outside this band.
    for (const sats of [1, 21, 100_000, 1_500_000, 2_100_000_000]) {
      const usd = convert(sats, "sats", "USD");
      const correct = (sats / SATS_PER_BTC) * STATIC_BTC_USD;
      expect(usd / correct).toBeCloseTo(1, 6);
    }
  });

  it("holds the edges the acceptance criteria name: zero and one satoshi", () => {
    expect(convert(0, "sats", "USD")).toBe(0);

    const oneSat = convert(1, "sats", "USD");
    expect(Number.isFinite(oneSat)).toBe(true);
    expect(oneSat).toBeGreaterThan(0);
    expect(oneSat).toBeLessThan(0.01);
  });

  it("returns 0 rather than NaN for a non-finite amount", () => {
    expect(convert(Number.NaN, "sats", "USD")).toBe(0);
    expect(convert(Number.POSITIVE_INFINITY, "sats", "USD")).toBe(0);
  });
});

describe("convert(): a BTC-labelled balance, stamped and unstamped", () => {
  it("prices a STAMPED 1 BTC as one whole bitcoin", () => {
    // format_version >= 1 means the writer recorded the unit, so no magnitude
    // guessing. This is the DL-1449 branch that stops 1 BTC reading as 1 sat.
    expect(convert(1, "BTC", "USD", { unitIsExact: true })).toBeCloseTo(STATIC_BTC_USD, 6);
  });

  it("prices a decimal BTC amount correctly whether or not it is stamped", () => {
    // 0.5 is not an integer, so both paths agree it means bitcoin.
    const expected = 0.5 * STATIC_BTC_USD;
    expect(convert(0.5, "BTC", "USD", { unitIsExact: true })).toBeCloseTo(expected, 6);
    expect(convert(0.5, "BTC", "USD")).toBeCloseTo(expected, 6);
  });

  it("documents the UNSTAMPED integer case as sats, which is deliberate", () => {
    // An unstamped integer >= 1 under a BTC label is read as sats, because the
    // rows already stored that way would be rescaled by 1e8 the other way if
    // the guess were dropped. Pinned so nobody 'fixes' it without reading
    // DL-1449 first: the correct fix is to stamp the row, not to change this.
    expect(convert(1, "BTC", "USD")).toBeCloseTo(STATIC_BTC_USD / SATS_PER_BTC, 12);
  });

  it("never prices a BTC-labelled integer balance as whole BTC when unstamped", () => {
    // This is the actual 94-billion mechanism: raw sats under a BTC label
    // multiplied by the full BTC price.
    expect(convert(1_500_000, "BTC", "USD")).toBeLessThan(10_000);
  });
});

describe("convert(): round trips and unknown currencies", () => {
  it("sats and BTC agree on the same holding", () => {
    const viaSats = convert(SATS_PER_BTC, "sats", "USD");
    const viaBtc = convert(1, "BTC", "USD", { unitIsExact: true });
    expect(viaSats).toBeCloseTo(viaBtc, 6);
  });

  it("treats an unrecognised currency as USD rather than throwing", () => {
    expect(convert(10, "XYZ", "USD")).toBe(10);
  });
});
