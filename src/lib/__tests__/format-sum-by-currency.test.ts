/**
 * @vitest-environment node
 *
 * DL-1450: a total must convert every amount into one unit BEFORE adding them.
 *
 * The app stores a bitcoin balance under currency "BTC" whether the number is a
 * sats integer (imported) or a decimal BTC value (hand entered), so the unit is
 * inferred from the magnitude by normalizeBitcoinToSats. That inference is only
 * ever valid on a single account's value. sumByCurrency used to add the raw
 * numbers and normalize the total once at the end, which reported a mixed-unit
 * holding roughly 1e8 times larger than it is.
 *
 * The mechanism, and the reason no earlier test caught it: a sats integer plus
 * a decimal BTC value is a non-integer, the heuristic reads any non-integer as
 * decimal BTC, multiplies by 1e8, and the display divides by 1e8 again. The
 * wrong number survives the round trip intact. Every single-account test still
 * passed the whole time.
 *
 * DL-1450 was previously closed as "no defect, all paths convert to primary
 * currency before summing". These cases exist so that conclusion cannot be
 * reached again without a red test.
 */

import { describe, it, expect } from "vitest";
import {
  formatTotalsWithMode,
  isBitcoinCurrency,
  normalizeBitcoinToSats,
  sumByCurrency,
} from "../format";

describe("sumByCurrency", () => {
  // A wallet set shaped like the one that exposed this, with synthetic
  // amounts. Two imported accounts holding sats integers, one hand-entered
  // account holding decimal BTC:
  //   2000000 -> imported, stored as sats
  //       500 -> imported, stored as sats
  //      0.25 -> hand entered, decimal BTC, worth 25_000_000 sats
  const MIXED_UNIT_WALLETS = [
    { amount: "2000000", currency: "BTC" },
    { amount: "500", currency: "BTC" },
    { amount: "0.25", currency: "BTC" },
  ];

  it("totals a mixed-unit wallet set in one unit", () => {
    const totals = sumByCurrency(MIXED_UNIT_WALLETS);
    expect(totals).toEqual({ sats: 27_000_500 });
    expect(formatTotalsWithMode(totals, "btc", "en-US")).toBe("0.27000500 BTC");
  });

  it("no longer inflates a mixed-unit total by 1e8", () => {
    const totals = sumByCurrency(MIXED_UNIT_WALLETS);
    // What the raw-sum-then-normalize order rendered for this set: the sats
    // integers added straight onto the decimal BTC value, the non-integer
    // result then read as decimal BTC, and the 1e8 round trip preserving it.
    expect(formatTotalsWithMode(totals, "btc", "en-US")).not.toBe("2,000,500.25000000 BTC");
  });

  it("puts BTC-denominated and sats-denominated rows in one bucket", () => {
    // Same asset, two units. Two separate buckets would render as
    // "0.50000000 BTC / 0.00001000 BTC" side by side, which is not a total.
    expect(
      sumByCurrency([
        { amount: "0.5", currency: "BTC" },
        { amount: "1000", currency: "sats" },
      ]),
    ).toEqual({ sats: 50_001_000 });
  });

  it("leaves a pure sats set untouched", () => {
    expect(
      sumByCurrency([
        { amount: "1000", currency: "sats" },
        { amount: "2500", currency: "sats" },
      ]),
    ).toEqual({ sats: 3500 });
  });

  it("converts a pure decimal BTC set", () => {
    expect(
      sumByCurrency([
        { amount: "0.5", currency: "BTC" },
        { amount: "0.25", currency: "BTC" },
      ]),
    ).toEqual({ sats: 75_000_000 });
  });

  it("does not touch fiat", () => {
    expect(
      sumByCurrency([
        { amount: "100", currency: "USD" },
        { amount: "50.25", currency: "USD" },
        { amount: "20", currency: "EUR" },
      ]),
    ).toEqual({ USD: 150.25, EUR: 20 });
  });

  it("skips a non-numeric balance instead of poisoning its bucket", () => {
    // Previously this added NaN and the whole USD total rendered as "NaN",
    // hiding every other account in the group.
    expect(
      sumByCurrency([
        { amount: "not a number", currency: "USD" },
        { amount: "10", currency: "USD" },
      ]),
    ).toEqual({ USD: 10 });
  });

  it("returns an empty object for no accounts", () => {
    expect(sumByCurrency([])).toEqual({});
  });

  it("keeps a zero bitcoin balance as a zero sats bucket", () => {
    expect(sumByCurrency([{ amount: "0", currency: "BTC" }])).toEqual({ sats: 0 });
  });
});

describe("isBitcoinCurrency", () => {
  it("accepts both bitcoin units and nothing else", () => {
    expect(isBitcoinCurrency("BTC")).toBe(true);
    expect(isBitcoinCurrency("sats")).toBe(true);
    expect(isBitcoinCurrency("USD")).toBe(false);
    expect(isBitcoinCurrency("btc")).toBe(false);
  });
});

describe("normalizeBitcoinToSats: the limitation this change does NOT fix", () => {
  it("still misreads a whole number of BTC as sats (DL-1449, issue #343)", () => {
    // A user holding exactly 1 BTC who types "1" is recorded as 1 sat. This
    // test pins the current behaviour rather than endorsing it: the real fix
    // is to store the unit instead of inferring it, which is DL-1449. When
    // that lands, this expectation is the one to flip.
    expect(normalizeBitcoinToSats(1, "BTC")).toBe(1);
    expect(normalizeBitcoinToSats(1.0, "BTC")).toBe(1);
    // The workaround users are implicitly relying on today:
    expect(normalizeBitcoinToSats(1.00000001, "BTC")).toBe(100_000_001);
  });
});
