/**
 * or-sync request contract tests.
 *
 * WHAT THESE DEFEND. or-sync is the only path that takes the credentials key
 * out of the vault. The behaviour being pinned is that a connection which does
 * not belong on this path never gets that far: no export, no request, no key.
 * With OWM-T0413 the transactions key is removed from the handover entirely:
 * OR returns plaintext row drafts through the orangeway-me sink, and the
 * browser encrypts them before its own database write.
 *
 * WHY THE ASSERTIONS ARE ABOUT ABSENCE. The defect this module exists to make
 * unreachable (OWM-T0530) was not a wrong branch body. Both keys were exported
 * and posted for a private connection, and or-sync then answered 400. A 400 is
 * not a defence: it is raised on the far side, after the body carrying the keys
 * has already left the browser. So "was it rejected" is the wrong question and
 * "did anything leave" is the right one.
 */

import { describe, it, expect, vi } from "vitest";
import {
  requestOrSync,
  OrSyncRouteRefusal,
  OrSyncSinkContractError,
  sinkAndLegacyTransactionsForConnection,
  OR_SYNC_FORMAT,
  type OrSyncConnection,
  type OrSyncHandover,
  type OrSyncResponse,
  type OwmSinkTransactionRow,
} from "../or-sync-request";
import { importOrTransactions } from "@/lib/orImportBridge";

/** A minimal valid sink response for use in test spies. */
const VALID_SINK_RESPONSE: OrSyncResponse = {
  synced: 0,
  connections: [],
  rows: {},
  metadata: { format: OR_SYNC_FORMAT, requires_encryption: [] },
};

/**
 * A handover whose surfaces are all spies, so a test can assert that
 * nothing was called rather than that something else was.
 */
function spyHandover(response: unknown = VALID_SINK_RESPONSE) {
  return {
    exportCredentialsKey: vi.fn(async () => "creds-key-b64"),
    callProxy: vi.fn<(endpoint: string, payload: Record<string, unknown>) => Promise<unknown>>(
      async () => response,
    ),
  } satisfies OrSyncHandover;
}

/** Every call count this module must be able to hold at zero. */
function callCounts(h: ReturnType<typeof spyHandover>) {
  return {
    creds: h.exportCredentialsKey.mock.calls.length,
    proxy: h.callProxy.mock.calls.length,
  };
}

describe("requestOrSync", () => {
  it("sends credentials key and format, but NOT transactions_key", async () => {
    const h = spyHandover({
      synced: 3,
      connections: [{ connection_id: "c1", synced: 3 }],
      rows: {},
      metadata: { format: OR_SYNC_FORMAT, requires_encryption: [] },
    });
    const res = await requestOrSync("sub-1", [{ id: "c1", provider_type: "blink" }], h);

    expect(res.synced).toBe(3);
    expect(h.callProxy).toHaveBeenCalledTimes(1);
    expect(h.callProxy).toHaveBeenCalledWith("or-sync", {
      subaccount_id: "sub-1",
      connection_ids: ["c1"],
      credentials_key: "creds-key-b64",
      format: OR_SYNC_FORMAT,
    });
    // The key distinction: transactions_key must not appear in the payload.
    const payload = h.callProxy.mock.calls[0][1] as Record<string, unknown>;
    expect(payload).not.toHaveProperty("transactions_key");
  });

  it("refuses a private connection without exporting any key", async () => {
    // THE DEFECT, OWM-T0530. This is the assertion the whole module exists
    // for: not that the private handler ran instead, but that nothing left.
    const h = spyHandover();
    await expect(
      requestOrSync("sub-1", [{ id: "c1", is_stealth: true }], h),
    ).rejects.toBeInstanceOf(OrSyncRouteRefusal);
    expect(callCounts(h)).toEqual({ creds: 0, proxy: 0 });
  });

  it("refuses a private connection whatever else the row carries", async () => {
    // The same shapes sync-route.test.ts pins, carried through to the key
    // handover, so a routing rule that stopped agreeing with this function
    // fails here and not only there.
    const privateShapes: OrSyncConnection[] = [
      { id: "a", is_stealth: true },
      { id: "b", is_stealth: true, provider_type: "blink" },
      { id: "c", is_stealth: true, provider_type: "strike" },
      { id: "d", is_stealth: true, provider_type: null },
      { id: "e", is_stealth: true, provider_type: undefined },
    ];
    for (const conn of privateShapes) {
      const h = spyHandover();
      await expect(requestOrSync("sub-1", [conn], h)).rejects.toBeInstanceOf(OrSyncRouteRefusal);
      expect(callCounts(h)).toEqual({ creds: 0, proxy: 0 });
    }
  });

  it("refuses a bank connection without exporting any key", async () => {
    // Bank connections sync through the OPK sealed-box path. They have never
    // been sent here, and this makes that a property of the function rather
    // than of the caller that has always happened to route them away.
    const h = spyHandover();
    await expect(
      requestOrSync("sub-1", [{ id: "c1", provider_type: "quiltt" }], h),
    ).rejects.toBeInstanceOf(OrSyncRouteRefusal);
    expect(callCounts(h)).toEqual({ creds: 0, proxy: 0 });
  });

  it("refuses a whole batch when one member is private, and exports nothing", async () => {
    // The bulk press shape. planSyncAll already holds private connections
    // back, so this is the net under it: one bad member must not carry the
    // keys out on behalf of the good ones. Private is placed LAST on purpose,
    // because a per-item check would have exported for the first two by the
    // time it reached this one.
    const h = spyHandover();
    await expect(
      requestOrSync(
        "sub-1",
        [
          { id: "ok-1", provider_type: "blink" },
          { id: "ok-2", provider_type: "strike" },
          { id: "private-1", is_stealth: true },
        ],
        h,
      ),
    ).rejects.toBeInstanceOf(OrSyncRouteRefusal);
    expect(callCounts(h)).toEqual({ creds: 0, proxy: 0 });
  });

  it("names the route and the connection it refused", async () => {
    // So the console line says why, rather than leaving someone to guess
    // which of several connections in a batch was the bad one.
    const h = spyHandover();
    const err = await requestOrSync("sub-1", [{ id: "c9", is_stealth: true }], h).catch((e) => e);
    expect(err).toBeInstanceOf(OrSyncRouteRefusal);
    expect((err as OrSyncRouteRefusal).route).toBe("private");
    expect((err as OrSyncRouteRefusal).connectionId).toBe("c9");
  });

  it("treats an absent is_stealth as ordinary, and syncs it", async () => {
    // Absent must read as ordinary, never as private. The opposite bug would
    // quietly stop ordinary connections from syncing at all.
    const h = spyHandover();
    await requestOrSync("sub-1", [{ id: "c1" }], h);
    expect(h.callProxy).toHaveBeenCalledTimes(1);
  });

  it("sends nothing and exports nothing for an empty list", async () => {
    // An empty list is not an error, it is nothing to do. Asking or-sync
    // about no connections and interpreting the answer is worse than not
    // asking, and it would still have exported the credentials key to do it.
    const h = spyHandover();
    const res = await requestOrSync("sub-1", [], h);
    expect(res).toEqual({
      synced: 0,
      connections: [],
      rows: {},
      metadata: { format: OR_SYNC_FORMAT, requires_encryption: [] },
    });
    expect(callCounts(h)).toEqual({ creds: 0, proxy: 0 });
  });

  it("cannot be given the kill switch as an input", async () => {
    // Structural, and deliberately not a value assertion. The original defect
    // was `isStealthSyncEnabled() && conn.is_stealth`: the switch decided the
    // PATH, so switching the feature off moved a private connection onto this
    // one. A fourth parameter would read as undefined in every test above and
    // all of them would still pass, so the arity is what gets pinned.
    //
    // If you are here because this failed: the switch does not belong in this
    // function. It decides refuse-or-scan inside handleStealthSync, above that
    // path's own key export. Routing asks only what the connection IS.
    expect(requestOrSync.length).toBe(3);
  });

  it("fails closed when the response does not confirm orangeway-me format", async () => {
    // Sending `format` is only a request; metadata.format in the response is
    // the proof OR took the non-storing branch. A server that answers with a
    // different format must not succeed.
    const h = spyHandover({
      synced: 1,
      connections: [{ connection_id: "c1", synced: 1 }],
      rows: {},
      metadata: { format: "legacy-format", requires_encryption: [] },
    });
    await expect(
      requestOrSync("sub-1", [{ id: "c1", provider_type: "blink" }], h),
    ).rejects.toBeInstanceOf(OrSyncSinkContractError);
  });

  it("fails closed when the response has no metadata at all", async () => {
    // A legacy or-sync response (before sink mode) has no metadata field.
    // This must fail closed rather than accepting the response as a no-rows sync.
    const h = spyHandover({
      synced: 1,
      connections: [{ connection_id: "c1", synced: 1 }],
      rows: {},
    });
    await expect(
      requestOrSync("sub-1", [{ id: "c1", provider_type: "blink" }], h),
    ).rejects.toBeInstanceOf(OrSyncSinkContractError);
  });
});

describe("sinkAndLegacyTransactionsForConnection", () => {
  /** Build a minimal valid sink transaction row for a given connection and id. */
  function makeSinkRow(
    connectionId: string,
    externalId: string,
    amount = "50",
  ): OwmSinkTransactionRow {
    return {
      date: "2024-01-15",
      enc_amount: JSON.stringify({ value: amount, currency: "USD", direction: "in" as const }),
      enc_description: "Test transaction",
      enc_merchant: null,
      _meta: {
        or_connection_id: connectionId,
        external_id: externalId,
        provider_slug: "blink",
        schema_version: "1",
      },
      __resolveAccountId: { or_connection_id: connectionId, or_external_wallet_id: null },
    };
  }

  /** Build a legacy row containing the given transaction as its encrypted payload. */
  function makeLegacyRow(connectionId: string, id: string) {
    return {
      connection_id: connectionId,
      // Identity "decrypt" is used in tests, so the payload is plain JSON.
      encrypted_payload: JSON.stringify({
        id,
        amount: 50,
        currency: "USD",
        direction: "in",
        timestamp: "2024-01-15",
        type: "blink",
        description: null,
        counterparty: null,
        source_wallet_id: null,
      }),
    };
  }

  const identityDecrypt = async (ct: string) => ct;

  it("dedupes a transaction present in both sink and legacy paths by stable id", async () => {
    // A transaction returned by the new sink that is also present in the
    // legacy encrypted_transactions store must appear exactly once.
    const sinkResponse: OrSyncResponse = {
      synced: 1,
      connections: [{ connection_id: "conn-1", synced: 1 }],
      rows: { transactions: [makeSinkRow("conn-1", "stable-ext-id")] },
      metadata: { format: OR_SYNC_FORMAT, requires_encryption: [] },
    };
    const legacyRow = makeLegacyRow("conn-1", "stable-ext-id");

    const result = await sinkAndLegacyTransactionsForConnection(
      sinkResponse,
      "conn-1",
      [legacyRow],
      identityDecrypt,
    );

    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0].id).toBe("stable-ext-id");
    expect(result.legacyFailures).toBe(0);
  });

  it("includes a legacy-only transaction when sink has no match for it", async () => {
    // A transaction present only in the legacy store (not returned by the
    // current sink response) must still be included.
    const legacyRow = makeLegacyRow("conn-1", "legacy-only-id");

    const result = await sinkAndLegacyTransactionsForConnection(
      undefined,
      "conn-1",
      [legacyRow],
      identityDecrypt,
    );

    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0].id).toBe("legacy-only-id");
    expect(result.legacyFailures).toBe(0);
  });

  it("sink transaction wins over legacy when both carry the same id", async () => {
    // The sink path runs first; the legacy path skips any id already seen.
    // This confirms sink-wins-on-conflict, which matters for forward migration.
    const sinkResponse: OrSyncResponse = {
      synced: 1,
      connections: [{ connection_id: "conn-1", synced: 1 }],
      rows: { transactions: [makeSinkRow("conn-1", "shared-id", "99")] },
      metadata: { format: OR_SYNC_FORMAT, requires_encryption: [] },
    };
    const legacyRow = makeLegacyRow("conn-1", "shared-id");

    const result = await sinkAndLegacyTransactionsForConnection(
      sinkResponse,
      "conn-1",
      [legacyRow],
      identityDecrypt,
    );

    expect(result.transactions).toHaveLength(1);
    // The sink row carries amount "99"; legacy carries 50.
    // Sink wins, so the surviving row comes from the sink path.
    expect(result.transactions[0].id).toBe("shared-id");
    expect((result.transactions[0] as { amount?: number }).amount).toBe(99);
    expect(result.legacyFailures).toBe(0);
  });
});

describe("sink path encryption contract", () => {
  it("does not write plaintext amount, description, currency, or merchant to the upsert", async () => {
    // ZKA contract: OR delivers plaintext row drafts through the sink; the
    // browser must encrypt them under the MEK before writing to the OWM
    // database. This test feeds known plaintext values through the full
    // sinkAndLegacyTransactionsForConnection + importOrTransactions pipeline
    // and asserts the upserted row carries ENC() wrappers, never the originals.
    const AMOUNT = "75";
    const DESCRIPTION = "Coffee shop";
    const MERCHANT = "Starbucks";
    const CURRENCY = "USD";

    const sinkResponse: OrSyncResponse = {
      synced: 1,
      connections: [{ connection_id: "conn-1", synced: 1 }],
      rows: {
        transactions: [
          {
            date: "2024-01-15",
            enc_amount: JSON.stringify({ value: AMOUNT, currency: CURRENCY, direction: "in" as const }),
            enc_description: DESCRIPTION,
            enc_merchant: MERCHANT,
            _meta: {
              or_connection_id: "conn-1",
              external_id: "ext-enc-99",
              provider_slug: "blink",
              schema_version: "1",
            },
            __resolveAccountId: { or_connection_id: "conn-1", or_external_wallet_id: "wallet-1" },
          },
        ],
      },
      metadata: { format: OR_SYNC_FORMAT, requires_encryption: [] },
    };

    // Step 1: merge (no legacy rows).
    const { transactions } = await sinkAndLegacyTransactionsForConnection(
      sinkResponse,
      "conn-1",
      [],
      async (ct) => ct,
    );
    expect(transactions).toHaveLength(1);

    // Step 2: import -- capture what lands in the upsert.
    const capturedRows: Array<Record<string, unknown>> = [];
    const mockSupabase = {
      from: (table: string) => {
        if (table === "accounts") {
          return {
            select: () => ({ in: () => Promise.resolve({ data: [], error: null }) }),
          };
        }
        return {
          upsert: (rows: Array<Record<string, unknown>>, _opts?: unknown) => {
            capturedRows.push(...rows);
            return { select: () => Promise.resolve({ data: [], error: null }) };
          },
        };
      },
    };

    await importOrTransactions("conn-1", transactions, {
      supabase: mockSupabase as Parameters<typeof importOrTransactions>[2]["supabase"],
      userId: "user-1",
      encryptText: async (plain) => `ENC(${plain})`,
      resolveAccountIds: (_connId, walletId) => (walletId === "wallet-1" ? ["acct-1"] : []),
    });

    expect(capturedRows).toHaveLength(1);
    const row = capturedRows[0];

    // All sensitive columns must carry the ENC() wrapper -- never raw plaintext.
    expect(row.enc_amount).toMatch(/^ENC\(/);
    expect(row.enc_amount).not.toBe(AMOUNT);
    expect(row.enc_description).toMatch(/^ENC\(/);
    expect(row.enc_description).not.toBe(DESCRIPTION);
    expect(row.enc_currency).toMatch(/^ENC\(/);
    expect(row.enc_currency).not.toBe(CURRENCY);
    expect(row.enc_merchant).toMatch(/^ENC\(/);
    expect(row.enc_merchant).not.toBe(MERCHANT);
  });
});
