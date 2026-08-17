/**
 * Shared Bitcoin unit helpers used by both the display layer (format.ts)
 * and the FX conversion layer (fx-rates.ts). A single source of truth
 * prevents the two sites from implementing the normalisation differently.
 */

/**
 * Normalise a Bitcoin amount to a sats integer for consistent calculation.
 *
 * BTC is the currency. "Bitcoin" (decimal) and "Satoshi" (integer) are just
 * display formats. But the *stored* amount can be in either unit:
 *   - Manual user entry: typically decimal BTC ("0.05")
 *   - Automated import (OR/Blink): typically integer sats ("1121")
 *
 * Both arrive with currency="BTC" so the label alone cannot disambiguate.
 * Heuristic: a value with a fractional part is decimal BTC (multiply by
 * 1e8); a whole integer >= 1 is already sats (leave it). Nobody enters a
 * whole BTC by typing a bare integer -- they would type "1.00000000".
 */
export function normalizeBitcoinToSats(amount: number, currency: string): number {
  if (currency === "sats") return Math.round(amount);
  // currency === "BTC"
  if (Number.isInteger(amount) && Math.abs(amount) >= 1) {
    return amount; // already sats
  }
  return Math.round(amount * 1e8); // decimal BTC -> sats
}
