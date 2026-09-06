import { describe, it, expect } from "vitest";
import { computeCurrent } from "../goals-math";
import type { Goal } from "@/hooks/useGoals";
import type { Account } from "@/lib/connectors";

/**
 * OWM-T0348 (from the OW-T0099 audit). computeCurrent used to sum
 * Number(a.balance) raw with zero currency awareness, so a linked account
 * whose enc_currency is mistagged (a sats-magnitude balance stored under
 * currency="BTC", the OWM-T0139 bug) was summed at face value instead of
 * being read as sats. These tests lock computeCurrent to normalize every
 * Bitcoin-like balance to sats before summing, the same way sumByCurrency
 * and convert() already do.
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

describe("computeCurrent normalizes Bitcoin balances before summing", () => {
  it("reads an unstamped, mistagged sats-magnitude balance as sats (OWM-T0139 population)", () => {
    const acct = account({ balance: "150000", currency: "BTC" });
    const current = computeCurrent(goal(), [acct]);
    expect(current).toBe(150000); // sats, not 150000 "BTC"
  });

  it("reads a stamped whole-BTC integer as BTC, not sats", () => {
    // format_version >= 1 means the writer stamped the unit, so a bare
    // integer of 1 is one whole bitcoin (1e8 sats), not one satoshi. Before
    // this fix computeCurrent ignored the stamp entirely and summed the
    // raw "1".
    const acct = account({ balance: "1", currency: "BTC", format_version: 1 });
    const current = computeCurrent(goal(), [acct]);
    expect(current).toBe(1e8);
  });

  it("reads an unstamped decimal BTC balance as sats via the shape heuristic", () => {
    const acct = account({ balance: "0.5", currency: "BTC" });
    const current = computeCurrent(goal(), [acct]);
    expect(current).toBe(5e7);
  });

  it("sums a sats-currency account as-is", () => {
    const acct = account({ balance: "2500", currency: "sats" });
    const current = computeCurrent(goal(), [acct]);
    expect(current).toBe(2500);
  });

  it("leaves non-Bitcoin balances untouched", () => {
    const acct = account({ balance: "500", currency: "USD" });
    const current = computeCurrent(goal(), [acct]);
    expect(current).toBe(500);
  });

  it("applies the same normalization on the pay_down debt side", () => {
    const g = goal({ type: "pay_down", starting_balance: "200000", target_amount: "200000" });
    const acct = account({ balance: "-50000", currency: "BTC" });
    const current = computeCurrent(g, [acct]);
    expect(current).toBe(150000); // paid off = 200000 sats - 50000 sats
  });
});
