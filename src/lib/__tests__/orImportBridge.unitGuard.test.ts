/**
 * @vitest-environment node
 *
 * DL-1424 - the OR import bridge must not corrupt an account's stored balance
 * by crediting an amount whose unit does not match the account's currency.
 *
 * The reported bug: a Bitcoin wallet reports transactions in satoshis
 * (amount_sats), the user keeps the destination account in whole BTC, and the
 * bridge added the raw sats integer to the BTC balance, inflating it by 1e8
 * and rendering the dashboard number wrong.
 *
 * Guard: the row still imports with its own correct enc_currency, but the
 * balance credit (netByAccount) is skipped and counted (unitMismatch) whenever
 * the units provably differ. When they match, the credit lands as before.
 */

import { describe, it, expect } from "vitest";

if (typeof (globalThis as unknown as { window?: unknown }).window === "undefined") {
  (globalThis as unknown as { window: typeof globalThis }).window = globalThis;
}

import { importOrTransactions, type OrImportTransaction } from "@/lib/orImportBridge";

// Fake Supabase client: pretends the unique index inserted every row it was
// handed, so netByAccount reflects exactly what the guard chose to credit.
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

const satsTx: OrImportTransaction = {
  id: "or-sats-1",
  direction: "in",
  type: "deposit",
  amount_sats: 1500,
  description: "Bitcoin deposit",
  counterparty: null,
  timestamp: "2026-05-14T12:00:00Z",
  source_wallet_id: "or-wallet-1",
};

function depsFor(client: unknown, accountCurrency: string | undefined) {
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase: client as any,
    userId: "user-1",
    encryptText: async (s: string) => `enc(${s})`,
    resolveAccountIds: () => ["acct-1"],
    getAccountCurrency: () => accountCurrency,
  };
}

describe("importOrTransactions - DL-1424 balance unit guard", () => {
  it("refuses and counts a sats amount routed into a whole-BTC account", async () => {
    const { client } = makeFakeSupabase();
    const result = await importOrTransactions("conn-1", [satsTx], depsFor(client, "BTC"));

    // The row still lands: it carries its own correct enc_currency.
    expect(result.imported).toBe(1);
    // The mismatched balance credit is refused and counted, never guessed.
    expect(result.unitMismatch).toBe(1);
    expect(result.netByAccount["acct-1"]).toBeUndefined();
  });

  it("credits the balance when a sats amount lands in a sats account", async () => {
    const { client } = makeFakeSupabase();
    const result = await importOrTransactions("conn-1", [satsTx], depsFor(client, "sats"));

    expect(result.imported).toBe(1);
    expect(result.unitMismatch).toBe(0);
    expect(result.netByAccount["acct-1"]).toBe(1500);
  });

  it("credits a whole-BTC decimal amount into a BTC account unchanged", async () => {
    const { client } = makeFakeSupabase();
    const btcTx: OrImportTransaction = {
      id: "or-btc-1",
      direction: "in",
      type: "deposit",
      amount: 0.5,
      currency: "BTC",
      description: "Bitcoin deposit",
      counterparty: null,
      timestamp: "2026-05-14T12:00:00Z",
      source_wallet_id: "or-wallet-1",
    };
    const result = await importOrTransactions("conn-1", [btcTx], depsFor(client, "BTC"));

    expect(result.imported).toBe(1);
    expect(result.unitMismatch).toBe(0);
    expect(result.netByAccount["acct-1"]).toBe(0.5);
  });

  it("still credits when the account currency is unknown (cannot prove a mismatch)", async () => {
    const { client } = makeFakeSupabase();
    const result = await importOrTransactions("conn-1", [satsTx], {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase: client as any,
      userId: "user-1",
      encryptText: async (s: string) => `enc(${s})`,
      resolveAccountIds: () => ["acct-1"],
    });

    expect(result.imported).toBe(1);
    expect(result.unitMismatch).toBe(0);
    expect(result.netByAccount["acct-1"]).toBe(1500);
  });
});
