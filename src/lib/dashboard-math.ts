/**
 * Dashboard math — pure helpers over decrypted accounts + transactions.
 *
 * Rules:
 *   - All sums use static FX conversion to a primary currency.
 *   - Splits: skip children (parent carries authoritative bank amount).
 *   - Transfers: excluded from income/spending tallies (real cash flow only).
 *   - Net worth series: derived by walking transaction flow backwards from
 *     the current account balance — no DB snapshots needed.
 */
import type { Account } from "@/lib/connectors";
import type { DecryptedTxn } from "@/hooks/useTransactions";
import { convert } from "@/lib/fx-rates";
import { unitIsExact } from "@/lib/format";
import { isSpendable } from "@/lib/budget-math";

// ---------------------------------------------------------------------------
// Net Worth
// ---------------------------------------------------------------------------

export interface NetWorthPoint {
  /** ISO YYYY-MM-DD for the first day of the month. */
  date: string;
  /** Net worth in the primary currency at the END of this month. */
  value: number;
}

/**
 * Build a monthly net-worth series ending at "today". For each month boundary
 * we take the current account balances and subtract all transactions that
 * occurred AFTER that boundary — yielding the historical balance.
 *
 * monthsBack: how many months of history to include (e.g. 12 for 1Y, 1 for 1M).
 */
export function netWorthSeries(
  accounts: Account[],
  txns: DecryptedTxn[],
  primaryCurrency: string,
  monthsBack: number,
): NetWorthPoint[] {
  const today = new Date();
  // Anchor at end of current month for the latest point.
  const points: Date[] = [];
  for (let i = monthsBack; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth() - i + 1, 0);
    d.setHours(0, 0, 0, 0);
    points.push(d);
  }

  // Total current net worth in primary currency.
  const currentNW = accounts.reduce(
    (sum, a) =>
      sum +
      convert(Number(a.balance) || 0, a.currency, primaryCurrency, {
        unitIsExact: unitIsExact(a.format_version),
      }),
    0,
  );

  // For each historical point, subtract everything after that point.
  // We index account currencies for FX conversion.
  const acctCurrency = new Map(accounts.map((a) => [a.id, a.currency]));

  return points.map((boundary) => {
    let flowAfter = 0;
    const tBoundary = boundary.getTime();
    for (const t of txns) {
      if (t.split_parent_id) continue; // children
      const tDate = new Date(t.date + "T00:00:00").getTime();
      if (tDate <= tBoundary) continue;
      const cur = acctCurrency.get(t.account_id) ?? primaryCurrency;
      flowAfter += convert(Number(t.amount) || 0, cur, primaryCurrency);
    }
    return {
      date: new Date(boundary.getFullYear(), boundary.getMonth(), 1).toISOString().slice(0, 10),
      value: currentNW - flowAfter,
    };
  });
}

// ---------------------------------------------------------------------------
// Cash flow per month (last N months)
// ---------------------------------------------------------------------------

export interface CashFlowMonth {
  /** YYYY-MM-01 */
  monthKey: string;
  income: number;
  spending: number; // positive number
  net: number;
}

export function cashFlowByMonth(
  accounts: Account[],
  txns: DecryptedTxn[],
  primaryCurrency: string,
  monthsBack: number,
): CashFlowMonth[] {
  const acctCurrency = new Map(accounts.map((a) => [a.id, a.currency]));
  const today = new Date();
  const buckets: CashFlowMonth[] = [];
  for (let i = monthsBack - 1; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
    buckets.push({
      monthKey: d.toISOString().slice(0, 10),
      income: 0,
      spending: 0,
      net: 0,
    });
  }

  for (const t of txns) {
    if (!isSpendable(t)) continue;
    const d = new Date(t.date + "T00:00:00");
    const key = new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
    const bucket = buckets.find((b) => b.monthKey === key);
    if (!bucket) continue;
    const cur = acctCurrency.get(t.account_id) ?? primaryCurrency;
    const amt = convert(Number(t.amount) || 0, cur, primaryCurrency);
    if (amt >= 0) bucket.income += amt;
    else bucket.spending += Math.abs(amt);
  }
  for (const b of buckets) b.net = b.income - b.spending;
  return buckets;
}

// ---------------------------------------------------------------------------
// This month summary (income, spending, net + comparison to last month)
// ---------------------------------------------------------------------------

export interface MonthSummary {
  income: number;
  spending: number;
  net: number;
  incomeDeltaPct: number | null;
  spendingDeltaPct: number | null;
}

export function thisMonthSummary(
  accounts: Account[],
  txns: DecryptedTxn[],
  primaryCurrency: string,
  anchor: Date = new Date(),
): MonthSummary {
  const acctCurrency = new Map(accounts.map((a) => [a.id, a.currency]));
  const ym = (d: Date) => `${d.getFullYear()}-${d.getMonth()}`;
  const thisYM = ym(anchor);
  const lastYM = ym(new Date(anchor.getFullYear(), anchor.getMonth() - 1, 1));

  let inc = 0;
  let sp = 0;
  let incPrev = 0;
  let spPrev = 0;

  for (const t of txns) {
    if (!isSpendable(t)) continue;
    const d = new Date(t.date + "T00:00:00");
    const k = ym(d);
    if (k !== thisYM && k !== lastYM) continue;
    const cur = acctCurrency.get(t.account_id) ?? primaryCurrency;
    const amt = convert(Number(t.amount) || 0, cur, primaryCurrency);
    if (k === thisYM) {
      if (amt >= 0) inc += amt;
      else sp += Math.abs(amt);
    } else {
      if (amt >= 0) incPrev += amt;
      else spPrev += Math.abs(amt);
    }
  }

  return {
    income: inc,
    spending: sp,
    net: inc - sp,
    incomeDeltaPct: incPrev > 0 ? ((inc - incPrev) / incPrev) * 100 : null,
    spendingDeltaPct: spPrev > 0 ? ((sp - spPrev) / spPrev) * 100 : null,
  };
}

// ---------------------------------------------------------------------------
// Accounts summary (assets vs liabilities)
// ---------------------------------------------------------------------------

const LIABILITY_TYPES = new Set(["credit", "loan"]);
const ASSET_TYPES = new Set([
  "checking",
  "savings",
  "investment",
  "bitcoin",
  "real_estate",
  "other",
]);

export interface AccountsSummary {
  assets: number;
  liabilities: number;
  net: number;
  assetAccounts: Account[];
  liabilityAccounts: Account[];
  rawByCurrency: Record<string, number>;
}

export function accountsSummary(accounts: Account[], primaryCurrency: string): AccountsSummary {
  let assets = 0;
  let liabilities = 0;
  const rawByCurrency: Record<string, number> = {};
  const assetAccounts: Account[] = [];
  const liabilityAccounts: Account[] = [];

  for (const a of accounts) {
    const bal = Number(a.balance) || 0;
    rawByCurrency[a.currency] = (rawByCurrency[a.currency] ?? 0) + bal;
    const inPrimary = convert(bal, a.currency, primaryCurrency, {
      unitIsExact: unitIsExact(a.format_version),
    });
    if (LIABILITY_TYPES.has(a.type)) {
      liabilities += Math.abs(inPrimary);
      liabilityAccounts.push(a);
    } else if (ASSET_TYPES.has(a.type)) {
      assets += inPrimary;
      assetAccounts.push(a);
    } else {
      assets += inPrimary;
      assetAccounts.push(a);
    }
  }
  return {
    assets,
    liabilities,
    net: assets - liabilities,
    assetAccounts,
    liabilityAccounts,
    rawByCurrency,
  };
}

// ---------------------------------------------------------------------------
// Recurring bill detection (90d, monthly cadence, ±5% tolerance)
// ---------------------------------------------------------------------------

export interface RecurringBill {
  /** Stable opaque key — merchant + rounded amount band. Used for dismissals. */
  key: string;
  merchant: string;
  category_id: string | null;
  /** Average absolute amount (positive). */
  typicalAmount: number;
  /** Last seen date (YYYY-MM-DD). */
  lastDate: string;
  /** Predicted next occurrence (Date). */
  nextDate: Date;
  /** Average gap in days. */
  avgGap: number;
  occurrences: number;
}

function djb2Hash(input: string): string {
  let h = 5381;
  for (let i = 0; i < input.length; i++) h = ((h << 5) + h) ^ input.charCodeAt(i);
  return (h >>> 0).toString(36);
}

export function detectRecurringBills(
  txns: DecryptedTxn[],
  options: { lookbackDays?: number; horizonDays?: number; today?: Date } = {},
): RecurringBill[] {
  const { lookbackDays = 90, horizonDays = 14, today = new Date() } = options;
  const cutoff = new Date(today);
  cutoff.setDate(cutoff.getDate() - lookbackDays);
  cutoff.setHours(0, 0, 0, 0);

  // Group by (merchant lowercased, amount band rounded to 5%).
  type Key = string;
  const groups = new Map<Key, DecryptedTxn[]>();

  for (const t of txns) {
    if (t.split_parent_id || t.transfer_group_id) continue;
    const merchant = (t.merchant || t.description || "").trim().toLowerCase();
    if (!merchant) continue;
    const amt = Math.abs(Number(t.amount) || 0);
    if (amt < 1) continue; // ignore tiny noise
    if (Number(t.amount) >= 0) continue; // bills are outflows
    const d = new Date(t.date + "T00:00:00");
    if (d < cutoff) continue;

    // Band amounts within ±5% by rounding to nearest 5% bucket.
    const band = Math.round(amt / (amt * 0.05 + 1)) * 1; // simple bucketing
    const bandKey = `${Math.round(amt)}`; // exact-dollar bucket; we'll relax with overlap below
    const key = `${merchant}::${bandKey}`;
    const arr = groups.get(key) ?? [];
    arr.push(t);
    groups.set(key, arr);
    void band;
  }

  // Merge nearby bands for the same merchant within ±5%.
  const merchantGroups = new Map<string, DecryptedTxn[]>();
  for (const [k, arr] of groups) {
    const merchant = k.split("::")[0];
    const existing = merchantGroups.get(merchant);
    if (!existing) {
      merchantGroups.set(merchant, [...arr]);
      continue;
    }
    const refAmt = Math.abs(Number(existing[0].amount));
    const newAmt = Math.abs(Number(arr[0].amount));
    if (Math.abs(refAmt - newAmt) / Math.max(refAmt, newAmt) <= 0.05) {
      existing.push(...arr);
    } else {
      // Different price tier — track separately under merchant+band.
      merchantGroups.set(`${merchant}::${Math.round(newAmt)}`, [...arr]);
    }
  }

  const out: RecurringBill[] = [];
  const horizon = new Date(today);
  horizon.setDate(horizon.getDate() + horizonDays);

  for (const [key, arr] of merchantGroups) {
    if (arr.length < 2) continue;
    const sorted = arr.slice().sort((a, b) => a.date.localeCompare(b.date));

    // Compute gaps between consecutive occurrences.
    const gaps: number[] = [];
    for (let i = 1; i < sorted.length; i++) {
      const a = new Date(sorted[i - 1].date + "T00:00:00").getTime();
      const b = new Date(sorted[i].date + "T00:00:00").getTime();
      gaps.push(Math.round((b - a) / 86_400_000));
    }
    if (gaps.length === 0) continue;

    // Monthly cadence: most gaps in 25–35 days.
    const monthly = gaps.filter((g) => g >= 25 && g <= 35).length;
    if (monthly < Math.max(1, Math.floor(gaps.length / 2))) continue;

    const avgGap = gaps.reduce((s, g) => s + g, 0) / gaps.length;
    const last = sorted[sorted.length - 1];
    const lastDate = new Date(last.date + "T00:00:00");
    const next = new Date(lastDate);
    next.setDate(next.getDate() + Math.round(avgGap));

    if (next < today || next > horizon) continue;

    const typicalAmount =
      sorted.reduce((s, t) => s + Math.abs(Number(t.amount) || 0), 0) / sorted.length;

    const merchant = key.split("::")[0];
    const display = last.merchant || merchant;
    const stable = djb2Hash(`${merchant.toLowerCase()}|${Math.round(typicalAmount)}`);

    out.push({
      key: stable,
      merchant: display,
      category_id: last.category_id,
      typicalAmount,
      lastDate: last.date,
      nextDate: next,
      avgGap,
      occurrences: sorted.length,
    });
  }

  return out.sort((a, b) => a.nextDate.getTime() - b.nextDate.getTime());
}
