import { describe, it, expect } from "vitest";
import { summariseGoals } from "../goals-math";
import type { Goal } from "@/hooks/useGoals";
import type { Account } from "@/lib/connectors";

/**
 * DL-1603. The line at the top of the goals screen was built inline in JSX,
 * where nothing could test it, and it drifted away from the per-goal maths it
 * summarises. It disagreed with the tiles underneath it in two ways:
 *
 *   it measured goals the tiles refuse to measure, scoring them zero percent
 *   it let one goal's excess count as progress against another goal's shortfall
 *
 * Both produce a headline figure the user does not have. These tests pin the
 * agreement so the header and the tiles cannot part company again.
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

  it("leaves out a goal the tiles refuse to measure, instead of scoring it zero", () => {
    // The unmeasurable goal carries a real target, so the old loop added 2000 to
    // the denominator against a current of nothing and halved the headline.
    const measurable = goal({ id: "a", target_amount: "1000", linked_account_ids: ["acct"] });
    const unmeasurable = goal({ id: "b", target_amount: "2000", linked_account_ids: [] });
    const s = summariseGoals([measurable, unmeasurable], [account("acct", "1000")]);

    expect(s.saved).toBe(1000);
    expect(s.target).toBe(1000);
    expect(s.pct).toBe(1);
    // The count is what tells the reader something was left out.
    expect(s.counted).toBe(1);
    expect(s.active).toBe(2);
  });

  it("still leaves it out when the goal's linked accounts have been deleted", () => {
    const orphaned = goal({ id: "b", target_amount: "2000", linked_account_ids: ["gone"] });
    const s = summariseGoals([orphaned], [account("other", "5000")]);
    expect(s).toEqual({ saved: 0, target: 0, pct: 0, counted: 0, active: 1 });
  });

  it("caps a goal at its own target, so surplus cannot fill another goal's gap", () => {
    /*
     * This is the defect with one goal and no account sharing at all, which is
     * why it is separable from DL-1589. Before the cap this single goal alone
     * produced saved 41000 against target 8000, a headline of 512 percent,
     * while the goal's own card read 100 percent.
     */
    const overFunded = goal({ id: "a", target_amount: "8000", linked_account_ids: ["acct"] });
    const s = summariseGoals([overFunded], [account("acct", "41000")]);

    expect(s.saved).toBe(8000);
    expect(s.target).toBe(8000);
    expect(s.pct).toBe(1);
  });

  it("never reports more than 100 percent, whatever the goals hold", () => {
    const goals = [
      goal({ id: "a", target_amount: "100", linked_account_ids: ["x"] }),
      goal({ id: "b", target_amount: "50", linked_account_ids: ["y"] }),
    ];
    const s = summariseGoals(goals, [account("x", "999999"), account("y", "999999")]);
    expect(s.pct).toBeLessThanOrEqual(1);
    expect(s.saved).toBeLessThanOrEqual(s.target);
  });

  it("ignores completed goals, and reports no active goals when they all are", () => {
    const done = goal({ id: "a", target_amount: "1000", is_completed: true });
    const s = summariseGoals([done], []);
    expect(s.active).toBe(0);
    expect(s.counted).toBe(0);
  });

  /*
   * DL-1589 IS STILL OPEN AND THIS TEST SAYS SO OUT LOUD.
   *
   * Two goals linked to one account each claim that whole balance on the
   * all_balance strategy, so the account is counted once per goal. That is a
   * product decision about whether goals may share an account at all, and is
   * deliberately NOT fixed here.
   *
   * On the demo fixture this pins the improvement and the residue together:
   * the header moves from 82,000 to 49,000 against a real balance of 41,000.
   * The remaining 8,000 is DL-1589. If someone closes that ticket, this
   * expectation SHOULD fail, and the right response is to update it, not to
   * loosen it.
   */
  it("still counts a shared account once per goal, which is DL-1589 and not fixed here", () => {
    const house = goal({ id: "a", target_amount: "100000", linked_account_ids: ["savings"] });
    const trip = goal({ id: "b", target_amount: "8000", linked_account_ids: ["savings"] });
    const s = summariseGoals([house, trip], [account("savings", "41000")]);

    expect(s.saved).toBe(49000);
    expect(s.target).toBe(108000);
    expect(s.counted).toBe(2);
  });
});
