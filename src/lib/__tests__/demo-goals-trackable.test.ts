import { describe, it, expect } from "vitest";
import { DEMO_FAMILIES } from "../demo-families";
import type { DemoFamily, DemoGoal } from "../demo-families";
import { computeProgress, untrackableReason } from "../goals-math";
import type { Goal } from "@/hooks/useGoals";
import type { Account } from "@/lib/connectors";

/**
 * DL-1587. Every pay_down goal in the demo seed was written with a target of
 * "0.00", meaning "pay it down to zero". The code reads it the other way: for
 * a pay_down goal the target is the debt being cleared, and the starting
 * balance falls back to it. So both the numerator and the denominator were
 * zero, and a demo goal against a card carrying real debt reported nothing to
 * measure.
 *
 * The seed also inserted goal rows directly without a strategy or a starting
 * balance, while the goal form refuses a non-positive target outright
 * (GoalFormDialog handleSave). The seed was creating goals the form itself
 * would not accept, so the validation was a check on one path rather than a
 * property of the data.
 *
 * These tests rebuild what the seed writes and put it through goals-math, the
 * code that actually renders the card, so a fixture that cannot be measured
 * fails here instead of on a customer's screen.
 */

const accountId = (family: DemoFamily, name: string) => `${family.id}:${name}`;

const seededAccounts = (family: DemoFamily): Account[] =>
  family.accounts.map(
    (a) =>
      ({
        id: accountId(family, a.name),
        name: a.name,
        balance: a.balance,
        currency: a.currency,
        type: a.type,
      }) as unknown as Account,
  );

/**
 * The row useDemoSeed inserts, decrypted. Linked ids are resolved by name the
 * way the seed resolves them, so a fixture naming an account that does not
 * exist produces the empty array the seed would write, not a passing test.
 */
const seededGoal = (family: DemoFamily, g: DemoGoal, index: number): Goal =>
  ({
    id: `${family.id}:goal:${index}`,
    user_id: "demo",
    type: g.type,
    name: g.name,
    target_amount: g.targetAmount,
    current_amount: "0",
    starting_balance: g.startingBalance ?? null,
    interest_rate: null,
    minimum_payment: null,
    target_date: g.targetDate,
    linked_account_ids: family.accounts.some((a) => a.name === g.account)
      ? [accountId(family, g.account)]
      : [],
    strategy: g.strategy ?? null,
    manual_allocation: null,
    is_completed: false,
    created_at: "",
    updated_at: "",
  }) as unknown as Goal;

describe("demo seed goals are measurable", () => {
  it("there are families and goals to check, or the rest proves nothing", () => {
    expect(DEMO_FAMILIES.length).toBeGreaterThan(0);
    expect(DEMO_FAMILIES.every((f) => f.goals.length > 0)).toBe(true);
  });

  for (const family of DEMO_FAMILIES) {
    describe(family.name, () => {
      const accounts = seededAccounts(family);

      family.goals.forEach((g, index) => {
        const goal = seededGoal(family, g, index);

        it(`${g.name}: the card has something to measure`, () => {
          expect(untrackableReason(goal, accounts)).toBeNull();
        });

        it(`${g.name}: the target is one the goal form would accept`, () => {
          expect(Number(g.targetAmount)).toBeGreaterThan(0);
        });

        it(`${g.name}: the target date is ahead of the demo, not behind it`, () => {
          // date(daysAgo) subtracts, so a future date is written date(-N).
          // date(-365 * -2) cancels its own sign and lands two years in the
          // past, which rendered as a goal already centuries overdue.
          expect(new Date(`${g.targetDate}T00:00:00`).getTime()).toBeGreaterThan(Date.now());
        });
      });
    });
  }
});

describe("demo pay_down goals show progress against a real debt", () => {
  const payDown = DEMO_FAMILIES.flatMap((family) =>
    family.goals
      .map((g, index) => ({ family, g, goal: seededGoal(family, g, index) }))
      .filter((entry) => entry.g.type === "pay_down"),
  );

  it("the fixtures include at least one pay_down goal", () => {
    expect(payDown.length).toBeGreaterThan(0);
  });

  for (const { family, g, goal } of payDown) {
    it(`${g.name}: part of the balance reads as cleared`, () => {
      const progress = computeProgress(goal, seededAccounts(family));
      expect(progress.current).toBeGreaterThan(0);
      expect(progress.pct).toBeGreaterThan(0);
      expect(progress.pct).toBeLessThan(1);
    });

    it(`${g.name}: it starts from at least what the account still owes`, () => {
      // Progress is start minus the outstanding debt, clamped at zero. A start
      // below the balance is the zero-forever case this ticket is about.
      const outstanding = family.accounts
        .filter((a) => a.name === g.account)
        .reduce((sum, a) => sum + Math.abs(Number(a.balance) || 0), 0);
      expect(outstanding).toBeGreaterThan(0);
      expect(Number(g.startingBalance ?? g.targetAmount)).toBeGreaterThanOrEqual(outstanding);
    });
  }
});
