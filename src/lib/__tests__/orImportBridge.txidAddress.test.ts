/**
 * @vitest-environment node
 *
 * OWM-T0211. Every stealth Bitcoin row rendered as "Imported transaction"
 * with no address and no usable id, even though both are already sitting
 * decrypted in the browser as part of the sealed NormalizedTransaction
 * payload. These tests pin the fix: a direction+address description, the
 * txid fallback when the best-effort address is empty, the full address
 * and real txid landing in enc_memo, the re-sync repair of the exact
 * legacy placeholder, and every existing fallback (description,
 * counterparty, type, blank) staying exactly as it was for rows that
 * carry none of the new fields.
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

  it("names an address-less inbound row by its real txid", async () => {
    const { client, captured } = makeFakeSupabase();
    const txid = "aaaabbbbccccddddeeeeffff00001111222233334444555566667777888899";
    await importOrTransactions(
      "conn-1",
      [baseTx({ txid })],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { ...baseDeps, supabase: client as any },
    );
    expect(captured.rows[0].enc_description).toBe("enc(Received tx aaaabbbb...77888899)");
    expect(captured.rows[0].enc_memo).toBe(`enc(Txid: ${txid})`);
  });

  it("names an address-less outbound row by its real txid", async () => {
    const { client, captured } = makeFakeSupabase();
    await importOrTransactions(
      "conn-1",
      [
        baseTx({
          direction: "out",
          txid: "111122223333444455556666777788889999aaaabbbbccccddddeeeeffff0000",
        }),
      ],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { ...baseDeps, supabase: client as any },
    );
    expect(captured.rows[0].enc_description).toBe("enc(Sent tx 11112222...ffff0000)");
  });

  it("writes only the txid line when address is absent but a short txid is present", async () => {
    const { client, captured } = makeFakeSupabase();
    await importOrTransactions(
      "conn-1",
      [baseTx({ txid: "deadbeef00" })],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { ...baseDeps, supabase: client as any },
    );
    expect(captured.rows[0].enc_description).toBe("enc(Received tx deadbeef00)");
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

  it("repairs a conflicting legacy placeholder without clobbering customer edits", async () => {
    const captured = {
      patches: [] as Array<{ id: string; patch: Record<string, unknown> }>,
      upsertOptions: null as Record<string, unknown> | null,
      lookups: 0,
    };
    const address = "bc1q00xyzexampleaddress0000000w9k2";
    const txid = "aaaabbbbccccddddeeeeffff00001111222233334444555566667777888899";
    const existingRows = [
      {
        id: "ledger-legacy",
        external_id: "blind-index-1",
        enc_description: "enc(Imported transaction)",
        enc_memo: "enc(Customer note)",
      },
      {
        id: "ledger-edited",
        external_id: "blind-index-2",
        enc_description: "enc(My renamed transaction)",
        enc_memo: null,
      },
    ];
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
          upsert(_rows: Record<string, unknown>[], options: Record<string, unknown>) {
            captured.upsertOptions = options;
            return {
              select(_cols: string) {
                // Conflict path: unique index swallowed both rows.
                return Promise.resolve({ data: [], error: null });
              },
            };
          },
          select() {
            const query = {
              eq() {
                return query;
              },
              in() {
                captured.lookups += 1;
                return Promise.resolve({ data: existingRows, error: null });
              },
            };
            return query;
          },
          update(patch: Record<string, unknown>) {
            return {
              eq(_column: string, id: string) {
                captured.patches.push({ id, patch });
                return Promise.resolve({ error: null });
              },
            };
          },
        };
      },
    };

    const unwrap = async (value: string) => value.replace(/^enc\(/, "").replace(/\)$/, "");
    const result = await importOrTransactions(
      "conn-1",
      [
        baseTx({ id: "blind-index-1", address, txid }),
        baseTx({ id: "blind-index-2", address, txid }),
      ],
      {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        supabase: client as any,
        ...baseDeps,
        decryptText: unwrap,
      },
    );

    expect(captured.upsertOptions).toMatchObject({ ignoreDuplicates: true });
    expect(captured.lookups).toBe(1);
    expect(captured.patches).toEqual([
      {
        id: "ledger-legacy",
        patch: {
          enc_description: "enc(Received to bc1q00...w9k2)",
          enc_memo: `enc(Customer note\nAddress: ${address}\nTxid: ${txid})`,
        },
      },
      {
        id: "ledger-edited",
        patch: {
          enc_memo: `enc(Address: ${address}\nTxid: ${txid})`,
        },
      },
    ]);
    expect(result.imported).toBe(0);
    expect(result.errored).toBe(0);
    for (const { patch } of captured.patches) {
      for (const [key, value] of Object.entries(patch)) {
        if (key === "enc_memo" || key === "enc_description") continue;
        if (typeof value === "string") {
          expect(value).not.toContain(address);
          expect(value).not.toContain(txid);
        }
      }
    }
  });

  it("leaves already-imported rows alone when the vault decryptor is not supplied", async () => {
    const captured = { lookups: 0, patches: 0 };
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
          upsert(_rows: Record<string, unknown>[]) {
            return {
              select(_cols: string) {
                return Promise.resolve({ data: [], error: null });
              },
            };
          },
          select() {
            captured.lookups += 1;
            return {
              eq() {
                return this;
              },
              in() {
                return Promise.resolve({ data: [], error: null });
              },
            };
          },
          update() {
            captured.patches += 1;
            return {
              eq() {
                return Promise.resolve({ error: null });
              },
            };
          },
        };
      },
    };

    const result = await importOrTransactions(
      "conn-1",
      [baseTx({ address: "bc1q00xyzexampleaddress0000000w9k2" })],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { ...baseDeps, supabase: client as any },
    );

    expect(captured.lookups).toBe(0);
    expect(captured.patches).toBe(0);
    expect(result.imported).toBe(0);
    expect(result.errored).toBe(0);
  });

  it("re-stamps household signature fields on a legacy repair write", async () => {
    const captured = { patches: [] as Array<{ id: string; patch: Record<string, unknown> }> };
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
          upsert(_rows: Record<string, unknown>[]) {
            return {
              select(_cols: string) {
                return Promise.resolve({ data: [], error: null });
              },
            };
          },
          select() {
            const query = {
              eq() {
                return query;
              },
              in() {
                return Promise.resolve({
                  data: [
                    {
                      id: "ledger-legacy",
                      external_id: "blind-index-1",
                      enc_description: "enc(Imported transaction)",
                      enc_memo: null,
                    },
                  ],
                  error: null,
                });
              },
            };
            return query;
          },
          update(patch: Record<string, unknown>) {
            return {
              eq(_column: string, id: string) {
                captured.patches.push({ id, patch });
                return Promise.resolve({ error: null });
              },
            };
          },
        };
      },
    };

    await importOrTransactions(
      "conn-1",
      [baseTx({ address: "bc1q00xyzexampleaddress0000000w9k2" })],
      {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        supabase: client as any,
        ...baseDeps,
        decryptText: async (value) => value.replace(/^enc\(/, "").replace(/\)$/, ""),
        buildSignatureFields: () => ({
          household_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
          signature_b64: "repair-sig",
          signature_key_version: 1,
        }),
      },
    );

    expect(captured.patches).toHaveLength(1);
    expect(captured.patches[0].patch).toMatchObject({
      household_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      signature_b64: "repair-sig",
      signature_key_version: 1,
    });
  });
});
