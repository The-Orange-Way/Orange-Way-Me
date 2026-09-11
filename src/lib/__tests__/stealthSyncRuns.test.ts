import { describe, expect, it } from "vitest";
import { normalizeErrorCode } from "../stealthSyncRuns";

describe("normalizeErrorCode", () => {
  it("rejects a 64-character alphanumeric value instead of truncating it", () => {
    const syntheticTxidShapedCode = "A".repeat(64);

    const normalized = normalizeErrorCode(syntheticTxidShapedCode);

    expect(normalized).toBe("UNRECOGNIZED");
    expect(normalized).not.toBe(syntheticTxidShapedCode.slice(0, 32));
  });
});
