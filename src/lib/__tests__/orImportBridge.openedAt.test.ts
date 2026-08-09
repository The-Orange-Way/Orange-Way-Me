/**
 * @vitest-environment node
 *
 * The OR import bridge has to make room for history before it writes it.
 * `accounts.opened_at` is stamped `now()` at creation and migration
 * 20260530000000 rejects any transaction dated before it, so the first
 * sync of a wallet with real history lands nothing unless the opening
 * date is moved back first.
 *
 * These tests pin that behaviour, plus the two failure shapes that must
 * not take the import down with them.
 */

import { describe, it, expect, vi } from "vitest";

if (typeof (globalThis as unknown as { window?: unknown }).window === "undefined") {
  (globalThis as unknown as { window: typeof globalThis }).window = globalThis;
}

import { importOrTransactions, type OrImportTransaction } from "@/lib/orImportBridge";

interface AccountRow {
  id: string;
  opened_at: string | null;
}

/**
 * Fake Supabase client that serves both tables the bridge now touches:
 * an `accounts` read + update, and the `transactions` upsert. Captures
 * the opening-date patches so a test can assert what we tried to write.
 */
function makeFakeSupabase(opts: {
  accounts?: AccountRow[];
  accountsError?: unknown;
  upsertError?: { message: string } | null;
}) {
  const captured = {
    rows: [] as Record<string, unknown>[],
    openedAtPatches: [] as Array<{ id: string; opened_at: unknown }>,
  };
  const client = {
    from(table: string) {
      if (table === "accounts") {
        return {
          select(_cols: string) {
            return {
              in(_col: string, _ids: string[]) {
                return Promise.resolve({
                  data: opts.accountsError ? null : (opts.accounts ?? []),
                  error: opts.accountsError ?? null,
                });
              },
            };
          },
          update(patch: Record<string, unknown>) {
            return {
              eq(_col: string, id: string) {
                captured.openedAtPatches.push({ id, opened_at: patch.opened_at });
                return Promise.resolve({ error: null });
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
              if (opts.upsertError) {
                return Promise.resolve({ error: opts.upsertError, data: null });
              }
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

function tx(id: string, timestamp: string): OrImportTransaction {
  return {
    id,
    direction: "in",
    type: "deposit",
    amount_sats: 150_000,
    description: "Historical receive",
    counterparty: null,
    timestamp,
    source_wallet_id: "or-wallet-1",
  };
}

const baseDeps = {
  userId: "user-1",
  encryptText: async (s: string) => `enc(${s})`,
  resolveAccountIds: () => ["acct-1"],
};

describe("importOrTransactions — account opening dates", () => {
  it("moves the opening date back when the batch is older than the account", async () => {
    const { client, captured } = makeFakeSupabase({
      accounts: [{ id: "acct-1", opened_at: "2026-07-19T09:12:00+00:00" }],
    });

    const result = await importOrTransactions(
      "conn-1",
      [tx("or-tx-1", "2024-03-05T12:00:00Z"), tx("or-tx-2", "2025-01-20T12:00:00Z")],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { ...baseDeps, supabase: client as any },
    );

    // One day of margin below the oldest row in the batch.
    expect(captured.openedAtPatches).toEqual([{ id: "acct-1", opened_at: "2024-03-04" }]);
    expect(result.openedAtRepairs).toEqual([
      { accountId: "acct-1", from: "2026-07-19", to: "2024-03-04" },
    ]);
    expect(result.imported).toBe(2);
    expect(captured.rows).toHaveLength(2);
  });

  it("leaves an account alone when it already opens early enough", async () => {
    const { client, captured } = makeFakeSupabase({
      accounts: [{ id: "acct-1", opened_at: "2020-01-01T00:00:00+00:00" }],
    });

    const result = await importOrTransactions(
      "conn-1",
      [tx("or-tx-1", "2024-03-05T12:00:00Z")],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { ...baseDeps, supabase: client as any },
    );

    expect(captured.openedAtPatches).toEqual([]);
    expect(result.openedAtRepairs).toEqual([]);
    expect(result.imported).toBe(1);
  });

  it("still imports when the accounts read fails", async () => {
    const { client, captured } = makeFakeSupabase({
      accountsError: { message: "permission denied for table accounts" },
    });

    const result = await importOrTransactions(
      "conn-1",
      [tx("or-tx-1", "2024-03-05T12:00:00Z")],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { ...baseDeps, supabase: client as any },
    );

    expect(result.openedAtRepairs).toEqual([]);
    expect(captured.rows).toHaveLength(1);
    expect(result.imported).toBe(1);
  });

  it("names an invariant rejection instead of folding it into generic errors", async () => {
    const onError = vi.fn();
    const { client } = makeFakeSupabase({
      accounts: [{ id: "acct-1", opened_at: "2020-01-01T00:00:00+00:00" }],
      upsertError: {
        message:
          "Transaction date 2024-03-05 is before account opened_at 2026-07-19. " +
          "Set the account opening date earlier to import this history.",
      },
    });

    const result = await importOrTransactions(
      "conn-1",
      [tx("or-tx-1", "2024-03-05T12:00:00Z")],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { ...baseDeps, supabase: client as any, onError },
    );

    expect(result.blockedByOpeningDate).toBe(1);
    expect(result.errored).toBe(1);
    expect(result.imported).toBe(0);
    expect(onError).toHaveBeenCalled();
  });

  it("stamps the household signature fields on the opening-date update", async () => {
    const { client, captured } = makeFakeSupabase({
      accounts: [{ id: "acct-1", opened_at: "2026-07-19T09:12:00+00:00" }],
    });
    const sigStub = vi.fn(() => ({
      household_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      signature_b64: "stub-sig",
      signature_key_version: 1,
    }));

    await importOrTransactions(
      "conn-1",
      [tx("or-tx-1", "2024-03-05T12:00:00Z")],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { ...baseDeps, supabase: client as any, buildSignatureFields: sigStub },
    );

    // Called for the transaction rows and again for the account update.
    expect(sigStub).toHaveBeenCalledTimes(2);
    expect(captured.openedAtPatches).toHaveLength(1);
  });
});
