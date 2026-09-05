/**
 * OWM-T0153. formatCurrencyPref is what every dashboard tile and goal page
 * calls through useLocaleFormat().formatCurrency. Before this fix it ignored
 * btcDisplayMode entirely for Bitcoin amounts, so the preference set in
 * Settings never reached these call sites (only the accounts list and
 * transaction rows, which call formatCurrencyWithMode directly, honoured it).
 */
import { describe, expect, it } from "vitest";

import { formatCurrencyPref } from "../locale";

describe("formatCurrencyPref — Bitcoin honours btcDisplayMode", () => {
  it("mode=sats renders sats, not the old fixed BTC format", () => {
    expect(formatCurrencyPref(0.05, "BTC", "us", "sats")).toBe("5,000,000 sats");
  });

  it("mode=btc renders 8-decimal BTC", () => {
    expect(formatCurrencyPref(0.05, "BTC", "us", "btc")).toBe("0.05000000 BTC");
  });

  it("mode=btc_easy renders the grouped sats-under-BTC-symbol form", () => {
    expect(formatCurrencyPref(0.05, "BTC", "us", "btc_easy")).toBe("0.05 000 000 BTC");
  });

  it("mode=primary renders the ₿-prefixed sats count", () => {
    expect(formatCurrencyPref(5_000_000, "sats", "us", "primary")).toBe("₿ 5,000,000");
  });

  it("the three modes produce three different strings for the same value", () => {
    const sats = formatCurrencyPref(0.05, "BTC", "us", "sats");
    const btc = formatCurrencyPref(0.05, "BTC", "us", "btc");
    const easy = formatCurrencyPref(0.05, "BTC", "us", "btc_easy");
    expect(new Set([sats, btc, easy]).size).toBe(3);
  });

  it("a sub-0.0001 BTC holding no longer rounds to zero (the value bug, not only the format bug)", () => {
    // The old path (formatCurrencyLocale, 4 decimal places max) rendered
    // this as "BTC0.0000" -- indistinguishable from an empty wallet.
    const out = formatCurrencyPref(0.00001, "BTC", "us", "btc");
    expect(out).toBe("0.00001000 BTC");
    expect(out).not.toContain("0.0000 ");
  });

  it("currency=sats normalizes the same way currency=BTC does", () => {
    expect(formatCurrencyPref(5_000_000, "sats", "us", "sats")).toBe("5,000,000 sats");
  });
});

describe("formatCurrencyPref — non-Bitcoin currencies are unaffected", () => {
  it("routes to the plain locale formatter regardless of btcDisplayMode", () => {
    const viaSats = formatCurrencyPref(1200, "USD", "us", "sats");
    const viaBtc = formatCurrencyPref(1200, "USD", "us", "btc");
    expect(viaSats).toBe(viaBtc);
    expect(viaSats).toBe("$1,200");
  });

  it("still respects an explicit maximumFractionDigits override", () => {
    expect(formatCurrencyPref(1234.56, "USD", "us", "primary", { maximumFractionDigits: 2 })).toBe(
      "$1,234.56",
    );
  });

  it("respects the eu number locale for a non-Bitcoin currency", () => {
    expect(formatCurrencyPref(1200, "EUR", "eu", "btc")).toBe("1.200 €");
  });
});
