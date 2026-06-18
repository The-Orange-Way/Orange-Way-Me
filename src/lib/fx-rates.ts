/**
 * FX rates. BTC↔USD reads live ORBI quotes when available (refreshed by the
 * root-level useORBIBootstrap effect) and falls back to a static reference
 * value when ORBI is unreachable. Other fiat pairs stay static for MVP.
 *
 * All rates expressed as: 1 unit of FROM = X units of TO via a USD pivot.
 * BTC and sats are tracked alongside fiat (1 BTC = 1e8 sats).
 */
import { getLiveBTCRate } from "./orbi-rates";

export type SupportedCurrency = "USD" | "CAD" | "EUR" | "GBP" | "BTC" | "sats";

export const SUPPORTED_CURRENCIES: SupportedCurrency[] = [
  "USD",
  "CAD",
  "EUR",
  "GBP",
  "BTC",
  "sats",
];

// Static fallback. BTC/sats values used only when ORBI is unreachable.
const STATIC_BTC_USD = 65_000;
const USD_PER_UNIT: Record<SupportedCurrency, number> = {
  USD: 1,
  CAD: 1 / 1.36,
  EUR: 1 / 0.92,
  GBP: 1 / 0.79,
  BTC: STATIC_BTC_USD,
  sats: STATIC_BTC_USD / 1e8,
};

/** Resolve the live USD-per-unit value for a currency. BTC/sats reads ORBI when available. */
function usdPerUnit(c: SupportedCurrency): number {
  if (c === "BTC") {
    const live = getLiveBTCRate("USD");
    return live ? live.rate : USD_PER_UNIT.BTC;
  }
  if (c === "sats") {
    const live = getLiveBTCRate("USD");
    return (live ? live.rate : USD_PER_UNIT.BTC) / 1e8;
  }
  return USD_PER_UNIT[c];
}

/** Convert `amount` from currency `from` to currency `to`. */
export function convert(amount: number, from: string, to: string): number {
  const f = (from as SupportedCurrency) in USD_PER_UNIT ? (from as SupportedCurrency) : "USD";
  const t = (to as SupportedCurrency) in USD_PER_UNIT ? (to as SupportedCurrency) : "USD";
  if (!Number.isFinite(amount)) return 0;
  const usd = amount * usdPerUnit(f);
  return usd / usdPerUnit(t);
}

/**
 * Format a number in the chosen currency (no FX conversion — caller supplies the value).
 * Accepts an optional `locale` (BCP 47 tag) so the caller can plug in the
 * user's numberFormat preference. Defaults to the browser locale.
 */
export function formatInCurrency(
  amount: number,
  currency: string,
  opts?: { maximumFractionDigits?: number; locale?: string },
): string {
  const max = opts?.maximumFractionDigits;
  const loc = opts?.locale;
  if (currency === "BTC") {
    return `₿${amount.toLocaleString(loc, { maximumFractionDigits: max ?? 4 })}`;
  }
  if (currency === "sats") {
    return `${Math.round(amount).toLocaleString(loc)} sats`;
  }
  try {
    return new Intl.NumberFormat(loc, {
      style: "currency",
      currency,
      maximumFractionDigits: max ?? 0,
    }).format(amount);
  } catch {
    return `${amount.toLocaleString(loc, { maximumFractionDigits: max ?? 0 })} ${currency}`;
  }
}

export const FX_DISCLAIMER = "Currency conversions use static rates. Live rates coming soon.";
