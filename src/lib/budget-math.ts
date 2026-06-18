/**
 * Budget math helpers — pure functions over decrypted transactions.
 *
 * Spent rule: sum the absolute value of negative-amount transactions.
 * Skip split children (parent has authoritative bank amount). Skip transfers
 * (transfer_group_id is set) — they aren't real spending. Income is the sum
 * of positive amounts excluding transfers.
 */
import type { DecryptedTxn } from "@/hooks/useTransactions";

export function isSpendable(t: DecryptedTxn): boolean {
  if (t.split_parent_id) return false; // split children excluded
  if (t.transfer_group_id) return false; // transfers excluded
  return true;
}

export function spentByCategory(items: DecryptedTxn[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const t of items) {
    if (!isSpendable(t)) continue;
    const n = Number(t.amount);
    if (n >= 0) continue;
    const key = t.category_id ?? "__uncategorized__";
    out[key] = (out[key] ?? 0) + Math.abs(n);
  }
  return out;
}

export function totalIncome(items: DecryptedTxn[]): number {
  let sum = 0;
  for (const t of items) {
    if (!isSpendable(t)) continue;
    const n = Number(t.amount);
    if (n > 0) sum += n;
  }
  return sum;
}

/** Progress color tier from 0..1. */
export function progressTier(pct: number): "ok" | "warn" | "over" {
  if (pct >= 1) return "over";
  if (pct >= 0.8) return "warn";
  return "ok";
}

export function tierClasses(tier: "ok" | "warn" | "over"): {
  bar: string;
  text: string;
} {
  switch (tier) {
    case "over":
      return { bar: "bg-destructive", text: "text-destructive" };
    case "warn":
      return { bar: "bg-amber-500", text: "text-amber-600 dark:text-amber-400" };
    case "ok":
    default:
      return { bar: "bg-emerald-600", text: "text-emerald-600 dark:text-emerald-400" };
  }
}

/**
 * Format a number as $1,234 (always rounded, no decimals for budget displays).
 * Pass `locale` to respect the user's numberFormat pref (e.g. "de-DE" for EU).
 */
export function fmtMoney(n: number, locale?: string): string {
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  return `${sign}$${abs.toLocaleString(locale, { maximumFractionDigits: 0 })}`;
}

export function fmtMoneyPrecise(n: number, locale?: string): string {
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  return `${sign}$${abs.toLocaleString(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
