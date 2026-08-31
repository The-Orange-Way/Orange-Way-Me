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
 * whole BTC by typing a bare integer, they would type "1.00000000".
 */
/**
 * BTC and sats are one asset in two units, so any total that mixes them has to
 * pick a unit and convert into it rather than adding the raw numbers.
 */
export function isBitcoinCurrency(currency: string): boolean {
  return currency === "BTC" || currency === "sats";
}

export function unitIsExact(formatVersion: number | undefined): boolean {
  // Absent has to read as 0. A row we have not stamped is a row whose unit we
  // have not established, and defaulting the other way would silently trust
  // every legacy row.
  return (formatVersion ?? 0) >= 1;
}

export function normalizeBitcoinToSats(
  amount: number,
  currency: string,
  opts?: { unitIsExact?: boolean },
): number {
  if (currency === "sats") return Math.round(amount);
  // currency === "BTC"
  if (opts?.unitIsExact) {
    // The row is stamped, so "BTC" means bitcoin and nothing is inferred from
    // the shape of the number. This is the branch that stops a balance of
    // exactly 1 BTC being read as one satoshi and rendering as zero.
    return Math.round(amount * 1e8);
  }
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
      // "₿ 1,500,000": sats integer with Bitcoin symbol
      return `₿ ${sats.toLocaleString(locale)}`;
    case "btc_easy": {
      // "0.00 150 000 BTC": 8-decimal BTC grouped as 2+3+3 for readability
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

/**
 * Sum amounts into one bucket per currency.
 *
 * Bitcoin is summed in SATS, under a single "sats" bucket, and BTC-denominated
 * and sats-denominated rows land in that same bucket because they are the same
 * asset. Every bitcoin amount is normalized BEFORE it is added.
 *
 * That ordering is the entire point of this function. normalizeBitcoinToSats
 * decides which unit a number is in from its magnitude, so it is only ever
 * correct on a value that came from a single account. Summing first and
 * normalizing the total once reported balances roughly 1e8 times too large:
 * a sats integer plus a decimal BTC value makes a non-integer, the heuristic
 * reads any non-integer as decimal BTC and multiplies by 1e8, and the display
 * divides by 1e8 again, so the wrong number survives the round trip intact.
 *
 * A row carrying format_version >= 1 has had its unit established by the
 * writer, so its bitcoin amount is converted without consulting the magnitude
 * at all. That is the branch that stops a holding of exactly 1 BTC being read
 * as one satoshi (DL-1449 / issue #343).
 *
 * An unstamped row keeps the heuristic, deliberately. format_version 0 means
 * the writer did not record the unit, and the sats rows already stored under a
 * BTC label would be rescaled by 1e8 the other way if the guess were dropped.
 * Build the entries with toBalanceEntry below rather than by hand: an inline
 * object literal is where the stamp was lost the first time.
 */
export function sumByCurrency(
  amounts: { amount: string; currency: string; format_version?: number }[],
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const a of amounts) {
    const n = Number(a.amount || 0);
    // A non-numeric balance used to add NaN, which poisons the whole bucket so
    // the total renders as "NaN" rather than as the other accounts in it.
    if (!Number.isFinite(n)) continue;
    if (isBitcoinCurrency(a.currency)) {
      out.sats =
        (out.sats ?? 0) +
        normalizeBitcoinToSats(n, a.currency, { unitIsExact: unitIsExact(a.format_version) });
    } else {
      out[a.currency] = (out[a.currency] ?? 0) + n;
    }
  }
  return out;
}

/**
 * Map one account onto the shape sumByCurrency reads.
 *
 * This is a function rather than an inline object literal because the inline
 * version is exactly where the stamp went missing: AccountsPage built
 * { amount, currency } at two call sites, so sumByCurrency never saw
 * format_version and a stamped balance was still read by magnitude. An object
 * literal in a JSX file cannot be tested, so nothing failed when the wiring
 * came apart. This can be, and is.
 *
 * txnSum is the live-balance fallback: when the stored balance is exactly zero
 * but transactions exist, their sum stands in for it. That sum has already been
 * reduced to sats by the caller, so this branch declares "sats" outright and
 * carries no stamp. The absence there is correct rather than an omission,
 * because normalizeBitcoinToSats never consults the stamp for a sats amount.
 */
export type BalanceEntry = { amount: string; currency: string; format_version?: number };

export function toBalanceEntry(
  account: { balance: string; currency: string; format_version?: number },
  txnSum?: number,
): BalanceEntry {
  const stored = Number(account.balance);
  const useTxnLive =
    Number.isFinite(stored) &&
    stored === 0 &&
    typeof txnSum === "number" &&
    Math.abs(txnSum) > 0.005;
  if (!useTxnLive) {
    return {
      amount: account.balance,
      currency: account.currency,
      format_version: account.format_version,
    };
  }
  return {
    amount: String(txnSum),
    currency: isBitcoinCurrency(account.currency) ? "sats" : account.currency,
  };
}

/** Build Accounts-page subtotal entries, preserving each account's transaction lookup. */
export function toAccountSubtotalEntries(
  accounts: { id: string; balance: string; currency: string; format_version?: number }[],
  txnSumByAccount: ReadonlyMap<string, number>,
): BalanceEntry[] {
  return accounts.map((account) => toBalanceEntry(account, txnSumByAccount.get(account.id)));
}

/**
 * Legacy totals formatter with no callers as of this change. It routes through
 * formatCurrency, which does not normalize bitcoin, so it cannot render the
 * "sats" bucket sumByCurrency now produces. Use formatTotalsWithMode. If you
 * are about to call this, delete it instead.
 */
export function formatTotals(totals: Record<string, number>): string {
  const entries = Object.entries(totals);
  if (entries.length === 0) return "—";
  return entries.map(([cur, sum]) => formatCurrency(sum.toString(), cur)).join(" · ");
}
