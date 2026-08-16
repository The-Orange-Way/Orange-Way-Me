/**
 * Getting stealth-scanned transactions into the local ledger (DL-1116).
 *
 * Two problems live here, both of them ours rather than Orange Rails'.
 *
 * 1. A stealth connection has no source wallet, and that is structural rather
 *    than missing data. `or-connection-list` returns `source_wallets: []` on
 *    every stealth row because the stealth store has no equivalent table.
 *    Everything downstream of a connection in this app is keyed by
 *    (connection, source wallet): `connection_account_map` has
 *    `or_external_wallet_id` in its primary key, the destination picker
 *    iterates wallets, the import bridge routes each row by its
 *    `source_wallet_id`, and the Transactions wallet filter is built from the
 *    accounts that mapping produces. With no wallet, none of that can be
 *    reached: no mapping row can be written, so no account can be linked, so
 *    no imported transaction has anywhere to land, so no stealth wallet ever
 *    appears in the filter. The user sees "No accounts linked" with a tooltip
 *    telling them to reconnect and pick accounts, which is advice they cannot
 *    follow because there is nothing to pick.
 *
 *    A stealth connection is exactly one xpub, which is exactly one wallet, so
 *    the honest fix is to say so: synthesize the single wallet the connection
 *    already is. The connection id is used as the external wallet id because
 *    it is already stored in plaintext in `connection_account_map`, so reusing
 *    it discloses nothing that column does not already hold. Rejected
 *    alternatives are recorded in the PR body.
 *
 * 2. The wire shape for reading stealth rows back is NOT final. Orange Rails
 *    confirmed the root cause on 2026-08-16 (their DL-1174): the widget writes
 *    to the stealth store, and `or-transactions-list` reads a different table
 *    entirely, so it returns zero stealth rows by construction. Their CTO
 *    ruled the fix is additive on the read path and that stealth rows must NOT
 *    be copied into the non-stealth table, because they are sealed under a
 *    different envelope and key and a parallel write would create two sources
 *    of truth. So the rows will arrive either in a separate array or carrying
 *    a per-row source tag, and NOT as extra entries in `transactions`.
 *
 *    Nothing in this app should encode a guess about which. `orRowsForConnection`
 *    is the single place that touches the response shape, so when DL-1174
 *    lands there is one function to change and no call site to hunt for. It
 *    accepts the shape that exists today plus the separate-array shape, reads
 *    both when both are present, and is deliberately incurious about a source
 *    tag: we select by connection id, which is correct under either design.
 */

/**
 * One sealed row as `or-transactions-list` returns it. Structurally identical
 * to `EncryptedTxRow` in the connections UI; redeclared here so this module
 * stays a leaf with no import back into components.
 */
export interface OrEncryptedRow {
  id: string;
  connection_id: string;
  external_id: string;
  encrypted_payload: string;
  occurred_at: string;
}

/** Shape of the one synthetic wallet, matching `DecryptedWalletForBadges`. */
export interface StealthSourceWallet {
  id: string;
  external_wallet_id: string;
  is_synced: boolean;
  currency: string;
  label?: string | null;
}

/**
 * A stealth connection is a Bitcoin xpub, so its single wallet is BTC. Not
 * read from the connection: there is no currency field on a stealth row to
 * read it from, and inventing a lookup would suggest there is a choice here.
 */
export const STEALTH_WALLET_CURRENCY = "BTC";

/** Shown when the connection has no decryptable label of its own. */
export const STEALTH_WALLET_FALLBACK_LABEL = "Private wallet";

/**
 * The synthetic external wallet id for a stealth connection.
 *
 * Deliberately the connection id itself rather than a derived or prefixed
 * value. A prefix ("stealth:" + id) would be a second identifier to keep in
 * step across `connection_account_map`, the import bridge and any future
 * Orange Rails payload, and the first place the two drifted would silently
 * produce unmapped rows. One identifier cannot drift from itself.
 */
export function stealthSourceWalletId(connectionId: string): string {
  return connectionId;
}

/**
 * Give a stealth connection the one source wallet it structurally is.
 *
 * Non-stealth connections pass through untouched. A stealth connection that
 * somehow already carries wallets also passes through untouched, so that if
 * Orange Rails ever does return real source wallets for the stealth store,
 * theirs win and this synthesis stops happening without a code change here.
 */
export function withStealthSourceWallet(
  conn: { id: string; is_stealth?: boolean; decrypted_label?: string | null },
  wallets: StealthSourceWallet[],
): StealthSourceWallet[] {
  if (!conn.is_stealth) return wallets;
  if (wallets.length > 0) return wallets;
  return [
    {
      id: stealthSourceWalletId(conn.id),
      external_wallet_id: stealthSourceWalletId(conn.id),
      // True because the widget scanned it. A synthetic wallet marked unsynced
      // would be filtered out of the mapping dialog, which is the one place
      // the user needs it to appear.
      is_synced: true,
      currency: STEALTH_WALLET_CURRENCY,
      label: conn.decrypted_label?.trim() || STEALTH_WALLET_FALLBACK_LABEL,
    },
  ];
}

/**
 * Route a decoded transaction from a stealth connection to the synthetic
 * wallet when Orange Rails did not tag it.
 *
 * The import bridge skips any row whose `source_wallet_id` is null and counts
 * it `untagged`, which is correct for a bank connection where a null tag means
 * OR genuinely could not attribute the row. For a stealth connection there is
 * only one wallet it could have come from, so a null tag is not ambiguity, it
 * is an absent field. A tag Orange Rails DOES send is never overwritten.
 */
export function withStealthSourceWalletId<T extends { source_wallet_id: string | null }>(
  row: T,
  connectionId: string,
  isStealth: boolean | undefined,
): T {
  if (!isStealth) return row;
  if (row.source_wallet_id) return row;
  return { ...row, source_wallet_id: stealthSourceWalletId(connectionId) };
}

function isRowArray(value: unknown): value is OrEncryptedRow[] {
  return Array.isArray(value);
}

/**
 * The only place in this app that knows the shape of an `or-transactions-list`
 * response.
 *
 * Reads `transactions` (the shape that exists today) and `stealth_transactions`
 * (the separate-array shape Orange Rails described), takes both when both are
 * present, and de-duplicates by row id so a future response that echoes a row
 * into both arrays cannot double-import it. Unknown top-level keys are
 * ignored rather than guessed at: an array we do not recognise is not
 * evidence that it holds transactions.
 *
 * Returns [] for a null, non-object or malformed response rather than
 * throwing. A read that cannot be understood must not be reported to the user
 * as "no transactions", and the caller distinguishes those two cases; see the
 * call sites in ConnectionsPage.
 */
export function orRowsForConnection(response: unknown, connectionId: string): OrEncryptedRow[] {
  if (!response || typeof response !== "object") return [];
  const body = response as Record<string, unknown>;

  const candidates: OrEncryptedRow[] = [];
  for (const key of ["transactions", "stealth_transactions"] as const) {
    const value = body[key];
    if (isRowArray(value)) candidates.push(...value);
  }

  const seen = new Set<string>();
  const out: OrEncryptedRow[] = [];
  for (const row of candidates) {
    if (!row || typeof row !== "object") continue;
    if (row.connection_id !== connectionId) continue;
    if (typeof row.id === "string") {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
    }
    out.push(row);
  }
  return out;
}
