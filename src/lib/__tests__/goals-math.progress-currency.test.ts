import { describe, it, expect } from "vitest";
import { computeProgress } from "../goals-math";
import type { Goal } from "@/hooks/useGoals";
import type { Account } from "@/lib/connectors";

/**
 * OWM-T0772. Before this fix, computeProgress returned `current` as a raw
 * sats-normalized integer with no currency conversion, and every display
 * call site (GoalCard, GoalDetailPage, GoalsPage, PayoffPlanWidget) formatted
 * that integer directly as the user's primaryCurrency. A goal linked to a
 * quarter-Bitcoin account rendered "$25,000,000.00" instead of a dollar
 * figure at the BTC price, and a small BTC-linked target read as far over
 * 100% because the sats-magnitude current dwarfed a target typed in
 * dollar-sized units.
 *
 * Expected values use the static BTC-USD fallback rate (fx-rates.ts,
 * STATIC_BTC_USD = 65_000), which is what a unit test gets deterministically.
 */

const goal = (over: Partial<Goal> = {}): Goal =>
  ({
    id: "g1",
    name: "BTC goal",
    type: "save_up",
    strategy: "all_balance",
    target_amount: "10000",
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

describe("computeProgress converts linked account balances to the primary currency", () => {
  it("does not report a quarter-Bitcoin holding as millions of dollars", () => {
    // 0.25 BTC, unstamped decimal entry -> 25,000,000 sats -> $16,250 at the
    // static fallback rate, not "$25,000,000".
    const acct = account({ balance: "0.25", currency: "BTC" });
    const prog = computeProgress(goal({ target_amount: "20000" }), [acct], "USD");
    expect(prog.current).toBe(16_250);
    expect(prog.current).toBeLessThan(100_000); // nowhere near the sats-magnitude bug
  });

  it("computes pct/remaining in one consistent unit instead of comparing sats against a dollar target", () => {
    // 0.05 BTC = 5,000,000 sats = $3,250 against a $10,000 target: real
    // progress is 32.5%, not clamped to 100% from comparing 5,000,000
    // (sats) to 10,000 (dollars).
    const acct = account({ balance: "0.05", currency: "BTC" });
    const prog = computeProgress(goal({ target_amount: "10000" }), [acct], "USD");
    expect(prog.current).toBe(3_250);
    expect(prog.pct).toBeCloseTo(0.325, 5);
    expect(prog.remaining).toBe(6_750);
    expect(prog.pct).toBeLessThan(1);
  });

  it("leaves a plain USD-linked goal unaffected (identity conversion)", () => {
    const acct = account({ balance: "4100", currency: "USD" });
    const prog = computeProgress(goal({ target_amount: "10000" }), [acct], "USD");
    expect(prog.current).toBe(4_100);
    expect(prog.remaining).toBe(5_900);
    expect(prog.pct).toBeCloseTo(0.41, 5);
  });

  it("sums multiple linked accounts in different currencies into one consistent unit", () => {
    // A goal linking a $2,000 USD account and a 0.02 BTC (2,000,000 sats,
    // $1,300 at the fallback rate) account previously added 2000 + 2,000,000
    // as if both were the same unit. It should now read $3,300.
    const usd = account({ id: "u", balance: "2000", currency: "USD" });
    const btc = account({ id: "b", balance: "0.02", currency: "BTC" });
    const prog = computeProgress(
      goal({ target_amount: "10000", linked_account_ids: ["u", "b"] }),
      [usd, btc],
      "USD",
    );
    expect(prog.current).toBe(3_300);
  });
});
