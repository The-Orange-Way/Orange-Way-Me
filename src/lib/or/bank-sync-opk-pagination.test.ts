/**
 * fetchAllQuilttRows pagination (OWM-T0726).
 *
 * WHAT THIS DEFENDS. syncQuilttConnection used to call or-transactions-list
 * exactly once with limit:1000 and treat whatever came back as the whole
 * store, the same silent-truncation shape OWM-T0722 fixed on the sibling
 * non-stealth import path. This pins the fix: a subaccount whose Quiltt-fed
 * store holds more rows than fit in one page must have every row surfaced,
 * driven purely by the endpoint's own truncated/next_before signal and the
 * full-page-may-have-more rule (see transactions-page.ts for why a full,
 * untruncated page is not proof the store is exhausted).
 *
 * A malformed or under-length row here does NOT get dropped (unlike
 * nextTransactionsPage's isTransactionRow filter): this endpoint's own
 * EncryptedTxRow type allows external_id: string | null, and this test
 * makes sure a null external_id row still comes through.
 */

import { describe, it, expect } from "vitest";
import { fetchAllQuilttRows } from "./bank-sync-opk";

interface FakeRow {
  id: string;
  connection_id: string;
  external_id: string | null;
  encrypted_payload: string;
  occurred_at: string;
}

function makeRows(count: number, startAt = 0): FakeRow[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `row-${startAt + i}`,
    connection_id: "conn-1",
    external_id: startAt + i === 0 ? null : `ext-${startAt + i}`,
    encrypted_payload: "sealed",
    occurred_at: new Date(2026, 0, 1, 0, 0, startAt + count - i).toISOString(),
  }));
}

describe("fetchAllQuilttRows", () => {
  it("stops after one call when the store fits in a single page", async () => {
    const page = makeRows(3);
    let calls = 0;
    const callProxy = async () => {
      calls += 1;
      return { transactions: page, truncated: false };
    };
    const rows = await fetchAllQuilttRows(callProxy, "sub-1");
    expect(calls).toBe(1);
    expect(rows.length).toBe(3);
  });

  it("pages until a short response signals the store is exhausted", async () => {
    // 1000 (full page) + 1000 (full page) + 400 (short, stop).
    const firstPage = makeRows(1000, 2000);
    const secondPage = makeRows(1000, 1000);
    const thirdPage = makeRows(400, 0);
    const responses = [firstPage, secondPage, thirdPage];
    let calls = 0;
    const seenBefore: (string | undefined)[] = [];
    const callProxy = async (_endpoint: string, payload: Record<string, unknown>) => {
      seenBefore.push(payload.before as string | undefined);
      const page = responses[calls];
      calls += 1;
      return { transactions: page, truncated: false };
    };
    const rows = await fetchAllQuilttRows(callProxy, "sub-1");
    expect(
      calls,
      "fetchAllQuilttRows stopped before reading every page: the fix must keep " +
        "requesting while a full, untruncated page comes back, not just once.",
    ).toBe(3);
    expect(
      rows.length,
      "fetchAllQuilttRows dropped rows across pages instead of accumulating all of them.",
    ).toBe(2400);
    expect(seenBefore[0]).toBeUndefined();
    expect(seenBefore[1]).toBeDefined();
    expect(seenBefore[2]).toBeDefined();
  });

  it("keeps a row with a null external_id, unlike the stricter TransactionRow filter", async () => {
    const page = makeRows(2);
    expect(page[0].external_id).toBeNull();
    const callProxy = async () => ({ transactions: page, truncated: false });
    const rows = await fetchAllQuilttRows(callProxy, "sub-1");
    expect(rows.length).toBe(2);
    expect(rows.some((r) => r.external_id === null)).toBe(true);
  });

  it("resumes from the byte-truncated cursor when OR reports truncated", async () => {
    let calls = 0;
    const callProxy = async () => {
      calls += 1;
      if (calls === 1) {
        return { transactions: makeRows(50), truncated: true, next_before: "cursor-1" };
      }
      return { transactions: makeRows(10, 50), truncated: false };
    };
    const rows = await fetchAllQuilttRows(callProxy, "sub-1");
    expect(calls).toBe(2);
    expect(rows.length).toBe(60);
  });

  it("stops and warns rather than looping forever when callProxy throws", async () => {
    const callProxy = async () => {
      throw new Error("network down");
    };
    const rows = await fetchAllQuilttRows(callProxy, "sub-1");
    expect(rows.length).toBe(0);
  });
});
