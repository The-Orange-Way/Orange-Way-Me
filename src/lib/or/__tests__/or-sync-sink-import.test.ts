/**
 * @vitest-environment node
 *
 * OWM-T0413 sink-to-ledger contract. These tests cross the response adapter
 * and the real import bridge so a plaintext draft can only reach the fake DB
 * after every sensitive field has passed through vault encryption.
 */

import { describe, expect, it, vi } from "vitest";

if (typeof (globalThis as unknown as { window?: unknown }).window === "undefined") {
  (globalThis as unknown as { window: typeof globalThis }).window = globalThis;
}

import { importOrTransactions } from "@/lib/orImportBridge";
import {
  OR_SYNC_FORMAT,
  sinkAndLegacyTransactionsForConnection,
  sinkTransactionsForConnection,
  type OrSyncResponse,
} from "../or-sync-request";

const sinkResponse: OrSyncResponse = {
  synced: 1,
  connections: [{ connection_id: "conn-1", synced: 1 }],
  rows: {
    transactions: [
      {
        date: "2026-08-30",
        enc_amount: JSON.stringify({ value: "12.5", currency: "USD", direction: "out" }),
        enc_description: "Private coffee description",
        enc_merchant: "Private merchant",
        __resolveAccountId: {
          or_connection_id: "conn-1",
          or_external_wallet_id: "wallet-1",
        },
        _meta: {
          or_connection_id: "conn-1",
          external_id: "provider-tx-1",
          provider_slug: "blink",
          schema_version: "1.0.0",
        },
      },
    ],
  },
  metadata: {
    format: OR_SYNC_FORMAT,
    requires_encryption: [
      "transactions[0].enc_amount",
      "transactions[0].enc_description",
      "transactions[0].enc_merchant",
    ],
  },
};

function fakeSupabase() {
  const stored = new Map<string, Record<string, unknown>>();
  const upsertCalls: Array<{
    rows: Record<string, unknown>[];
    options: Record<string, unknown>;
  }> = [];
  return {
    stored,
    upsertCalls,
    client: {
      from(table: string) {
        if (table === "accounts") {
          return {
            select() {
              return {
                in: async () => ({
                  data: [{ id: "account-1", opened_at: "2020-01-01" }],
                  error: null,
                }),
              };
            },
          };
        }
        if (table !== "transactions") throw new Error(`unexpected table ${table}`);
        return {
          upsert(rows: Record<string, unknown>[], options: Record<string, unknown>) {
            upsertCalls.push({ rows, options });
            const inserted: Record<string, unknown>[] = [];
            for (const row of rows) {
              const key = `${row.user_id}:${row.external_source}:${row.external_id}`;
              if (stored.has(key)) continue;
              stored.set(key, row);
              inserted.push({
                id: `stored-${row.external_id}`,
                account_id: row.account_id,
                external_id: row.external_id,
              });
            }
            return { select: async () => ({ data: inserted, error: null }) };
          },
        };
      },
    },
  };
}

function importDeps(client: unknown) {
  let ciphertextId = 0;
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase: client as any,
    userId: "user-1",
    encryptText: vi.fn(async (_plaintext: string) => `vault-cipher-${++ciphertextId}`),
    resolveAccountIds: () => ["account-1"],
    getAccountCurrency: () => "USD",
  };
}

describe("orangeway-me or-sync sink import", () => {
  it("encrypts the response draft before the database write and preserves date/provenance", async () => {
    const db = fakeSupabase();
    const deps = importDeps(db.client);
    const txs = sinkTransactionsForConnection(sinkResponse, "conn-1");

    const result = await importOrTransactions("conn-1", txs, deps);

    expect(result.imported).toBe(1);
    expect(db.stored.size).toBe(1);
    const stored = Array.from(db.stored.values())[0];
    expect(stored).toMatchObject({
      date: "2026-08-30",
      external_id: "provider-tx-1",
      external_source: "orangerails",
      enc_amount: "vault-cipher-1",
      enc_description: "vault-cipher-2",
      enc_currency: "vault-cipher-3",
      enc_merchant: "vault-cipher-4",
    });
    const persisted = JSON.stringify(stored);
    for (const plaintext of ["Private coffee description", "Private merchant"]) {
      expect(persisted).not.toContain(plaintext);
    }
    expect(db.upsertCalls[0]?.options).toEqual({
      onConflict: "user_id,external_source,external_id",
      ignoreDuplicates: true,
    });
  });

  it("keeps old ORT-encrypted rows readable while preferring the sink copy on overlap", async () => {
    const decryptLegacy = vi.fn(async (ciphertext: string) => {
      if (ciphertext === "old-cipher") {
        return JSON.stringify({
          id: "legacy-tx-1",
          direction: "in",
          type: "deposit",
          amount: 7,
          currency: "USD",
          description: "old row",
          timestamp: "2026-08-29T15:04:00Z",
          source_wallet_id: "wallet-1",
        });
      }
      return JSON.stringify({
        id: "provider-tx-1",
        direction: "in",
        type: "stale-overlap",
        amount: 999,
        timestamp: "2020-01-01",
        source_wallet_id: "wallet-1",
      });
    });

    const result = await sinkAndLegacyTransactionsForConnection(
      sinkResponse,
      "conn-1",
      [
        { connection_id: "conn-1", encrypted_payload: "old-cipher" },
        { connection_id: "conn-1", encrypted_payload: "overlap-cipher" },
      ],
      decryptLegacy,
    );

    expect(result.legacyFailures).toBe(0);
    expect(result.transactions.map((tx) => tx.id)).toEqual(["provider-tx-1", "legacy-tx-1"]);
    expect(result.transactions[0]).toMatchObject({
      amount: 12.5,
      direction: "out",
      timestamp: "2026-08-30",
    });
    expect(result.transactions[1]).toMatchObject({
      amount: 7,
      timestamp: "2026-08-29T15:04:00Z",
    });
  });

  it("creates no duplicate when the same sink transaction is imported twice", async () => {
    const db = fakeSupabase();
    const deps = importDeps(db.client);
    const txs = sinkTransactionsForConnection(sinkResponse, "conn-1");

    const first = await importOrTransactions("conn-1", txs, deps);
    const second = await importOrTransactions("conn-1", txs, deps);

    expect(first.imported).toBe(1);
    expect(second.imported).toBe(0);
    expect(db.stored.size).toBe(1);
    expect(Array.from(db.stored.values())[0]?.date).toBe("2026-08-30");
  });
});
