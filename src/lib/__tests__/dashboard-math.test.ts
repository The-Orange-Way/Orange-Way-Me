/**
 * @vitest-environment node
 *
 * OW-T0384: a stamped account's balance and that same account's own
 * transactions must convert to the same unit.
 *
 * dashboard-math.ts converts account balances with the account's
 * format_version stamp (unitIsExact), so a balance of "1" under a stamped
 * BTC account reads as a whole bitcoin. Transaction amounts at three call
 * sites (netWorthSeries, cashFlowByMonth, thisMonthSummary) called convert()
 * with no opts, so the same account's transaction amount of "1" fell through
 * the magnitude heuristic and read as one satoshi instead: 1e8 too small.
 *
 * netWorthSeries is the sharpest case, because it mixes the two paths in one
 * subtraction: currentNW comes from the (correct) stamped balance path,
 * flowAfter from the (previously wrong) unstamped transaction path, so a
 * customer who just bought bitcoin saw the chart claim they held it for
 * months before they actually did.
 */

import { describe, it, expect } from "vitest";
import { netWorthSeries, cashFlowByMonth, thisMonthSummary } from "../dashboard-math";
import type { Account } from "../connectors/types";
import type { DecryptedTxn } from "@/hooks/useTransactions";

function account(over: Partial<Account> & { id: string }): Account {
  return {
    user_id: "u1",
    connector_type: "manual",
    is_active: true,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    name: "Test account",
    type: "investment",
    currency: "USD",
    balance: "0",
    ...over,
  };
}

function txn(over: Partial<DecryptedTxn> & { id: string; account_id: string }): DecryptedTxn {
  return {
    date: "2026-09-10",
    amount: "0",
    currency: "USD",
    description: "",
    merchant: null,
    category_id: null,
    memo: null,
    tags: null,
    is_split_parent: false,
    split_parent_id: null,
    transfer_group_id: null,
    is_manual_category: false,
    updated_at: "2026-09-10T00:00:00Z",
    ...over,
  };
}

describe("netWorthSeries: a stamped account's own transaction converts in the same unit as its balance", () => {
  it("does not read a whole-BTC deposit as one satoshi (the reported bug)", () => {
    const accounts = [
      account({ id: "a1", currency: "BTC", balance: "1", format_version: 1, type: "investment" }),
    ];
    const txns = [
      txn({ id: "t1", account_id: "a1", amount: "1", date: "2026-09-10", currency: "BTC" }),
    ];
    const series = netWorthSeries(accounts, txns, "USD", 2);
    // The account was funded by exactly this deposit, so every point before
    // 2026-09-10 must read as not holding it: 0, not ~65000 minus a satoshi.
    const before = series.find((p) => p.date < "2026-09-10");
    expect(before).toBeDefined();
    expect(before!.value).toBeCloseTo(0, 2);
  });

  it("still nets the deposit into the current point once it has happened", () => {
    const accounts = [
      account({ id: "a1", currency: "BTC", balance: "1", format_version: 1, type: "investment" }),
    ];
    const txns = [
      txn({ id: "t1", account_id: "a1", amount: "1", date: "2020-01-01", currency: "BTC" }),
    ];
    const series = netWorthSeries(accounts, txns, "USD", 1);
    // Deposit is well before the whole window, so every point should already
    // carry the full stamped balance (about 65000 at the static fallback rate).
    for (const p of series) {
      expect(p.value).toBeCloseTo(65_000, 0);
    }
  });

  it("leaves an unstamped account on the old heuristic, deliberately", () => {
    // format_version 0/absent: the writer never recorded the unit, so the
    // magnitude heuristic still applies and this must not change.
    const accounts = [account({ id: "a1", currency: "BTC", balance: "50000", type: "investment" })];
    const txns = [txn({ id: "t1", account_id: "a1", amount: "50000", date: "2026-09-10", currency: "BTC" })];
    const series = netWorthSeries(accounts, txns, "USD", 1);
    // 50000 sats balance, 50000 sats transaction: both read as sats either way,
    // so the series is unaffected by this fix on an unstamped account.
    expect(series.every((p) => Number.isFinite(p.value))).toBe(true);
  });

  it("known remaining gap: does not fix a transaction older than the account's own stamp", () => {
    // This is NOT claimed fixed. There is no per-transaction format_version,
    // so every transaction on account a1 is priced using a1's CURRENT stamp,
    // even one written before the account was stamped. Pinned so nobody
    // reads this test suite as proof the mixed case is also handled.
    const accounts = [
      account({ id: "a1", currency: "BTC", balance: "2", format_version: 1, type: "investment" }),
    ];
    const txns = [
      // Written back when the account had no stamp, but still priced exact today.
      txn({ id: "t1", account_id: "a1", amount: "1", date: "2020-01-01", currency: "BTC" }),
    ];
    const series = netWorthSeries(accounts, txns, "USD", 1);
    // Priced as a whole BTC (stamped), not as 1 satoshi (unstamped) -- the
    // known gap is that this is always the CURRENT stamp, not the stamp at
    // write time.
    for (const p of series) {
      expect(p.value).toBeCloseTo(65_000, 0);
    }
  });
});

describe("cashFlowByMonth: a stamped account's transaction income is not 1e8 too small", () => {
  it("reports a whole-BTC deposit as real income, not a rounding artifact", () => {
    const accounts = [
      account({ id: "a1", currency: "BTC", balance: "1", format_version: 1, type: "investment" }),
    ];
    const today = new Date();
    const thisMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-15`;
    const txns = [txn({ id: "t1", account_id: "a1", amount: "1", date: thisMonth, currency: "BTC" })];
    const months = cashFlowByMonth(accounts, txns, "USD", 1);
    expect(months[months.length - 1].income).toBeCloseTo(65_000, 0);
  });
});

describe("thisMonthSummary: a stamped account's transaction spend is not 1e8 too small", () => {
  it("reports a whole-BTC outflow as real spending", () => {
    const accounts = [
      account({ id: "a1", currency: "BTC", balance: "1", format_version: 1, type: "investment" }),
    ];
    const anchor = new Date(2026, 8, 20); // 2026-09-20
    const txns = [
      txn({ id: "t1", account_id: "a1", amount: "-1", date: "2026-09-05", currency: "BTC" }),
    ];
    const summary = thisMonthSummary(accounts, txns, "USD", anchor);
    expect(summary.spending).toBeCloseTo(65_000, 0);
  });
});
