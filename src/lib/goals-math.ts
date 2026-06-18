/**
 * Goals math — pure helpers for current amount, projection, ordering, amortization.
 *
 * These functions operate on the decrypted Goal + Account + Transaction shapes
 * already in memory. No encryption logic here.
 */
import type { Goal } from "@/hooks/useGoals";
import type { Account } from "@/lib/connectors";
import type { DecryptedTxn } from "@/hooks/useTransactions";

export interface GoalProgress {
  current: number;
  target: number;
  remaining: number;
  pct: number; // 0..1
  isOverdue: boolean;
  daysToTarget: number | null;
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
    return linked.reduce((sum, a) => sum + Math.max(0, Number(a.balance) || 0), 0);
  }

  // pay_down: amount paid off = starting - |current|
  const start = Number(goal.starting_balance ?? goal.target_amount) || 0;
  const currentDebt = linked.reduce((sum, a) => sum + Math.abs(Number(a.balance) || 0), 0);
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
  return { current, target, remaining, pct, isOverdue, daysToTarget };
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
