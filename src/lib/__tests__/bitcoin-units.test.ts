import { describe, expect, it } from "vitest";
import { normalizeBitcoinToSats } from "../bitcoin-units";
import { convert } from "../fx-rates";

describe("normalizeBitcoinToSats", () => {
  it("returns sats unchanged when currency is sats", () => {
    expect(normalizeBitcoinToSats(1453244, "sats")).toBe(1453244);
    expect(normalizeBitcoinToSats(0, "sats")).toBe(0);
    expect(normalizeBitcoinToSats(1, "sats")).toBe(1);
  });

  it("converts decimal BTC to sats", () => {
    expect(normalizeBitcoinToSats(0.01453244, "BTC")).toBe(1453244);
    expect(normalizeBitcoinToSats(0.00000001, "BTC")).toBe(1);
    expect(normalizeBitcoinToSats(0.5, "BTC")).toBe(50_000_000);
  });

  it("leaves whole-integer BTC amounts unchanged (they are already sats)", () => {
    // The bug case: 1453244 stored with currency=BTC is really sats from OR/Blink.
    // Without normalisation, convert() multiplied by $65k/BTC -> ~$94B.
    expect(normalizeBitcoinToSats(1453244, "BTC")).toBe(1453244);
    expect(normalizeBitcoinToSats(5_000_000, "BTC")).toBe(5_000_000);
    expect(normalizeBitcoinToSats(1, "BTC")).toBe(1);
  });

  it("rounds fractional sats cleanly", () => {
    expect(normalizeBitcoinToSats(0.123456789, "BTC")).toBe(12_345_679);
  });
});

describe("convert -- whole-integer BTC normalisation", () => {
  it("does not treat a whole-integer BTC amount as face-value bitcoin", () => {
    // 1453244 with currency=BTC is 1,453,244 sats (~0.01453244 BTC, ~$944).
    // Before fix: 1453244 * $65000/BTC = ~$94.5B.
    const usd = convert(1453244, "BTC", "USD");
    expect(usd).toBeLessThan(10_000_000); // not $94B
    // Must match the decimal-BTC path within $1 (rounding only)
    const usdFromDecimal = convert(0.01453244, "BTC", "USD");
    expect(Math.abs(usd - usdFromDecimal)).toBeLessThan(1);
  });

  it("handles decimal BTC correctly (static rate: 0.01453244 BTC ~= $944.61)", () => {
    const usd = convert(0.01453244, "BTC", "USD");
    expect(usd).toBeCloseTo(944.61, 0);
  });

  it("leaves sats-labelled amounts unchanged", () => {
    const usdFromSats = convert(1453244, "sats", "USD");
    const usdFromBtc = convert(1453244, "BTC", "USD");
    expect(Math.abs(usdFromSats - usdFromBtc)).toBeLessThan(1);
  });

  it("round-trips BTC -> sats -> BTC", () => {
    const sats = convert(0.01453244, "BTC", "sats");
    expect(sats).toBeCloseTo(1_453_244, -1);
  });
});
