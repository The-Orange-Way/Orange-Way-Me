import { describe, expect, it } from "vitest";
import { decryptInBatches } from "../useTransactions";

// Minimal row fixture. Only enc_amount and enc_description are decrypted
// unconditionally; everything else is null-guarded in decryptInBatches.
function row(id: string, enc_amount: string) {
  return {
    id,
    account_id: "acct-1",
    date: "2024-01-01",
    enc_amount,
    enc_currency: null,
    enc_description: "desc",
    enc_merchant: null,
    enc_category_id: null,
    enc_memo: null,
    enc_tags: null,
    is_split_parent: false,
    split_parent_id: null,
    transfer_group_id: null,
    is_manual_category: false,
    updated_at: "2024-01-01T00:00:00Z",
  } as Parameters<typeof decryptInBatches>[0][number];
}

describe("decryptInBatches: failCount", () => {
  it("counts rejected rows and excludes them from items", async () => {
    const BAD = "bad-cipher";
    const decrypt = async (s: string): Promise<string> => {
      if (s === BAD) throw new Error("decrypt failed");
      return s;
    };

    const rows = [row("r1", "100"), row("r2", BAD), row("r3", "200"), row("r4", BAD)];
    const { items, failCount } = await decryptInBatches(rows, decrypt);

    expect(failCount).toBe(2);
    expect(items).toHaveLength(2);
    expect(items.map((t) => t.id)).toEqual(["r1", "r3"]);
  });

  it("reports zero failures when all rows decrypt successfully", async () => {
    const decrypt = async (s: string): Promise<string> => s;
    const rows = [row("r1", "50"), row("r2", "75")];
    const { items, failCount } = await decryptInBatches(rows, decrypt);

    expect(failCount).toBe(0);
    expect(items).toHaveLength(2);
  });
});
