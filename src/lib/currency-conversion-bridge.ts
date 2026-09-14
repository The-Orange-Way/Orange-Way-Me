/**
 * BTC-bridged conversion from a transaction's native currency into a
 * household's two Admin-selected currencies (OWM-T0159, this ticket
 * OWM-T0747). Depends on getRate (src/lib/rate-series-cache.ts).
 *
 * ORBI prices BTC against one fiat at a time; there is no direct fiat/fiat
 * rate. So amount(native) -> BTC via native's own rate, then BTC ->
 * selection via the selection's rate. A rate is "currency units per 1 BTC"
 * (the same convention rate-series-cache and orbi-rates already use), so:
 *   btc = amount / getRate(native, date)
 *   value(selection) = btc * getRate(selection, date)
 */
import { getRate } from "./rate-series-cache";

export type ConversionResult = { value: number } | { unavailable: true };

export interface HouseholdConversion {
  selection1: ConversionResult;
  selection2: ConversionResult;
}

async function resolveSelection(
  amount: number,
  nativeCurrency: string,
  selection: string,
  date: Date,
): Promise<ConversionResult> {
  if (selection === nativeCurrency) {
    // Same currency: no bridge, no rate lookup, no rounding-error round trip.
    return { value: amount };
  }
  const nativeRate = await getRate(nativeCurrency, date);
  if (nativeRate === undefined) return { unavailable: true };
  const selectionRate = await getRate(selection, date);
  if (selectionRate === undefined) return { unavailable: true };

  const btc = amount / nativeRate;
  return { value: btc * selectionRate };
}

/**
 * Convert `amount` (in `nativeCurrency`, valued at `date`) into `selection1`
 * and `selection2`. Each output is `{value}` or `{unavailable: true}`,
 * never a guessed number standing in for a rate that does not exist.
 */
export async function convertToHouseholdCurrencies(
  amount: number,
  nativeCurrency: string,
  date: Date,
  selection1: string,
  selection2: string,
): Promise<HouseholdConversion> {
  const native = nativeCurrency.toUpperCase();
  const sel1 = selection1.toUpperCase();
  const sel2 = selection2.toUpperCase();

  const [r1, r2] = await Promise.all([
    resolveSelection(amount, native, sel1, date),
    resolveSelection(amount, native, sel2, date),
  ]);
  return { selection1: r1, selection2: r2 };
}
