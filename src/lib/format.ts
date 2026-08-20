/**
 * Format a numeric string for display, preserving precision and using
 * tabular nums in the consuming UI. Handles BTC (8 decimals) explicitly.
 *
 * Pass `locale` (BCP 47 tag) to respect the user's numberFormat preference;
 * without it falls back to the browser locale.
 */

/** Mirrors the `BtcDisplayMode` type in `useDashboardPrefs`. */
export type BtcDisplayMode = "sats" | "btc" | "btc_easy" | "primary";

/**
 * Normalize a Bitcoin amount to a sats integer for consistent formatting.
 *
 * BTC is the currency. "Bitcoin" (decimal) and "Satoshi" (integer) are just
 * display formats. But the *stored* amount can be in either unit:
 *   - Manual user entry: typically decimal BTC ("0.05")
 *   - Automated import (OR/Blink): typically integer sats ("1121")
 *
 * Both arrive with currency="BTC" so the label alone can't disambiguate.
 * Heuristic: a value with a fractional part is decimal BTC (multiply by
 * 1e8); a whole integer ≥ 1 is already sats (leave it). Nobody enters a
 * whole BTC by typing a bare integer — they'd type "1.00000000".
 */
export function normalizeBitcoinToSats(amount: number, currency: string): number {
  if (currency === "sats") return Math.round(amount);
  // currency === "BTC"
  if (Number.isInteger(amount) && Math.abs(amount) >= 1) {
    return amount; // already sats
  }
  return Math.round(amount * 1e8); // decimal BTC → sats
}

/**
 * Currency formatter that respects the user's Bitcoin display preference.
 * Non-Bitcoin currencies are passed through unchanged.
 *   "btc"      → "0.05000000 BTC"
 *   "sats"     → "5,000,000 sats"
 *   "btc_easy" → "₿ 5,000,000" (sats count with ₿ symbol, no decimals)
 *   "primary"  → falls back to "btc" (no live exchange rate available)
 *
 * Handles both stored units transparently:
 *   currency="BTC"  → multiplied by 1e8 to get sats before formatting
 *   currency="sats" → used as-is
 */
export function formatCurrencyWithMode(
  amount: string | number,
  currency: string,
  mode: BtcDisplayMode = "btc",
  locale?: string,
): string {
  const n = typeof amount === "string" ? Number(amount) : amount;
  if (!Number.isFinite(n)) return String(amount);
  if (currency !== "BTC" && currency !== "sats") {
    return formatCurrency(String(amount), currency, locale);
  }
  const sats = normalizeBitcoinToSats(n, currency);
  switch (mode) {
    case "sats":
      return `${sats.toLocaleString(locale)} sats`;
    case "primary":
      // "₿ 1,500,000" — sats integer with Bitcoin symbol
      return `₿ ${sats.toLocaleString(locale)}`;
    case "btc_easy": {
      // "0.00 150 000 BTC" — 8-decimal BTC grouped as 2+3+3 for readability
      const btcStr = (sats / 1e8).toFixed(8);
      const [intPart, fracPart] = btcStr.split(".");
      const grouped = `${fracPart.slice(0, 2)} ${fracPart.slice(2, 5)} ${fracPart.slice(5)}`;
      return `${intPart}.${grouped} BTC`;
    }
    case "btc":
    default:
      return `${(sats / 1e8).toLocaleString(locale, {
        minimumFractionDigits: 8,
        maximumFractionDigits: 8,
      })} BTC`;
  }
}

export function formatTotalsWithMode(
  totals: Record<string, number>,
  mode: BtcDisplayMode = "btc",
  locale?: string,
): string {
  const entries = Object.entries(totals);
  if (entries.length === 0) return "—";
  return entries.map(([cur, sum]) => formatCurrencyWithMode(sum, cur, mode, locale)).join(" · ");
}

export function formatCurrency(amount: string, currency: string, locale?: string): string {
  const n = Number(amount);
  if (!Number.isFinite(n)) return amount;
  if (currency === "BTC") {
    return `${n.toLocaleString(locale, { minimumFractionDigits: 8, maximumFractionDigits: 8 })} BTC`;
  }
  if (currency === "sats") {
    return `${Math.round(n).toLocaleString(locale)} sats`;
  }
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return `${n.toFixed(2)} ${currency}`;
  }
}

export function sumByCurrency(
  amounts: { amount: string; currency: string }[],
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const a of amounts) {
    out[a.currency] = (out[a.currency] ?? 0) + Number(a.amount || 0);
  }
  return out;
}

export function formatTotals(totals: Record<string, number>): string {
  const entries = Object.entries(totals);
  if (entries.length === 0) return "—";
  return entries.map(([cur, sum]) => formatCurrency(sum.toString(), cur)).join(" · ");
}
