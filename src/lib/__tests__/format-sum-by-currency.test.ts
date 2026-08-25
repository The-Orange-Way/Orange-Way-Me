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
  unitIsExact,
  sumByCurrency,
  toBalanceEntry,
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

describe("unitIsExact: which rows we are allowed to stop guessing about", () => {
  it("treats an absent or zero format_version as not exact", () => {
    // Absent has to mean the cautious value. A row read by a query that does
    // not select the column must not be mistaken for a stamped one.
    expect(unitIsExact(undefined)).toBe(false);
    expect(unitIsExact(0)).toBe(false);
  });

  it("treats format_version 1 and above as exact", () => {
    expect(unitIsExact(1)).toBe(true);
    expect(unitIsExact(2)).toBe(true);
  });
});

describe("normalizeBitcoinToSats: a stamped row is taken at its word", () => {
  it("reads a whole number of BTC as BTC when the row is stamped", () => {
    // This is the case the product has been getting wrong: a customer holding
    // exactly 1 BTC. Unstamped, the magnitude heuristic reads it as 1 sat and
    // the dashboard renders $0.00. Stamped, the label is authoritative.
    expect(normalizeBitcoinToSats(1, "BTC", { unitIsExact: true })).toBe(100_000_000);
    expect(normalizeBitcoinToSats(2, "BTC", { unitIsExact: true })).toBe(200_000_000);
  });

  it("keeps guessing on an unstamped row, because we still do not know", () => {
    // Deliberately unchanged. format_version 0 means the writer did not record
    // the unit, so the magnitude heuristic is still the only signal available
    // and removing it would silently rescale every legacy sats row by 1e8.
    expect(normalizeBitcoinToSats(1, "BTC")).toBe(1);
    expect(normalizeBitcoinToSats(1, "BTC", { unitIsExact: false })).toBe(1);
  });

  it("leaves an explicit sats row alone whether stamped or not", () => {
    // currency "sats" was never ambiguous, so the flag must not perturb it.
    expect(normalizeBitcoinToSats(50_000, "sats")).toBe(50_000);
    expect(normalizeBitcoinToSats(50_000, "sats", { unitIsExact: true })).toBe(50_000);
  });

  it("agrees with the heuristic on a sub-unit decimal either way", () => {
    // The overlap case: below 1 the two paths already gave the same answer, so
    // stamping a row can never move a value that was previously correct.
    expect(normalizeBitcoinToSats(0.5, "BTC")).toBe(50_000_000);
    expect(normalizeBitcoinToSats(0.5, "BTC", { unitIsExact: true })).toBe(50_000_000);
  });
});

describe("sumByCurrency: a stamped row and a legacy row can be added safely", () => {
  it("adds 1 stamped BTC to a legacy sats balance without a 1e8 error", () => {
    const out = sumByCurrency([
      { amount: "1", currency: "BTC", format_version: 1 },
      { amount: "50000", currency: "BTC", format_version: 0 },
    ]);
    // 100,000,000 sats + 50,000 sats. Before this change the first row
    // contributed 1 sat and the holding read as 50,001 sats.
    expect(out.sats).toBe(100_050_000);
  });
});

/**
 * These cases exist because the first version of this change wired the stamp
 * all the way onto the Account type and then dropped it in the last step: the
 * two totals on the accounts page built { amount, currency } inline, so
 * sumByCurrency saw format_version as undefined and a stamped balance was
 * still read by magnitude. Every test above passed with the wiring
 * disconnected, because they all called the pure function directly.
 *
 * The fix was to make that mapping a function. These tests are the reason it
 * cannot come apart silently again.
 */
describe("toBalanceEntry: the stamp survives the trip to the totals", () => {
  it("carries format_version onto the entry sumByCurrency reads", () => {
    expect(toBalanceEntry({ balance: "1", currency: "BTC", format_version: 1 })).toEqual({
      amount: "1",
      currency: "BTC",
      format_version: 1,
    });
  });

  it("reports a stamped whole BTC holding as a whole bitcoin, end to end", () => {
    // This is the case the ticket is about, exercised through the mapping
    // rather than through a hand-built literal. Drop format_version anywhere
    // between the account and sumByCurrency and this reads 1 sat.
    const out = sumByCurrency([
      toBalanceEntry({ balance: "1", currency: "BTC", format_version: 1 }),
    ]);
    expect(out.sats).toBe(100_000_000);
  });

  it("leaves an unstamped whole BTC holding on the old heuristic", () => {
    // Not an oversight. format_version 0 means the writer did not record the
    // unit, and the sats rows already stored under a BTC label would be
    // rescaled by 1e8 the other way if the guess were dropped here.
    const out = sumByCurrency([toBalanceEntry({ balance: "1", currency: "BTC" })]);
    expect(out.sats).toBe(1);
  });

  it("falls back to the transaction sum only when the stored balance is zero", () => {
    // Stored balance stands, stamp and all, when it is not zero.
    expect(toBalanceEntry({ balance: "1", currency: "BTC", format_version: 1 }, 42)).toEqual({
      amount: "1",
      currency: "BTC",
      format_version: 1,
    });
  });

  it("declares sats on the transaction fallback and carries no stamp", () => {
    // The caller has already reduced a bitcoin account's rows to sats, so the
    // unit is known outright and there is nothing left for a stamp to settle.
    expect(toBalanceEntry({ balance: "0", currency: "BTC", format_version: 1 }, 50_000)).toEqual({
      amount: "50000",
      currency: "sats",
    });
  });

  it("ignores a transaction sum too small to be a real balance", () => {
    expect(toBalanceEntry({ balance: "0", currency: "USD" }, 0.001)).toEqual({
      amount: "0",
      currency: "USD",
      format_version: undefined,
    });
  });
});
