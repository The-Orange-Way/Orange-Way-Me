/**
 * @vitest-environment node
 */
import { describe, it, expect } from "vitest";
import { extractMemoTxid, blockExplorerUrl } from "@/lib/memoTxid";

describe("extractMemoTxid (OWM-T0211)", () => {
  it("extracts the txid when both address and txid lines are present", () => {
    const memo =
      "Address: bc1q00xyzexampleaddress0000000w9k2\n" +
      "Txid: aaaabbbbccccddddeeeeffff00001111222233334444555566667777888899";
    expect(extractMemoTxid(memo)).toBe(
      "aaaabbbbccccddddeeeeffff00001111222233334444555566667777888899",
    );
  });

  it("extracts the txid when it is the only line", () => {
    const memo = "Txid: aaaabbbbccccddddeeeeffff00001111222233334444555566667777888899";
    expect(extractMemoTxid(memo)).toBe(
      "aaaabbbbccccddddeeeeffff00001111222233334444555566667777888899",
    );
  });

  it("returns null when there is no Txid line at all", () => {
    expect(extractMemoTxid("Address: bc1q00xyzexampleaddress0000000w9k2")).toBeNull();
    expect(extractMemoTxid("")).toBeNull();
  });

  it("returns null for a value that is not exactly 64 hex characters", () => {
    // orImportBridge's own test fixtures use short placeholder txids like
    // this one; those must never become a link to a random real transaction.
    expect(extractMemoTxid("Txid: deadbeef00")).toBeNull();
    const tooLong =
      "Txid: aaaabbbbccccddddeeeeffff0000111122223333444455556666777788889900";
    expect(extractMemoTxid(tooLong)).toBeNull();
  });

  it("does not match a non-hex run of 64 characters", () => {
    const memo = "Txid: " + "g".repeat(64);
    expect(extractMemoTxid(memo)).toBeNull();
  });

  it("builds a mempool.space transaction URL", () => {
    const txid = "aaaabbbbccccddddeeeeffff00001111222233334444555566667777888899";
    expect(blockExplorerUrl(txid)).toBe(`https://mempool.space/tx/${txid}`);
  });
});
