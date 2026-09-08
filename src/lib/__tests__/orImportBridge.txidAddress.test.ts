/**
 * @vitest-environment node
 *
 * OWM-T0211. Every stealth Bitcoin row rendered as "Imported transaction"
 * with no address and no usable id, even though both are already sitting
 * decrypted in the browser as part of the sealed NormalizedTransaction
 * payload. These tests pin the fix: a direction+address description, the
 * full address and real txid landing in enc_memo, and every existing
 * fallback (description, counterparty, type, blank) staying exactly as it
 * was for rows that carry none of the new fields.
 */

import { describe, it, expect } from "vitest";

if (typeof (globalThis as unknown as { window?: unknown }).window === "undefined") {
  (globalThis as unknown as { window: typeof globalThis }).window = globalThis;
}

import { importOrTransactions, type OrImportTransaction } from "@/lib/orImportBridge";

/**
 * Fake Supabase client matching the shape used by
 * orImportBridge.openedAt.test.ts: serves the `accounts` read (empty, so the
 * opening-date widening path is a no-op) and the `transactions` upsert.
 * Captures the rows so assertions can inspect the encrypted fields the
 * bridge built.
 */
function makeFakeSupabase() {
  const captured = { rows: [] as Record<string, unknown>[] };
  const client = {
    from(table: string) {
      if (table === "accounts") {
        return {
          select(_cols: string) {
            return {
              in(_col: string, _ids: string[]) {
                return Promise.resolve({ data: [], error: null });
              },
            };
          },
        };
      }
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

const baseDeps = {
  userId: "user-1",
  // Identity-ish stub matching the repo's existing test convention
  // (orImportBridge.openedAt.test.ts): wraps the plaintext so assertions can
  // read straight through it without a real vault.
  encryptText: async (s: string) => `enc(${s})`,
  resolveAccountIds: () => ["acct-1"],
};

function baseTx(overrides: Partial<OrImportTransaction>): OrImportTransaction {
  return {
    id: "blind-index-1",
    direction: "in",
    type: "deposit",
    amount_sats: 150_000,
    description: null,
    counterparty: null,
    timestamp: "2026-08-01T12:00:00Z",
    source_wallet_id: "or-wallet-1",
    ...overrides,
  };
}

describe("orImportBridge, Bitcoin txid/address (OWM-T0211)", () => {
  it("builds a direction+address description when description and counterparty are absent", async () => {
    const { client, captured } = makeFakeSupabase();
    await importOrTransactions(
      "conn-1",
      [baseTx({ direction: "in", address: "bc1q00xyzexampleaddress0000000w9k2" })],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { ...baseDeps, supabase: client as any },
    );
    expect(captured.rows[0].enc_description).toBe("enc(Received to bc1q00...w9k2)");
  });

  it("says 'Sent from' for an outbound direction", async () => {
    const { client, captured } = makeFakeSupabase();
    await importOrTransactions(
      "conn-1",
      [baseTx({ direction: "out", address: "bc1q00xyzexampleaddress0000000w9k2" })],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { ...baseDeps, supabase: client as any },
    );
    expect(captured.rows[0].enc_description).toBe("enc(Sent from bc1q00...w9k2)");
  });

  it("still prefers an OR-supplied description over address", async () => {
    const { client, captured } = makeFakeSupabase();
    await importOrTransactions(
      "conn-1",
      [
        baseTx({
          description: "Lightning invoice from alice@example.com",
          address: "bc1q00xyzexampleaddress0000000w9k2",
        }),
      ],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { ...baseDeps, supabase: client as any },
    );
    expect(captured.rows[0].enc_description).toBe("enc(Lightning invoice from alice@example.com)");
  });

  it("still falls back to the type label, then the placeholder, when there is no address either", async () => {
    const { client, captured } = makeFakeSupabase();
    await importOrTransactions(
      "conn-1",
      [baseTx({ type: "deposit" }), baseTx({ id: "blind-index-2", type: "" })],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { ...baseDeps, supabase: client as any },
    );
    expect(captured.rows[0].enc_description).toBe("enc(Deposit)");
    expect(captured.rows[1].enc_description).toBe("enc(Imported transaction)");
  });

  it("carries the full address and real txid into enc_memo, unchanged by truncation", async () => {
    const { client, captured } = makeFakeSupabase();
    await importOrTransactions(
      "conn-1",
      [
        baseTx({
          address: "bc1q00xyzexampleaddress0000000w9k2",
          txid: "aaaabbbbccccddddeeeeffff00001111222233334444555566667777888899",
        }),
      ],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { ...baseDeps, supabase: client as any },
    );
    expect(captured.rows[0].enc_memo).toBe(
      "enc(Address: bc1q00xyzexampleaddress0000000w9k2\n" +
        "Txid: aaaabbbbccccddddeeeeffff00001111222233334444555566667777888899)",
    );
  });

  it("leaves enc_memo null when neither address nor txid is present, exactly as before this change", async () => {
    const { client, captured } = makeFakeSupabase();
    await importOrTransactions(
      "conn-1",
      [baseTx({})],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { ...baseDeps, supabase: client as any },
    );
    expect(captured.rows[0].enc_memo).toBeNull();
  });

  it("writes only the txid line when address is absent but txid is present", async () => {
    const { client, captured } = makeFakeSupabase();
    await importOrTransactions(
      "conn-1",
      [baseTx({ txid: "deadbeef00" })],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { ...baseDeps, supabase: client as any },
    );
    expect(captured.rows[0].enc_memo).toBe("enc(Txid: deadbeef00)");
  });

  it("never writes address or txid into any plaintext column", async () => {
    const { client, captured } = makeFakeSupabase();
    await importOrTransactions(
      "conn-1",
      [
        baseTx({
          address: "bc1q00xyzexampleaddress0000000w9k2",
          txid: "aaaabbbbccccddddeeeeffff0000111122223333",
        }),
      ],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { ...baseDeps, supabase: client as any },
    );
    const row = captured.rows[0];
    for (const [key, value] of Object.entries(row)) {
      if (key === "enc_memo" || key === "enc_description") continue;
      if (typeof value === "string") {
        expect(value).not.toContain("bc1q00xyzexampleaddress0000000w9k2");
        expect(value).not.toContain("aaaabbbbccccddddeeeeffff0000111122223333");
      }
    }
  });
});
