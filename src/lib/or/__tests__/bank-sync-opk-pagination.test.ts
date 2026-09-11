/**
 * syncQuilttConnection must page through or-transactions-list instead of
 * treating one call's response as the whole connection history
 * (OWM-T0726) — the same silent-truncation shape OWM-T0722 fixed on the
 * vault-MEK import path.
 *
 * opkSealOpen and importOrTransactions are mocked out on purpose: this
 * test is only about how many rows reach the import step, not about
 * unsealing (covered by opk.test.ts) or writing to Supabase (covered by
 * orImportBridge's own tests).
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/or/opk", () => ({
  // The fake rows below put the JSON payload straight in encrypted_payload,
  // so "opening" it is the identity function.
  opkSealOpen: vi.fn(async (sealedB64: string) => sealedB64),
  OPK_ALG: "libsodium-crypto_box_seal-v1",
}));

vi.mock("@/lib/orImportBridge", () => ({
  importOrTransactions: vi.fn(async (_connectionId: string, txs: unknown[]) => ({
    imported: txs.length,
    unmapped: 0,
    untagged: 0,
    errored: 0,
    decryptFailures: 0,
    total: txs.length,
    unmappedWalletIds: [],
    netByAccount: {},
    openedAtRepairs: [],
    blockedByOpeningDate: 0,
  })),
}));

import { syncQuilttConnection } from "../bank-sync-opk";
import { importOrTransactions } from "@/lib/orImportBridge";
import type { OpkKeypair } from "../opk";

const KEYPAIR: OpkKeypair = {
  publicKeyB64: "unused-in-this-test",
  publicKey: new Uint8Array(32),
  secretKey: new Uint8Array(32),
};

const CONNECTION_ID = "conn-1";
const BASE_MS = Date.parse("2026-01-01T00:00:00Z");

function makeRow(id: string, occurredAtMs: number) {
  return {
    id,
    connection_id: CONNECTION_ID,
    external_id: id,
    encrypted_payload: JSON.stringify({
      amount: "10.00",
      currency: "USD",
      description: "Test debit",
      entry_type: "DEBIT",
      account_id: "acct-1",
    }),
    occurred_at: new Date(occurredAtMs).toISOString(),
  };
}

/** `count` rows, occurred_at strictly descending as the real endpoint returns. */
function makePage(prefix: string, count: number, startMs: number) {
  return Array.from({ length: count }, (_, i) => makeRow(`${prefix}-${i}`, startMs - i * 1000));
}

describe("syncQuilttConnection pagination", () => {
  it("pages until the store is exhausted instead of stopping at one page of 1000", async () => {
    // Two full (1000-row) pages look like "may be more" under
    // nextTransactionsPage's contract: an untruncated page exactly at the
    // requested limit is not proof the store is empty below it. A final
    // short page is the only thing that stops the walk.
    const page1 = makePage("p1", 1000, BASE_MS);
    const page2 = makePage("p2", 1000, BASE_MS - 2_000_000);
    const page3 = makePage("p3", 1, BASE_MS - 4_000_000);

    const calls: Array<Record<string, unknown>> = [];
    const callProxy = vi.fn(async (endpoint: string, payload: Record<string, unknown>) => {
      calls.push(payload);
      if (endpoint !== "or-transactions-list") throw new Error(`unexpected endpoint ${endpoint}`);
      if (calls.length === 1) return { transactions: page1 };
      if (calls.length === 2) return { transactions: page2 };
      return { transactions: page3 };
    });

    const result = await syncQuilttConnection({
      callProxy,
      subaccountId: "sub-1",
      connectionId: CONNECTION_ID,
      keypair: KEYPAIR,
      // Only importOrTransactions (mocked above) reads this; syncQuilttConnection
      // just forwards it.
      deps: {} as never,
    });

    // Pre-fix: exactly one call, limit 1000, no cursor, and only page1's 1000
    // rows would ever be seen. Post-fix: the loop keeps going until a short
    // page proves the store is exhausted.
    expect(calls.length).toBe(3);
    expect(calls[0]).toMatchObject({ subaccount_id: "sub-1", limit: 1000 });
    expect(calls[0]).not.toHaveProperty("before");
    expect(calls[1]).toHaveProperty("before");
    expect(calls[2]).toHaveProperty("before");

    // All 2001 rows across all three pages reached the import step, not just
    // the 1000 from the first call.
    expect(result.total).toBe(2001);
    const importedTxs = vi.mocked(importOrTransactions).mock.calls[0][1] as unknown[];
    expect(importedTxs.length).toBe(2001);
  });

  it("stops after a single short page, the common case for most connections", async () => {
    const onlyPage = makePage("a", 2, BASE_MS);
    const callProxy = vi.fn(async () => ({ transactions: onlyPage }));

    const result = await syncQuilttConnection({
      callProxy,
      subaccountId: "sub-1",
      connectionId: CONNECTION_ID,
      keypair: KEYPAIR,
      deps: {} as never,
    });

    expect(callProxy).toHaveBeenCalledTimes(1);
    expect(result.total).toBe(2);
  });

  it("filters to the requested connection after collecting every page", async () => {
    const mixed = [
      makeRow("mine-1", BASE_MS),
      { ...makeRow("theirs-1", BASE_MS - 1000), connection_id: "other-conn" },
    ];
    const callProxy = vi.fn(async () => ({ transactions: mixed }));

    const result = await syncQuilttConnection({
      callProxy,
      subaccountId: "sub-1",
      connectionId: CONNECTION_ID,
      keypair: KEYPAIR,
      deps: {} as never,
    });

    expect(result.total).toBe(1);
  });
});
