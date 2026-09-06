/**
 * Locale-aware formatting driven by user preferences.
 *
 * Number formats:
 *   us → 1,234.56  (en-US)
 *   eu → 1.234,56  (de-DE)
 *
 * Date formats:
 *   us → 4/18/2026     (en-US)
 *   eu → 18/04/2026    (en-GB — DMY with slashes)
 *   iso → 2026-04-18   (no locale)
 *
 * Canonical wire format for dates is always ISO YYYY-MM-DD. Display happens
 * at render time; parsing of user-typed values goes through parseDate().
 */
import {
  useDashboardPrefs,
  type DateFormatPref,
  type NumberFormatPref,
} from "@/hooks/useDashboardPrefs";
import { formatCurrencyWithMode, type BtcDisplayMode } from "@/lib/format";

export function numberLocale(pref: NumberFormatPref): string {
  return pref === "eu" ? "de-DE" : "en-US";
}

/** Returns the Intl locale to use for date display (ISO is handled separately). */
export function dateLocale(pref: DateFormatPref): string {
  return pref === "us" ? "en-US" : "en-GB";
}

export function formatNumber(
  n: number,
  pref: NumberFormatPref,
  opts?: Intl.NumberFormatOptions,
): string {
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat(numberLocale(pref), opts).format(n);
}

export function formatCurrencyLocale(
  amount: number,
  currency: string,
  numberPref: NumberFormatPref,
  opts?: { maximumFractionDigits?: number; minimumFractionDigits?: number },
): string {
  if (!Number.isFinite(amount)) return "—";
  if (currency === "BTC") {
    return `₿${formatNumber(amount, numberPref, {
      maximumFractionDigits: opts?.maximumFractionDigits ?? 4,
      minimumFractionDigits: opts?.minimumFractionDigits ?? 0,
    })}`;
  }
  if (currency === "sats") {
    return `${formatNumber(Math.round(amount), numberPref, { maximumFractionDigits: 0 })} sats`;
  }
  try {
    return new Intl.NumberFormat(numberLocale(numberPref), {
      style: "currency",
      currency,
      minimumFractionDigits: opts?.minimumFractionDigits ?? 0,
      maximumFractionDigits: opts?.maximumFractionDigits ?? 0,
    }).format(amount);
  } catch {
    return `${formatNumber(amount, numberPref, opts)} ${currency}`;
  }
}

/**
 * Locale- and preference-aware currency formatter.
 *
 * BTC and sats route through formatCurrencyWithMode so the user's
 * btcDisplayMode (sats / btc / btc_easy / primary) is honoured. Every other
 * currency renders exactly as formatCurrencyLocale always has.
 *
 * This exists as a plain function, separate from useLocaleFormat, so it can
 * be unit tested with no React context. See locale-currency-pref.test.ts.
 */
export function formatCurrencyPref(
  amount: number,
  currency: string,
  numberPref: NumberFormatPref,
  btcDisplayMode: BtcDisplayMode,
  opts?: { maximumFractionDigits?: number; minimumFractionDigits?: number; unitIsExact?: boolean },
): string {
  if (currency === "BTC" || currency === "sats") {
    return formatCurrencyWithMode(amount, currency, btcDisplayMode, numberLocale(numberPref), {
      unitIsExact: opts?.unitIsExact,
    });
  }
  return formatCurrencyLocale(amount, currency, numberPref, opts);
}

/** Format a Date (or YYYY-MM-DD string) using the user's dateFormat pref. */
export function formatDate(
  value: Date | string | null | undefined,
  pref: DateFormatPref,
  opts?: Intl.DateTimeFormatOptions,
): string {
  if (value == null) return "";
  const d = typeof value === "string" ? parseDate(value) : value;
  if (!d || Number.isNaN(d.getTime())) return "";
  if (pref === "iso" && !opts) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  return new Intl.DateTimeFormat(
    dateLocale(pref),
    opts ?? { year: "numeric", month: "2-digit", day: "2-digit" },
  ).format(d);
}

/**
 * Parse a user-typed date string. Accepts:
 *  - ISO YYYY-MM-DD
 *  - US M/D/YYYY or MM/DD/YYYY
 *  - EU D/M/YYYY or DD/MM/YYYY (or with dots / dashes)
 */
export function parseDate(input: string, pref: DateFormatPref = "iso"): Date | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  // ISO always wins
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(trimmed);
  if (iso) {
    const [, y, m, d] = iso;
    return buildDate(+y, +m, +d);
  }
  const parts = trimmed.split(/[/\-.]/).map((p) => p.trim());
  if (parts.length !== 3) return null;
  const [a, b, c] = parts;
  const na = Number(a);
  const nb = Number(b);
  const nc = Number(c);
  if (![na, nb, nc].every(Number.isFinite)) return null;
  // If year-first slots in, treat as ISO
  if (a.length === 4) return buildDate(na, nb, nc);
  if (c.length === 4) {
    if (pref === "us") return buildDate(nc, na, nb); // M/D/Y
    return buildDate(nc, nb, na); // D/M/Y (eu + fallback)
  }
  return null;
}

function buildDate(y: number, m: number, d: number): Date | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(y, m - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null;
  return dt;
}

/** ISO YYYY-MM-DD for a Date. */
export function toIsoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Placeholder text reflecting the user's date format — shown in text inputs
 * so the user knows what they can type.
 */
export function datePlaceholder(pref: DateFormatPref): string {
  if (pref === "iso") return "YYYY-MM-DD";
  if (pref === "eu") return "DD/MM/YYYY";
  return "MM/DD/YYYY";
}

/** React hook: returns locale-aware formatters bound to the user's prefs. */
export function useLocaleFormat() {
  const { prefs } = useDashboardPrefs();
  return {
    numberPref: prefs.numberFormat,
    datePref: prefs.dateFormat,
    formatNumber: (n: number, opts?: Intl.NumberFormatOptions) =>
      formatNumber(n, prefs.numberFormat, opts),
    formatCurrency: (
      amount: number,
      currency: string,
      opts?: {
        maximumFractionDigits?: number;
        minimumFractionDigits?: number;
        unitIsExact?: boolean;
      },
    ) => formatCurrencyPref(amount, currency, prefs.numberFormat, prefs.btcDisplayMode, opts),
    formatDate: (value: Date | string | null | undefined, opts?: Intl.DateTimeFormatOptions) =>
      formatDate(value, prefs.dateFormat, opts),
    parseDate: (input: string) => parseDate(input, prefs.dateFormat),
    datePlaceholder: datePlaceholder(prefs.dateFormat),
  };
}
