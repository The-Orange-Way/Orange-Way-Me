/**
 * @vitest-environment node
 *
 * Phase 4.4 — verifies the OR → Personal import bridge stamps the
 * household-scope + ML-DSA-65 signature trio on every row when the
 * caller supplies `buildSignatureFields`.
 *
 * This is the only write path outside the standard React hooks (it's
 * called from ConnectionsPage at OR-sync time) so it gets its own
 * focused test rather than riding on the row-signing.test.ts contract.
 */

import { describe, it, expect, vi } from "vitest";

if (typeof (globalThis as unknown as { window?: unknown }).window === "undefined") {
  (globalThis as unknown as { window: typeof globalThis }).window = globalThis;
}

import { importOrTransactions, type OrImportTransaction } from "@/lib/orImportBridge";

// ── Fake Supabase client ───────────────────────────────────────────────────
// Captures the upsert payload so the test can assert what landed on the wire.
function makeFakeSupabase() {
  const captured: { rows: Record<string, unknown>[] } = { rows: [] };
  const client = {
    from(_table: string) {
      return {
        upsert(rows: Record<string, unknown>[]) {
          captured.rows = rows;
          return {
            select(_cols: string) {
              return Promise.resolve({
                error: null,
                // Pretend the unique index returned one inserted row.
                data: rows.map((r) => ({
                  id: "row-" + (r.external_id as string),
                  account_id: r.account_id as string,
                  external_id: r.external_id as string,
                })),
              });
            },
          };
        },
      };
    },
  };
  return { client, captured };
}

const HOUSEHOLD_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

const tx: OrImportTransaction = {
  id: "or-tx-1",
  direction: "in",
  type: "deposit",
  amount: 12.5,
  currency: "USD",
  description: "Test deposit",
  counterparty: null,
  timestamp: "2026-05-14T12:00:00Z",
  source_wallet_id: "or-wallet-1",
};

describe("importOrTransactions — Phase 4.4 signature wiring", () => {
  it("stamps household_id + signature columns when buildSignatureFields is supplied", async () => {
    const { client, captured } = makeFakeSupabase();
    const sigStub = vi.fn(() => ({
      household_id: HOUSEHOLD_ID,
      signature_b64: "stub-sig",
      signature_key_version: 1,
    }));

    const result = await importOrTransactions("conn-1", [tx], {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase: client as any,
      userId: "user-1",
      encryptText: async (s: string) => `enc(${s})`,
      resolveAccountIds: () => ["acct-1"],
      buildSignatureFields: sigStub,
    });

    expect(result.imported).toBe(1);
    expect(captured.rows).toHaveLength(1);
    expect(captured.rows[0]).toMatchObject({
      household_id: HOUSEHOLD_ID,
      signature_b64: "stub-sig",
      signature_key_version: 1,
      external_id: "or-tx-1",
    });
    expect(sigStub).toHaveBeenCalled();
  });

  it("omits signature columns when buildSignatureFields is absent (solo user)", async () => {
    const { client, captured } = makeFakeSupabase();

    await importOrTransactions("conn-1", [tx], {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase: client as any,
      userId: "user-1",
      encryptText: async (s: string) => `enc(${s})`,
      resolveAccountIds: () => ["acct-1"],
    });

    expect(captured.rows).toHaveLength(1);
    const row = captured.rows[0];
    expect(row.household_id).toBeUndefined();
    expect(row.signature_b64).toBeUndefined();
    expect(row.signature_key_version).toBeUndefined();
  });

  it("propagates all-NULL fields when caller has no active household", async () => {
    const { client, captured } = makeFakeSupabase();
    const sigStub = vi.fn(() => ({
      household_id: null,
      signature_b64: null,
      signature_key_version: null,
    }));

    await importOrTransactions("conn-1", [tx], {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase: client as any,
      userId: "user-1",
      encryptText: async (s: string) => `enc(${s})`,
      resolveAccountIds: () => ["acct-1"],
      buildSignatureFields: sigStub,
    });

    expect(captured.rows[0]).toMatchObject({
      household_id: null,
      signature_b64: null,
      signature_key_version: null,
    });
  });
});
