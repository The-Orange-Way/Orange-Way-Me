import { describe, it, expect } from "vitest";
import { computeCurrent } from "../goals-math";
import type { Goal } from "@/hooks/useGoals";
import type { Account } from "@/lib/connectors";

/**
 * OWM-T0348 (from the OW-T0099 audit), extended by OWM-T0772.
 *
 * computeCurrent used to sum Number(a.balance) raw with zero currency
 * awareness, so a linked account whose enc_currency is mistagged (a
 * sats-magnitude balance stored under currency="BTC", the OWM-T0139 bug) was
 * summed at face value instead of being read as sats. OWM-T0348 fixed that
 * half: computeCurrent normalizes every Bitcoin-like balance to sats before
 * summing.
 *
 * It still returned that sats-normalized sum as-is, with no currency
 * conversion, so a BTC-linked goal displayed a sats-magnitude number
 * formatted as if it were already dollars (OWM-T0772: "$25,000,000" for a
 * quarter of a Bitcoin). computeCurrent now takes the goal's primary
 * currency and converts every linked account into it via fx-rates.convert(),
 * which performs the same sats/BTC disambiguation internally before
 * applying the BTC-USD rate. These tests are updated to assert the
 * converted-to-currency values; the underlying disambiguation logic they
 * were written to lock down is unchanged and still exercised here.
 *
 * All expected values use the static BTC-USD fallback rate (fx-rates.ts,
 * STATIC_BTC_USD = 65_000), which is what a unit test gets deterministically
 * since nothing here populates the live ORBI rate cache.
 */

const goal = (over: Partial<Goal> = {}): Goal =>
  ({
    id: "g1",
    name: "Sats goal",
    type: "save_up",
    strategy: "all_balance",
    target_amount: "1000",
    starting_balance: null,
    manual_allocation: null,
    target_date: null,
    linked_account_ids: ["a"],
    ...over,
  }) as unknown as Goal;

const account = (over: Partial<Account> = {}): Account =>
  ({
    id: "a",
    balance: "0",
    currency: "USD",
    name: "a",
    type: "bitcoin",
    ...over,
  }) as unknown as Account;

describe("computeCurrent converts every linked balance to the goal's primary currency", () => {
  it("reads an unstamped, mistagged sats-magnitude balance as sats, then converts to USD (OWM-T0139 population)", () => {
    const acct = account({ balance: "1000000", currency: "BTC" });
    const current = computeCurrent(goal(), [acct], "USD");
    // 1,000,000 sats * ($65,000 / 1e8) = $650, not "1,000,000 BTC"
    expect(current).toBe(650);
  });

  it("reads a stamped whole-BTC integer as BTC, not sats", () => {
    // format_version >= 1 means the writer stamped the unit, so a bare
    // integer of 1 is one whole bitcoin (1e8 sats), not one satoshi. Before
    // OWM-T0348 computeCurrent ignored the stamp entirely and summed the
    // raw "1"; before OWM-T0772 it returned the correctly-normalized sats
    // count (1e8) without converting it to a currency at all.
    const acct = account({ balance: "1", currency: "BTC", format_version: 1 });
    const current = computeCurrent(goal(), [acct], "USD");
    expect(current).toBe(65_000); // 1 BTC at the static fallback rate
  });

  it("reads an unstamped decimal BTC balance as sats via the shape heuristic, then converts", () => {
    const acct = account({ balance: "0.5", currency: "BTC" });
    const current = computeCurrent(goal(), [acct], "USD");
    expect(current).toBe(32_500); // 0.5 BTC at the static fallback rate
  });

  it("converts a sats-currency account the same way", () => {
    const acct = account({ balance: "2500000", currency: "sats" });
    const current = computeCurrent(goal(), [acct], "USD");
    expect(current).toBe(1_625);
  });

  it("leaves a same-currency balance numerically unchanged (identity conversion)", () => {
    const acct = account({ balance: "500", currency: "USD" });
    const current = computeCurrent(goal(), [acct], "USD");
    expect(current).toBe(500);
  });

  it("converts a non-Bitcoin foreign-currency balance too, which the pre-OWM-T0772 code never did", () => {
    const acct = account({ balance: "500", currency: "CAD" });
    const current = computeCurrent(goal(), [acct], "USD");
    // 500 CAD -> USD at the static fallback rate (1 CAD = 1/1.36 USD)
    expect(current).toBeCloseTo(500 / 1.36, 5);
  });

  it("applies the same normalization and conversion on the pay_down debt side", () => {
    const g = goal({ type: "pay_down", starting_balance: "10000", target_amount: "10000" });
    // 1,000,000 sats owed = 0.01 BTC = $650 at the static fallback rate.
    const acct = account({ balance: "-1000000", currency: "BTC" });
    const current = computeCurrent(g, [acct], "USD");
    expect(current).toBe(9_350); // paid off = $10,000 starting - $650 owed
  });
});
