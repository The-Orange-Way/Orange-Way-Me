import { describe, it, expect } from "vitest";
import { computeProgress, derivesFromLinkedAccounts, untrackableReason } from "../goals-math";
import type { Goal } from "@/hooks/useGoals";
import type { Account } from "@/lib/connectors";

/**
 * DL-1425. A beta tester created a goal and the progress bar sat at zero
 * instead of roughly ninety percent. The goal had no linked accounts, so
 * computeCurrent summed nothing and returned 0, and the card rendered that as
 * "0%".
 *
 * The sum was not wrong. Reporting it as progress was. A zero that means "you
 * have saved nothing" and a zero that means "there is nothing to measure" look
 * identical on a progress bar, and only one of them is true here.
 *
 * These tests lock the distinction so the card can tell them apart.
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
    ...over,
  }) as unknown as Goal;

const account = (id: string, balance: string): Account =>
  ({ id, balance, currency: "USD", name: id, type: "checking" }) as unknown as Account;

describe("untrackableReason", () => {
  it("flags a goal with no linked accounts, which is the reported case", () => {
    expect(untrackableReason(goal(), [])).toBe("no_accounts_linked");
  });

  it("flags a goal whose linked accounts no longer exist", () => {
    // The ids survive on the goal after an account is deleted, so the goal
    // looks linked while resolving to nothing. Same silent zero, different cause.
    expect(untrackableReason(goal({ linked_account_ids: ["gone"] }), [])).toBe(
      "linked_accounts_missing",
    );
    expect(
      untrackableReason(goal({ linked_account_ids: ["gone"] }), [account("other", "500")]),
    ).toBe("linked_accounts_missing");
  });

  it("returns null when at least one linked account resolves", () => {
    expect(
      untrackableReason(goal({ linked_account_ids: ["a"] }), [account("a", "900")]),
    ).toBeNull();
  });

  /*
   * The second reported shape on the same ticket, found on production: a
   * pay_down goal against a card carrying -4,200 rendered "0% / $0 of $0".
   *
   * computeCurrent falls back to the target when there is no starting
   * balance, so an absent target makes the starting balance 0, the debt
   * subtracts to 0, and the target is 0 as well. Every number on the card is
   * a true consequence of a target that was never set, and together they
   * read as a claim about the debt.
   */
  it("flags a goal with no target, which is the pay_down case seen on production", () => {
    const noTarget = goal({
      type: "pay_down",
      strategy: "all_balance",
      target_amount: "",
      linked_account_ids: ["amex"],
    });
    expect(untrackableReason(noTarget, [account("amex", "-4200")])).toBe("no_target_set");
  });

  it("flags a zero target the same way, since it is equally unmeasurable", () => {
    expect(
      untrackableReason(goal({ target_amount: "0", linked_account_ids: ["a"] }), [
        account("a", "900"),
      ]),
    ).toBe("no_target_set");
  });

  it("flags a targetless specific_amount goal too, which no linked-account check reaches", () => {
    // This one has a real current amount and still cannot be shown as a
    // percentage, which is why the target check runs before the strategy split.
    const manual = goal({
      strategy: "specific_amount",
      manual_allocation: "900",
      target_amount: "",
    });
    expect(untrackableReason(manual, [])).toBe("no_target_set");
  });

  it("never flags a specific_amount goal, which does not need linked accounts", () => {
    const manual = goal({ strategy: "specific_amount", manual_allocation: "900" });
    expect(derivesFromLinkedAccounts(manual)).toBe(false);
    expect(untrackableReason(manual, [])).toBeNull();
  });

  it("flags a pay_down goal with nothing linked, because it also derives from balances", () => {
    expect(untrackableReason(goal({ type: "pay_down", strategy: "all_balance" }), [])).toBe(
      "no_accounts_linked",
    );
  });
});

describe("computeProgress carries the reason alongside the number", () => {
  it("still returns 0 but says why it cannot be believed", () => {
    const p = computeProgress(goal(), []);
    expect(p.current).toBe(0);
    expect(p.pct).toBe(0);
    expect(p.untrackableReason).toBe("no_accounts_linked");
  });

  it("reports a real zero as trackable, so a genuinely empty account still shows 0%", () => {
    // This is the case the fix must NOT swallow: linked, resolvable, and the
    // balance really is zero. That zero is true and should render as a bar.
    const p = computeProgress(goal({ linked_account_ids: ["a"] }), [account("a", "0")]);
    expect(p.current).toBe(0);
    expect(p.untrackableReason).toBeNull();
  });

  it("still returns the zeros for a targetless goal but says they are unmeasured", () => {
    const p = computeProgress(
      goal({ type: "pay_down", target_amount: "", linked_account_ids: ["amex"] }),
      [account("amex", "-4200")],
    );
    expect(p.current).toBe(0);
    expect(p.target).toBe(0);
    expect(p.pct).toBe(0);
    expect(p.untrackableReason).toBe("no_target_set");
  });

  it("reports a targeted pay_down goal as trackable, so real debt progress still shows", () => {
    // The case the fix must NOT swallow: a target is set, so the bar is a
    // claim we can support even though the current amount is still zero.
    const p = computeProgress(
      goal({ type: "pay_down", target_amount: "4200", linked_account_ids: ["amex"] }),
      [account("amex", "-4200")],
    );
    expect(p.target).toBe(4200);
    expect(p.untrackableReason).toBeNull();
  });

  it("reports normal progress as trackable", () => {
    const p = computeProgress(goal({ linked_account_ids: ["a"] }), [account("a", "900")]);
    expect(p.current).toBe(900);
    expect(p.pct).toBeCloseTo(0.9);
    expect(p.untrackableReason).toBeNull();
  });
});
