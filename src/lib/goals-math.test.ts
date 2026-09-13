/**
 * computeCurrent must sum linked account balances in one unit. Before this
 * fix it summed Number(a.balance) with no currency awareness at all, so a
 * mistagged sats-as-BTC account (a legacy row whose "BTC" balance is really
 * an integer number of satoshis, format_version unset) summed against a
 * real stamped decimal BTC account produced a garbage total: adding a
 * ~5,000,000 sats magnitude number directly to a 1.5 decimal instead of
 * converting the decimal to 150,000,000 sats first.
 */
import { describe, it, expect } from "vitest";
import { computeCurrent } from "./goals-math";
import type { Goal, GoalType, PayDownStrategy, SaveUpStrategy } from "@/hooks/useGoals";
import type { Account, AccountTypeKey, ConnectorType } from "@/lib/connectors";

function makeGoal(overrides: Partial<Goal> & { type: GoalType }): Goal {
  return {
    id: "goal-1",
    user_id: "user-1",
    name: "Test goal",
    target_amount: "1000",
    current_amount: "0",
    starting_balance: null,
    interest_rate: null,
    minimum_payment: null,
    target_date: null,
    linked_account_ids: [],
    strategy: null,
    manual_allocation: null,
    is_completed: false,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeAccount(overrides: Partial<Account> & { id: string }): Account {
  return {
    user_id: "user-1",
    connector_type: "manual" as ConnectorType,
    is_active: true,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    name: "Test account",
    type: "bitcoin" as AccountTypeKey,
    currency: "USD",
    balance: "0",
    ...overrides,
  };
}

describe("computeCurrent: BTC/sats unit normalization across linked accounts", () => {
  it("sums a mistagged sats-as-BTC account with a real decimal BTC account in sats, not raw", () => {
    const mistaggedSats = makeAccount({
      id: "a1",
      currency: "BTC",
      balance: "5000000", // legacy row: label says BTC, value is already sats
      format_version: undefined, // unstamped: heuristic must read this as sats
    });
    const realDecimalBtc = makeAccount({
      id: "a2",
      currency: "BTC",
      balance: "1.5", // a genuine 1.5 BTC holding
      format_version: 1, // stamped: no magnitude guessing, always *1e8
    });
    const goal = makeGoal({
      type: "save_up",
      strategy: "all_balance" as SaveUpStrategy,
      linked_account_ids: ["a1", "a2"],
    });

    const current = computeCurrent(goal, [mistaggedSats, realDecimalBtc]);

    // 5,000,000 sats (unchanged) + 150,000,000 sats (1.5 BTC * 1e8), not
    // 5,000,000 + 1.5 = 5,000,001.5.
    expect(current).toBe(5_000_000 + 150_000_000);
  });

  it("leaves a non-bitcoin linked account's balance untouched", () => {
    const usd = makeAccount({ id: "a3", currency: "USD", balance: "250.40" });
    const goal = makeGoal({
      type: "save_up",
      strategy: "all_balance" as SaveUpStrategy,
      linked_account_ids: ["a3"],
    });

    expect(computeCurrent(goal, [usd])).toBe(250.4);
  });

  it("normalizes the same way on the pay_down debt sum", () => {
    const stampedDebt = makeAccount({
      id: "a4",
      currency: "BTC",
      balance: "-0.25",
      format_version: 1,
    });
    const goal = makeGoal({
      type: "pay_down",
      strategy: "avalanche" as PayDownStrategy,
      starting_balance: "50000000", // 0.5 BTC in sats, already paying down
      linked_account_ids: ["a4"],
    });

    // debt = |{-0.25 BTC}| normalized = 25,000,000 sats; paid off so far =
    // 50,000,000 - 25,000,000 = 25,000,000, not 50,000,000 - 0.25.
    expect(computeCurrent(goal, [stampedDebt])).toBe(25_000_000);
  });
});
