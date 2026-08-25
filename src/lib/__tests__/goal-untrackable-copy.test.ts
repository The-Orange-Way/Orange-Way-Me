import { describe, it, expect } from "vitest";
import { UNTRACKABLE_COPY } from "@/lib/goal-untrackable-copy";
import { computeProgress } from "@/lib/goals-math";
import type { Goal } from "@/hooks/useGoals";
import type { Account } from "@/lib/connectors";

/**
 * DL-1588. The list tile and the goal detail page must agree about whether a
 * goal can be measured. They disagreed: the tile said "not tracking yet" and
 * the detail page drew a zero percent bar for the same goal.
 *
 * These tests pin the shared contract both screens now depend on, rather than
 * the markup of either one. A render test would need a DOM stack this repo
 * deliberately does not carry (no jsdom, no testing-library, environment is
 * "node"), so the property worth protecting is that every reason goals-math
 * can produce has copy to render, and that the reason is actually produced.
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
    linked_account_ids: ["a"],
    ...over,
  }) as unknown as Goal;

const account = (id: string, balance: string): Account =>
  ({ id, balance, currency: "USD", name: id, type: "checking" }) as unknown as Account;

describe("untrackable copy is complete for every reason goals-math can return", () => {
  it("has a message for each key, none of them empty", () => {
    const keys = Object.keys(UNTRACKABLE_COPY);
    expect(keys.length).toBeGreaterThan(0);
    for (const k of keys) {
      const copy = UNTRACKABLE_COPY[k as keyof typeof UNTRACKABLE_COPY];
      expect(typeof copy).toBe("string");
      expect(copy.trim().length).toBeGreaterThan(0);
    }
  });

  it("covers no_target_set, which is the reason the detail page drew a bar for", () => {
    const prog = computeProgress(goal({ target_amount: "0" }), [account("a", "250")]);
    expect(prog.untrackableReason).toBe("no_target_set");
    expect(UNTRACKABLE_COPY[prog.untrackableReason!]).toBeTruthy();
  });

  it("covers no_accounts_linked", () => {
    const prog = computeProgress(goal({ linked_account_ids: [] }), [account("a", "250")]);
    expect(prog.untrackableReason).toBe("no_accounts_linked");
    expect(UNTRACKABLE_COPY[prog.untrackableReason!]).toBeTruthy();
  });

  it("covers linked_accounts_missing", () => {
    const prog = computeProgress(goal({ linked_account_ids: ["gone"] }), [account("a", "250")]);
    expect(prog.untrackableReason).toBe("linked_accounts_missing");
    expect(UNTRACKABLE_COPY[prog.untrackableReason!]).toBeTruthy();
  });

  it("returns null for a goal that can be measured, so neither screen suppresses a real bar", () => {
    const prog = computeProgress(goal({}), [account("a", "250")]);
    expect(prog.untrackableReason).toBeNull();
  });
});
