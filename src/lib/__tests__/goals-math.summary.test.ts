import { describe, it, expect } from "vitest";
import { summariseGoals } from "../goals-math";
import type { Goal } from "@/hooks/useGoals";
import type { Account } from "@/lib/connectors";

/**
 * DL-1603. The line at the top of the goals screen was built inline in JSX,
 * where nothing could test it, and it drifted away from the per-goal maths it
 * summarises. It disagreed with the tiles underneath it in two ways:
 *
 *   it counts active goals' targets even when their tiles cannot measure a balance
 *   it counted one account once for every goal that links it
 *
 * Both produce a headline figure the user does not have. These tests pin the
 * distinct-account total used in the header.
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
    linked_account_ids: [],
    is_completed: false,
    ...over,
  }) as unknown as Goal;

const account = (id: string, balance: string): Account =>
  ({ id, balance, currency: "USD", name: id, type: "checking" }) as unknown as Account;

describe("summariseGoals", () => {
  it("counts a goal it can measure, which is the ordinary case", () => {
    const g = goal({ id: "a", target_amount: "1000", linked_account_ids: ["acct"] });
    const s = summariseGoals([g], [account("acct", "250")]);
    expect(s).toEqual({ saved: 250, target: 1000, pct: 0.25, counted: 1, active: 1 });
  });

  it("keeps every active goal's target, even when its tile cannot measure a balance", () => {
    // The header's denominator is the sum of active goal targets. It still
    // reports the amount the customer actually holds, rather than inventing a
    // current for a goal whose linked account is missing.
    const measurable = goal({ id: "a", target_amount: "1000", linked_account_ids: ["acct"] });
    const unmeasurable = goal({ id: "b", target_amount: "2000", linked_account_ids: [] });
    const s = summariseGoals([measurable, unmeasurable], [account("acct", "1000")]);

    expect(s.saved).toBe(1000);
    expect(s.target).toBe(3000);
    expect(s.pct).toBeCloseTo(1 / 3);
    // The count tells the page that only one card has a measurable balance.
    expect(s.counted).toBe(1);
    expect(s.active).toBe(2);
  });

  it("keeps an orphaned goal's target without inventing its balance", () => {
    const orphaned = goal({ id: "b", target_amount: "2000", linked_account_ids: ["gone"] });
    const s = summariseGoals([orphaned], [account("other", "5000")]);
    expect(s).toEqual({ saved: 0, target: 2000, pct: 0, counted: 0, active: 1 });
  });

  it("reports the account balance a customer actually holds, even above one goal's target", () => {
    /*
     * The header reports money held, not capped progress. The goal card caps
     * its own display at the target, while this summary retains the account's
     * actual balance.
     */
    const overFunded = goal({ id: "a", target_amount: "8000", linked_account_ids: ["acct"] });
    const s = summariseGoals([overFunded], [account("acct", "41000")]);

    expect(s.saved).toBe(41000);
    expect(s.target).toBe(8000);
    expect(s.pct).toBe(5.125);
  });

  it("ignores completed goals, and reports no active goals when they all are", () => {
    const done = goal({ id: "a", target_amount: "1000", is_completed: true });
    const s = summariseGoals([done], []);
    expect(s.active).toBe(0);
    expect(s.counted).toBe(0);
  });

  it("counts a shared account once across active goals", () => {
    const house = goal({ id: "a", target_amount: "100000", linked_account_ids: ["savings"] });
    const trip = goal({ id: "b", target_amount: "8000", linked_account_ids: ["savings"] });
    const s = summariseGoals([house, trip], [account("savings", "41000")]);

    expect(s.saved).toBe(41000);
    expect(s.target).toBe(108000);
    expect(s.counted).toBe(2);
    expect(s.pct).toBeCloseTo(41000 / 108000);
  });
});
