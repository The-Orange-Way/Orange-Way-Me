/**
 * Ref OWM-T0419, follow-up from OWM-T0164 / PR #443.
 *
 * normalizeErrorCode used to slice the widget's raw error code to 32
 * characters and test the TRUNCATED copy against /^[A-Za-z0-9_]+$/. Base58
 * addresses, xpubs, bech32 address bodies and hex txids are all pure
 * alphanumeric, so any 32-character slice of one passed and was written to
 * stealth_sync_runs.error_code verbatim. The column's CHECK constraint
 * cannot catch this: the truncation happens in the browser, so the value
 * reaching the insert is already short and already legal.
 *
 * Fixed on PR #443: length is now tested first, on the original value, and
 * an over-long value fails closed to the placeholder. This test guards
 * that fix directly against the shipped function.
 *
 * ZKA: every fixture below is a synthetic string, never a real address,
 * xpub or txid.
 */
import { describe, it, expect } from "vitest";
import { normalizeErrorCode } from "../stealthSyncRuns";

const PLACEHOLDER = "UNRECOGNIZED";

describe("normalizeErrorCode", () => {
  it("rejects a 64-character pure-alphanumeric code to the placeholder, not a 32-character prefix", () => {
    // Shape of a real txid: 64 hex-ish alphanumeric characters. Every
    // 32-character prefix of this string is itself a value that would
    // pass /^[A-Za-z0-9_]+$/, which is exactly what made the pre-fix
    // slice-then-test implementation write it through unchanged. A test
    // that only asserted "the result is the placeholder" without also
    // asserting it is NOT the 32-char prefix would have passed against
    // that broken version too, so both assertions are required.
    const longCode = "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2";
    expect(longCode.length).toBe(64);

    const result = normalizeErrorCode(longCode);

    expect(result).toBe(PLACEHOLDER);
    expect(result).not.toBe(longCode.slice(0, 32));
  });

  it("passes a short, valid widget code through unchanged", () => {
    expect(normalizeErrorCode("TIMEOUT")).toBe("TIMEOUT");
    expect(normalizeErrorCode("rate_limited")).toBe("rate_limited");
  });

  it("rejects a short code containing characters outside [A-Za-z0-9_] to the placeholder", () => {
    expect(normalizeErrorCode("bad-code!")).toBe(PLACEHOLDER);
  });

  it("passes null and undefined through as null, not the placeholder", () => {
    expect(normalizeErrorCode(null)).toBeNull();
    expect(normalizeErrorCode(undefined)).toBeNull();
  });

  it("rejects a code exactly one character over the limit", () => {
    const oneOver = "a".repeat(33);
    expect(normalizeErrorCode(oneOver)).toBe(PLACEHOLDER);
  });

  it("accepts a code exactly at the limit", () => {
    const atLimit = "a".repeat(32);
    expect(normalizeErrorCode(atLimit)).toBe(atLimit);
  });
});
