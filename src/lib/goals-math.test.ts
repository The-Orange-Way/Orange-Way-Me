/**
 * Unit tests for summariseGoals.
 *
 * These exercise the connected-components deduplication introduced in OW-C1068
 * to ensure the header total is order-independent when goals share accounts.
 */
import { describe, it, expect } from "vitest";
import { summariseGoals } from "./goals-math";
import type { Goal } from "@/hooks/useGoals";
import type { Account } from "@/lib/connectors/types";

// ---------------------------------------------------------------------------
// Minimal factory helpers
// Fields not accessed by summariseGoals are provided with safe defaults.
// ---------------------------------------------------------------------------

function acct(id: string, balance: number): Account {
  return {
    id,
    balance: String(balance),
    currency: "USD",
    connector_type: "manual",
    is_active: true,
    user_id: "u",
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
    name: id,
    type: "savings",
  };
}

function saveUpGoal(id: string, targetAmount: number, linkedAccountIds: string[]): Goal {
  return {
    id,
    name: id,
    type: "save_up",
    strategy: "all_balance",
    target_amount: String(targetAmount),
    current_amount: "0",
    linked_account_ids: linkedAccountIds,
    is_completed: false,
    user_id: "u",
    starting_balance: null,
    interest_rate: null,
    minimum_payment: null,
    target_date: null,
    manual_allocation: null,
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
  };
}

function specificAmountGoal(id: string, targetAmount: number, allocation: number): Goal {
  return {
    id,
    name: id,
    type: "save_up",
    strategy: "specific_amount",
    target_amount: String(targetAmount),
    current_amount: "0",
    linked_account_ids: [],
    manual_allocation: String(allocation),
    is_completed: false,
    user_id: "u",
    starting_balance: null,
    interest_rate: null,
    minimum_payment: null,
    target_date: null,
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
  };
}

function payDownGoal(id: string, targetAmount: number, linkedAccountIds: string[]): Goal {
  return {
    id,
    name: id,
    type: "pay_down",
    strategy: "avalanche",
    target_amount: String(targetAmount),
    current_amount: "0",
    linked_account_ids: linkedAccountIds,
    // starting_balance = target means the full target is the starting debt;
    // with a debt account at balance=0 the goal reads as fully paid off.
    starting_balance: String(targetAmount),
    interest_rate: null,
    minimum_payment: null,
    target_date: null,
    manual_allocation: null,
    is_completed: false,
    user_id: "u",
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("summariseGoals", () => {
  it("no sharing: per-goal min(balance, target), not sum of unique balances (DL-1603)", () => {
    // Account X=50 for goal A (target 10), Account Y=30 for goal B (target 100).
    // Correct: 10 + 30 = 40.
    // Wrong (forbidden approach): min(50, 110) + min(30, 110) = 80.
    const goals = [saveUpGoal("A", 10, ["X"]), saveUpGoal("B", 100, ["Y"])];
    const accounts = [acct("X", 50), acct("Y", 30)];
    const result = summariseGoals(goals, accounts);
    expect(result.saved).toBe(40);
    expect(result.target).toBe(110);
  });

  it("shared account, big goal first: result equals account balance", () => {
    // Auditor fixture: X=41000, A target=100000, B target=8000, big first.
    const goals = [saveUpGoal("A", 100_000, ["X"]), saveUpGoal("B", 8_000, ["X"])];
    const accounts = [acct("X", 41_000)];
    const result = summariseGoals(goals, accounts);
    expect(result.saved).toBe(41_000);
  });

  it("shared account, small goal first: same result (order-independent)", () => {
    // Same fixture as above but goals reversed -- must give 41000, not 8000.
    const goals = [saveUpGoal("B", 8_000, ["X"]), saveUpGoal("A", 100_000, ["X"])];
    const accounts = [acct("X", 41_000)];
    const result = summariseGoals(goals, accounts);
    expect(result.saved).toBe(41_000);
  });

  it("goal with two accounts, one shared: unshared account counted once", () => {
    // Goal A links to X=41000 only (target 100000).
    // Goal B links to X=41000 and Y=20000 (target 50000).
    // Component {A,B}: available=61000, A-individual=41000, B-individual=50000,
    // componentSaved=min(91000, 61000)=61000.
    const goals = [saveUpGoal("A", 100_000, ["X"]), saveUpGoal("B", 50_000, ["X", "Y"])];
    const accounts = [acct("X", 41_000), acct("Y", 20_000)];
    const result = summariseGoals(goals, accounts);
    expect(result.saved).toBe(61_000);
  });

  it("specific_amount goal passes through without dedup", () => {
    const goals = [specificAmountGoal("A", 5_000, 3_000)];
    const result = summariseGoals(goals, []);
    expect(result.saved).toBe(3_000);
    expect(result.target).toBe(5_000);
  });

  it("pay_down goal passes through without dedup", () => {
    // Debt account at balance=0 means fully paid off => current=target.
    const goals = [payDownGoal("A", 10_000, ["X"])];
    const accounts = [acct("X", 0)];
    const result = summariseGoals(goals, accounts);
    expect(result.saved).toBe(10_000);
  });

  it("mix of shared save_up, specific_amount, and pay_down", () => {
    // save_up shared (X=41000, A target=100000, B target=8000) => 41000
    // specific_amount (C target=5000, allocation=3000) => 3000
    // pay_down fully paid (D target=10000, Y balance=0) => 10000
    const goals = [
      saveUpGoal("A", 100_000, ["X"]),
      saveUpGoal("B", 8_000, ["X"]),
      specificAmountGoal("C", 5_000, 3_000),
      payDownGoal("D", 10_000, ["Y"]),
    ];
    const accounts = [acct("X", 41_000), acct("Y", 0)];
    const result = summariseGoals(goals, accounts);
    expect(result.saved).toBe(54_000); // 41000 + 3000 + 10000
    expect(result.target).toBe(123_000); // 100000 + 8000 + 5000 + 10000
    expect(result.counted).toBe(4);
    expect(result.active).toBe(4);
  });
});
