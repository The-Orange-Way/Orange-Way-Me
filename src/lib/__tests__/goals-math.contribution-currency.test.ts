import { describe, it, expect } from "vitest";
import { averageMonthlyContribution, orderPayDown } from "../goals-math";
import { convert } from "../fx-rates";
import type { Goal } from "@/hooks/useGoals";
import type { Account } from "@/lib/connectors";
import type { DecryptedTxn } from "@/hooks/useTransactions";

/**
 * OW-T0385. Follow-up to the computeCurrent/computeProgress currency work.
 * averageMonthlyContribution summed raw txn.amount, so a CAD deposit and a
 * sats-magnitude Bitcoin deposit were added at face value. That figure is
 * the "3mo avg" on GoalCard/GoalDetailPage and the pace fed to
 * projectCompletionDate. orderPayDown summed Math.abs(Number(a.balance)),
 * so a stamped 1 BTC loan sorted as "1" against a $5,000 card.
 *
 * These tests lock both to one consistent unit: convert() into
 * primaryCurrency before summing contributions, and normalizedBalance
 * before ranking payoff debt.
 */

const goal = (over: Partial<Goal> = {}): Goal =>
  ({
    id: "g1",
    name: "Emergency fund",
    type: "save_up",
    strategy: "all_balance",
    target_amount: "1000",
    starting_balance: null,
    manual_allocation: null,
    target_date: null,
    linked_account_ids: ["usd"],
    is_completed: false,
    ...over,
  }) as unknown as Goal;

const account = (over: Partial<Account> = {}): Account =>
  ({
    id: "usd",
    balance: "0",
    currency: "USD",
    name: "usd",
    type: "checking",
    ...over,
  }) as unknown as Account;

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

const txn = (over: Partial<DecryptedTxn> = {}): DecryptedTxn =>
  ({
    id: "t1",
    account_id: "usd",
    date: isoDaysAgo(10),
    amount: "0",
    currency: "USD",
    description: "deposit",
    merchant: null,
    category_id: null,
    memo: null,
    tags: null,
    is_split_parent: false,
    split_parent_id: null,
    transfer_group_id: null,
    is_manual_category: false,
    updated_at: "",
    ...over,
  }) as DecryptedTxn;

describe("averageMonthlyContribution converts to primaryCurrency before summing", () => {
  it("converts a CAD deposit into USD instead of adding 136 CAD as 136 dollars", () => {
    const g = goal({ linked_account_ids: ["cad"] });
    const txns = [txn({ id: "t-cad", account_id: "cad", amount: "136", currency: "CAD" })];
    const avg = averageMonthlyContribution(g, txns, 3, "USD");
    const converted = convert(136, "CAD", "USD") / 3;
    expect(avg).toBeCloseTo(converted);
    expect(avg).not.toBeCloseTo(136 / 3);
  });

  it("converts a sats-magnitude Bitcoin deposit instead of treating 25,000,000 as dollars", () => {
    // The "$25,000,000 for a quarter Bitcoin" shape: 0.25 BTC stored as sats.
    const g = goal({ linked_account_ids: ["btc"] });
    const txns = [txn({ id: "t-btc", account_id: "btc", amount: "25000000", currency: "sats" })];
    const avg = averageMonthlyContribution(g, txns, 3, "USD");
    const converted = convert(25_000_000, "sats", "USD") / 3;
    expect(avg).toBeCloseTo(converted);
    expect(avg).not.toBeCloseTo(25_000_000 / 3);
  });

  it("sums a USD deposit and a CAD deposit in one currency, not at face value", () => {
    const g = goal({ linked_account_ids: ["usd", "cad"] });
    const txns = [
      txn({ id: "t-usd", account_id: "usd", amount: "300", currency: "USD" }),
      txn({ id: "t-cad", account_id: "cad", amount: "136", currency: "CAD" }),
    ];
    const avg = averageMonthlyContribution(g, txns, 3, "USD");
    const converted = (300 + convert(136, "CAD", "USD")) / 3;
    expect(avg).toBeCloseTo(converted);
    expect(avg).not.toBeCloseTo((300 + 136) / 3);
  });

  it("keeps pay_down as a positive outflow after converting a CAD payment", () => {
    const g = goal({
      type: "pay_down",
      linked_account_ids: ["cad"],
    });
    const txns = [txn({ id: "t-pay", account_id: "cad", amount: "-136", currency: "CAD" })];
    const avg = averageMonthlyContribution(g, txns, 3, "USD");
    expect(avg).toBeCloseTo(convert(136, "CAD", "USD") / 3);
    expect(avg).toBeGreaterThan(0);
  });

  it("still returns the raw-USD average for a USD-only goal", () => {
    const g = goal({ linked_account_ids: ["usd"] });
    const txns = [txn({ amount: "300", currency: "USD" })];
    expect(averageMonthlyContribution(g, txns, 3, "USD")).toBeCloseTo(100);
  });
});

describe("orderPayDown ranks debt via normalizedBalance, not raw face value", () => {
  it("puts a $5,000 card ahead of a 0.5 BTC loan on snowball (raw 0.5 would have won)", () => {
    // Unstamped decimal BTC → 50_000_000 sats. Face value 0.5 would sort
    // before 5000; the normalized debt is the larger one.
    const usdGoal = goal({
      id: "usd-card",
      type: "pay_down",
      name: "Card",
      linked_account_ids: ["usd"],
      interest_rate: "20",
    });
    const btcGoal = goal({
      id: "btc-loan",
      type: "pay_down",
      name: "BTC loan",
      linked_account_ids: ["btc"],
      interest_rate: "20",
    });
    const usdAcct = account({ id: "usd", balance: "-5000", currency: "USD", type: "credit" });
    const btcAcct = account({
      id: "btc",
      balance: "-0.5",
      currency: "BTC",
      type: "loan",
    });

    const ordered = orderPayDown([btcGoal, usdGoal], [usdAcct, btcAcct], "snowball");
    expect(ordered.map((g) => g.id)).toEqual(["usd-card", "btc-loan"]);
  });

  it("puts a stamped 1 BTC loan after a $5,000 card, not before it as raw 1", () => {
    const usdGoal = goal({
      id: "usd-card",
      type: "pay_down",
      linked_account_ids: ["usd"],
      interest_rate: "18",
    });
    const btcGoal = goal({
      id: "btc-loan",
      type: "pay_down",
      linked_account_ids: ["btc"],
      interest_rate: "18",
    });
    const usdAcct = account({ id: "usd", balance: "-5000", currency: "USD", type: "credit" });
    const btcAcct = account({
      id: "btc",
      balance: "-1",
      currency: "BTC",
      type: "loan",
      format_version: 1,
    });

    const ordered = orderPayDown([btcGoal, usdGoal], [usdAcct, btcAcct], "snowball");
    expect(ordered.map((g) => g.id)).toEqual(["usd-card", "btc-loan"]);
  });

  it("still orders two USD debts by face value", () => {
    const small = goal({
      id: "small",
      type: "pay_down",
      linked_account_ids: ["a"],
      interest_rate: "15",
    });
    const large = goal({
      id: "large",
      type: "pay_down",
      linked_account_ids: ["b"],
      interest_rate: "15",
    });
    const ordered = orderPayDown(
      [large, small],
      [
        account({ id: "a", balance: "-200", currency: "USD", type: "credit" }),
        account({ id: "b", balance: "-900", currency: "USD", type: "credit" }),
      ],
      "snowball",
    );
    expect(ordered.map((g) => g.id)).toEqual(["small", "large"]);
  });
});
