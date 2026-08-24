import { describe, it, expect } from "vitest";
import { groupTransactionsByDay } from "../TransactionsList";
import type { DecryptedTxn } from "@/hooks/useTransactions";
import type { Account } from "@/lib/connectors";

function txn(over: Partial<DecryptedTxn>): DecryptedTxn {
  return {
    id: "x",
    date: "2026-08-13",
    amount: 0,
    currency: "USD",
    account_id: null,
    ...over,
  } as unknown as DecryptedTxn;
}

describe("groupTransactionsByDay (DL-1424)", () => {
  it("keeps one subtotal per currency and never adds dollars to bitcoin", () => {
    // The exact production case: five USD subscription charges and one BTC
    // DCA buy on the same day. The old code summed all six into -157.975 and
    // stamped it BTC. 157.97 dollars must never be added to 0.005 bitcoin.
    const items: DecryptedTxn[] = [
      txn({ id: "1", amount: -0.005, currency: "BTC" }),
      txn({ id: "2", amount: -18.0, currency: "USD" }),
      txn({ id: "3", amount: -15.99, currency: "USD" }),
      txn({ id: "4", amount: -9.99, currency: "USD" }),
      txn({ id: "5", amount: -14.99, currency: "USD" }),
      txn({ id: "6", amount: -99.0, currency: "USD" }),
    ];

    const [bucket] = groupTransactionsByDay(items, []);

    expect(bucket.date).toBe("2026-08-13");
    expect(bucket.totals.size).toBe(2);
    expect(bucket.totals.get("BTC")).toBeCloseTo(-0.005, 8);
    expect(bucket.totals.get("USD")).toBeCloseTo(-157.97, 2);
    for (const total of bucket.totals.values()) {
      expect(total).not.toBeCloseTo(-157.975, 3);
    }
  });

  it("falls back to the account currency when a row carries none", () => {
    const accounts = [{ id: "acc-btc", currency: "BTC" }] as unknown as Account[];
    const items = [
      txn({ id: "1", amount: -0.01, currency: undefined, account_id: "acc-btc" }),
    ];

    const [bucket] = groupTransactionsByDay(items, accounts);

    expect(bucket.totals.get("BTC")).toBeCloseTo(-0.01, 8);
  });

  it("splits distinct dates into separate buckets in caller order", () => {
    const items = [
      txn({ id: "1", date: "2026-08-13", amount: -10, currency: "USD" }),
      txn({ id: "2", date: "2026-08-12", amount: -20, currency: "USD" }),
    ];

    const buckets = groupTransactionsByDay(items, []);

    expect(buckets.map((b) => b.date)).toEqual(["2026-08-13", "2026-08-12"]);
  });
});
