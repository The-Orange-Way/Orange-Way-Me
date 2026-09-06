/**
 * Goals math — pure helpers for current amount, projection, ordering, amortization.
 *
 * These functions operate on the decrypted Goal + Account + Transaction shapes
 * already in memory. No encryption logic here.
 */
import type { Goal } from "@/hooks/useGoals";
import type { Account } from "@/lib/connectors";
import type { DecryptedTxn } from "@/hooks/useTransactions";
import { isBitcoinCurrency, normalizeBitcoinToSats, unitIsExact } from "@/lib/format";

/**
 * A linked account's balance, normalized to sats when the currency is
 * Bitcoin-like so it is never summed at face value against a mismatched
 * unit. Non-Bitcoin currencies pass through unchanged (see the module-level
 * note on computeCurrent for the FX limitation this does not fix).
 */
function normalizedBalance(a: Account): number {
  const raw = Number(a.balance) || 0;
  if (!isBitcoinCurrency(a.currency)) return raw;
  return normalizeBitcoinToSats(raw, a.currency, { unitIsExact: unitIsExact(a.format_version) });
}

export interface GoalProgress {
  current: number;
  target: number;
  remaining: number;
  pct: number; // 0..1
  isOverdue: boolean;
  daysToTarget: number | null;
  /**
   * Why this goal's current amount cannot be believed, or null when it can.
   *
   * DL-1425: a goal whose progress is derived from linked accounts returns 0
   * when there are no accounts to sum. That zero is indistinguishable from
   * "you have saved nothing yet", and a beta tester read it as the second when
   * it was the first. A caller that shows a progress bar has to be able to tell
   * these apart, so the reason travels with the number.
   *
   *   "no_target_set"  the goal carries no usable target to measure against
   *   "no_accounts_linked"  the goal has no linked account ids at all
   *   "linked_accounts_missing"  it has ids, but none resolve to a real account
   */
  untrackableReason: "no_target_set" | "no_accounts_linked" | "linked_accounts_missing" | null;
}

/**
 * Whether this goal derives its current amount by summing linked accounts.
 *
 * A save_up goal on the specific_amount strategy carries a manual allocation
 * instead, so it is legitimately trackable with nothing linked.
 */
export function derivesFromLinkedAccounts(goal: Goal): boolean {
  return !(goal.type === "save_up" && goal.strategy === "specific_amount");
}

/**
 * Why a goal's computed current amount cannot be believed, or null.
 *
 * Kept separate from computeCurrent because the sum itself is still a correct
 * sum of nothing. What is wrong is reporting it as progress.
 */
export function untrackableReason(
  goal: Goal,
  accounts: Account[],
): "no_target_set" | "no_accounts_linked" | "linked_accounts_missing" | null {
  // Checked before the strategy split because a missing target defeats every
  // goal type. computeProgress divides by the target, so without one the
  // percentage is not "zero progress", it is a division that was never
  // attempted. A pay_down goal is the visible case: its starting balance
  // falls back to the target, so an absent target makes both the numerator
  // and the denominator zero and the card reads "0% of $0" over a card that
  // plainly carries a debt.
  if (!((Number(goal.target_amount) || 0) > 0)) return "no_target_set";
  if (!derivesFromLinkedAccounts(goal)) return null;
  if (goal.linked_account_ids.length === 0) return "no_accounts_linked";
  const resolved = accounts.filter((a) => goal.linked_account_ids.includes(a.id));
  if (resolved.length === 0) return "linked_accounts_missing";
  return null;
}

/**
 * Compute the goal's current amount from its linked accounts.
 *
 * - save_up + all_balance: sum of linked account balances (positive numbers)
 * - save_up + specific_amount: the user's manual allocation
 * - pay_down: starting_balance - |current debt balance|, where debt balances are
 *   typically negative; we coerce to positive for display ("paid off so far")
 */
export function computeCurrent(goal: Goal, accounts: Account[]): number {
  const linked = accounts.filter((a) => goal.linked_account_ids.includes(a.id));

  if (goal.type === "save_up") {
    if (goal.strategy === "specific_amount") {
      return Number(goal.manual_allocation ?? "0") || 0;
    }
    return linked.reduce((sum, a) => sum + Math.max(0, normalizedBalance(a)), 0);
  }

  // pay_down: amount paid off = starting - |current|
  const start = Number(goal.starting_balance ?? goal.target_amount) || 0;
  const currentDebt = linked.reduce((sum, a) => sum + Math.abs(normalizedBalance(a)), 0);
  return Math.max(0, start - currentDebt);
}

export function computeProgress(goal: Goal, accounts: Account[]): GoalProgress {
  const current = computeCurrent(goal, accounts);
  const target = Number(goal.target_amount) || 0;
  const remaining = Math.max(0, target - current);
  const pct = target > 0 ? Math.min(1, current / target) : 0;
  let daysToTarget: number | null = null;
  let isOverdue = false;
  if (goal.target_date) {
    const t = new Date(goal.target_date + "T00:00:00").getTime();
    const days = Math.round((t - Date.now()) / 86_400_000);
    daysToTarget = days;
    if (days < 0 && current < target) isOverdue = true;
  }
  return {
    current,
    target,
    remaining,
    pct,
    isOverdue,
    daysToTarget,
    untrackableReason: untrackableReason(goal, accounts),
  };
}

export interface GoalsSummary {
  /** Sum of each measurable goal's progress, capped at that goal's own target. */
  saved: number;
  /** Sum of the measurable goals' targets. */
  target: number;
  /** 0..1. Cannot exceed 1, because every term of `saved` is capped at its own target. */
  pct: number;
  /** How many active goals contributed to the figures above. */
  counted: number;
  /** How many active goals exist, measurable or not. */
  active: number;
}

/**
 * Roll the active goals up into the one line at the top of the goals screen.
 *
 * This lives here rather than in the page because it has to agree with
 * computeProgress, and the two drifted apart while the header was written
 * inline in JSX where nothing could test it (DL-1603). Two ways they disagreed:
 *
 * 1. The header measured goals the tiles refuse to measure. A goal with no
 *    linked accounts still carries a target, so summing it contributed a real
 *    denominator against a current of zero. Its own tile says "Not tracking
 *    yet" and draws no bar, while the header scored it zero percent and pulled
 *    the headline down. Skipping it is the same refusal the tile already makes.
 *
 * 2. A goal contributed more than its own target. computeProgress caps the
 *    per-goal pct at 1 but returns `current` uncapped, so an over-funded goal
 *    spilled its excess into another goal's shortfall. Capping each term at its
 *    own target is what makes "progress across your goals" mean anything: money
 *    past a goal's finish line is not progress toward a different goal.
 *
 * Two goals linked to the same account (DL-1589) are handled below: Product
 * ruled on OWM-T0210 that sharing an account is supported, so a save_up +
 * all_balance goal's contribution is deduped by account rather than summed
 * once per goal.
 */
export function summariseGoals(goals: Goal[], accounts: Account[]): GoalsSummary {
  let dedupedAccountSaved = 0;
  let otherSaved = 0;
  let target = 0;
  let counted = 0;
  let active = 0;
  const seenAccountIds = new Set<string>();

  for (const g of goals) {
    if (g.is_completed) continue;
    active += 1;
    const p = computeProgress(g, accounts);
    if (p.untrackableReason) continue;
    counted += 1;
    target += p.target;

    // save_up + all_balance is the strategy whose `current` IS a raw sum of
    // linked account balances (see computeCurrent above), so two such goals
    // sharing an account each claim its whole balance. Counting a shared
    // account's balance once here, instead of once per goal, is the header
    // fix from OWM-T0210 / DL-1589. Every other goal type (a save_up
    // specific_amount manual allocation, or a pay_down goal's paid-off
    // amount) has no such overlap today and keeps the old per-goal sum,
    // capped at that goal's own target as before.
    if (g.type === "save_up" && g.strategy !== "specific_amount") {
      for (const accId of g.linked_account_ids) {
        if (seenAccountIds.has(accId)) continue;
        seenAccountIds.add(accId);
        const acc = accounts.find((a) => a.id === accId);
        if (!acc) continue;
        dedupedAccountSaved += Math.max(0, Number(acc.balance) || 0);
      }
    } else {
      otherSaved += Math.min(p.current, p.target);
    }
  }

  const saved = dedupedAccountSaved + otherSaved;
  return {
    saved,
    target,
    pct: target > 0 ? Math.min(1, saved / target) : 0,
    counted,
    active,
  };
}

/**
 * Average monthly contribution across the trailing N months of transactions
 * for the goal's linked accounts. For save_up: positive net inflow.
 * For pay_down: positive net outflow (payments) — measured as -net.
 */
export function averageMonthlyContribution(goal: Goal, txns: DecryptedTxn[], months = 3): number {
  if (goal.linked_account_ids.length === 0) return 0;
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - months);
  const cutoffMs = cutoff.getTime();

  let net = 0;
  for (const t of txns) {
    if (!goal.linked_account_ids.includes(t.account_id)) continue;
    if (t.split_parent_id) continue;
    if (new Date(t.date + "T00:00:00").getTime() < cutoffMs) continue;
    net += Number(t.amount) || 0;
  }
  const perMonth = net / months;
  return goal.type === "save_up" ? perMonth : -perMonth;
}

/**
 * Estimate the date the goal will be hit at the current contribution pace.
 * Returns null when the pace is non-positive or already complete.
 */
export function projectCompletionDate(
  goal: Goal,
  current: number,
  monthlyContribution: number,
): Date | null {
  const target = Number(goal.target_amount) || 0;
  if (current >= target) return new Date();
  if (monthlyContribution <= 0) return null;
  const months = (target - current) / monthlyContribution;
  if (!Number.isFinite(months) || months > 600) return null;
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + Math.ceil(months));
  return d;
}

/** Order pay-down goals by avalanche or snowball. */
export function orderPayDown(
  goals: Goal[],
  accounts: Account[],
  strategy: "avalanche" | "snowball",
): Goal[] {
  const withDebt = goals
    .filter((g) => g.type === "pay_down" && !g.is_completed)
    .map((g) => {
      const linked = accounts.filter((a) => g.linked_account_ids.includes(a.id));
      const debt = linked.reduce((sum, a) => sum + Math.abs(Number(a.balance) || 0), 0);
      const apr = Number(g.interest_rate ?? "0") || 0;
      return { goal: g, debt, apr };
    });
  if (strategy === "avalanche") {
    withDebt.sort((a, b) => b.apr - a.apr || a.debt - b.debt);
  } else {
    withDebt.sort((a, b) => a.debt - b.debt || b.apr - a.apr);
  }
  return withDebt.map((x) => x.goal);
}

/**
 * Amortization preview — how many months and how much interest at a fixed
 * monthly payment. Returns null when payment can't cover monthly interest.
 */
export interface Amortization {
  months: number;
  totalInterest: number;
  payoffDate: Date;
}
export function amortize(
  balance: number,
  aprPct: number,
  monthlyPayment: number,
): Amortization | null {
  if (balance <= 0 || monthlyPayment <= 0) return null;
  const r = aprPct / 100 / 12;
  let bal = balance;
  let totalInterest = 0;
  let months = 0;
  while (bal > 0.01 && months < 600) {
    const interest = bal * r;
    if (monthlyPayment <= interest + 0.001) return null;
    const principal = monthlyPayment - interest;
    bal -= principal;
    totalInterest += interest;
    months++;
  }
  const payoffDate = new Date();
  payoffDate.setMonth(payoffDate.getMonth() + months);
  return { months, totalInterest, payoffDate };
}

/** Build a 12-month time series of the goal's "current amount" from txns. */
export function balanceHistory(
  goal: Goal,
  accounts: Account[],
  txns: DecryptedTxn[],
): Array<{ date: string; value: number }> {
  const monthCount = 12;
  const today = new Date();
  today.setDate(1);
  const months: Date[] = [];
  for (let i = monthCount - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setMonth(today.getMonth() - i);
    months.push(d);
  }

  // Start from the current computed value and walk backwards, removing
  // transactions per month. This avoids needing an external "snapshot at
  // month X" — we approximate by reversing the in-range txn flow.
  const currentValue = computeCurrent(goal, accounts);
  const linkedIds = new Set(goal.linked_account_ids);
  const inRange = txns.filter((t) => linkedIds.has(t.account_id) && !t.split_parent_id);

  // For each month boundary, sum txns AFTER that boundary and subtract.
  const series: Array<{ date: string; value: number }> = [];
  for (let i = months.length - 1; i >= 0; i--) {
    const boundary = months[i].getTime();
    let flowAfter = 0;
    for (const t of inRange) {
      if (new Date(t.date + "T00:00:00").getTime() >= boundary) {
        flowAfter += Number(t.amount) || 0;
      }
    }
    const valueAtBoundary =
      goal.type === "save_up" ? currentValue - flowAfter : currentValue + flowAfter;
    series.push({
      date: months[i].toISOString().slice(0, 10),
      value: Math.max(0, valueAtBoundary),
    });
  }
  return series.reverse();
}
