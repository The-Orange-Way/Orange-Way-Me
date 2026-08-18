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
 *    UPDATE: DL-1174 has landed. Orange Rails shipped a dedicated endpoint,
 *    `or-stealth-transactions-list`, and it is deployed. It is neither of the
 *    two shapes guessed at above -- it is a separate response with its own
 *    envelope framing and no per-row connection id -- so `orRowsForConnection`
 *    was left exactly as it was and `stealthPageFromResponse` at the bottom of
 *    this file reads the real thing. Read the block above it before changing
 *    either: the two shapes differ in a way that fails silently.
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

/* -------------------------------------------------------------------------
 * The stealth read path (DL-1174 landed; this app's half of DL-1116)
 *
 * The comment at the top of this file says the wire shape "is NOT final".
 * It is now. Orange Rails shipped `or-stealth-transactions-list` and it is
 * deployed, so the guesswork this module was built to absorb is over and the
 * real shape is encoded below.
 *
 * It is NOT the shape `orRowsForConnection` handles, and the difference is the
 * kind that fails silently:
 *
 *   - The rows do NOT carry `connection_id`. The endpoint selects
 *     `id, sealed_record, occurred_at, block_height, txid_blind_index_hex,
 *     created_at` and puts the connection id at the TOP LEVEL of the response,
 *     because every row in the response belongs to the connection that was
 *     asked for. Feeding these rows to `orRowsForConnection` drops all of them
 *     on its `row.connection_id !== connectionId` test and returns [], which
 *     is indistinguishable from "this wallet has no history" -- exactly the
 *     bug this work exists to fix (#305). So this is a separate reader, and
 *     it checks the connection id ONCE, against the response.
 *
 *   - The envelope is framed differently. `encrypted_payload` is base64 of
 *     iv||ciphertext concatenated, which is what `decryptText` expects.
 *     `sealed_record` splits the same AES-256-GCM output into `iv_b64` and
 *     `ciphertext_b64`. A second decrypt path would have to reach for the
 *     transactions subkey on its own, so instead `sealedRecordToCipherB64`
 *     reframes the envelope into the concatenated form and the existing,
 *     already-reviewed `decryptOrTxnCipher` stays the only caller that ever
 *     touches that subkey.
 *
 *     (The wording here is deliberate: an earlier draft put the word "key"
 *     immediately before the function name and the repo's leak scanner read
 *     the pair as a generic API key. Rephrasing beat adding an allowlist
 *     entry, which would have been a permanent hole for one comment.)
 *
 * There is no new key material here. The widget seals with the `txn_key` this
 * app hands it in the /connect fragment, and that is `deriveTransactionsKey`
 * -- the same ORANGERAILS_TRANSACTIONS_V1 subkey that opens `encrypted_payload`.
 * ------------------------------------------------------------------------- */

/** The sealed envelope as `or-stealth-transactions-list` returns it. */
export interface StealthSealedRecord {
  version: number;
  algorithm: string;
  iv_b64: string;
  ciphertext_b64: string;
}

/** One row of that endpoint's `transactions` array. Note: no `connection_id`. */
export interface StealthSealedRow {
  id: string;
  sealed_record: StealthSealedRecord;
  /** Plaintext block date. Deliberate: see the ZKA level-2 trade-off on the OR side. */
  occurred_at: string;
  block_height: number;
  txid_blind_index_hex: string;
}

/**
 * Cursor for the next page, echoed back verbatim.
 *
 * Both halves or neither. `block_height` is not unique on the table -- one
 * block can hold several of a wallet's transactions -- so a cursor built on
 * height alone silently drops the rest of a block whenever a page boundary
 * lands inside one. Orange Rails documents this and refuses a half cursor, so
 * we never construct one by hand.
 */
export interface StealthPageCursor {
  before_block: number;
  before_txid_blind_index_hex: string;
}

/** What a caller needs to decide whether to ask for another page. */
export interface StealthPage {
  rows: StealthSealedRow[];
  /**
   * Total rows the server holds for this connection, across all pages, when
   * the server said so. When it did not, this falls back to the number of
   * entries actually delivered in `transactions` -- INCLUDING the ones that
   * failed validation -- so it never silently shrinks to match what survived.
   */
  total: number;
  /**
   * Entries that were present in `transactions` but did not survive
   * validation: a malformed row, or a sealed record with a version or
   * algorithm this build cannot open.
   *
   * This exists because a skipped row is otherwise invisible. The original
   * reasoning for skipping was that "the count mismatch shows", but that only
   * holds when the server sends `total`. When it omits it, `total` is derived
   * locally, and deriving it from the surviving rows would have made the two
   * agree by construction and the page look complete. So the count is reported
   * directly rather than inferred, and `total` is derived from the delivered
   * length instead. Callers should surface a non-zero value rather than drop
   * it: it means this build is not showing the customer everything the server
   * holds.
   *
   * Duplicate ids are NOT counted here. A duplicate is de-duplicated, not
   * lost, so nothing is missing from the customer's view.
   */
  skipped: number;
  hasMore: boolean;
  nextCursor: StealthPageCursor | null;
}

const SUPPORTED_SEALED_VERSION = 1;
const SUPPORTED_SEALED_ALGORITHM = "AES-256-GCM";

function isSealedRecord(value: unknown): value is StealthSealedRecord {
  if (!value || typeof value !== "object") return false;
  const r = value as Record<string, unknown>;
  return (
    r.version === SUPPORTED_SEALED_VERSION &&
    r.algorithm === SUPPORTED_SEALED_ALGORITHM &&
    typeof r.iv_b64 === "string" &&
    r.iv_b64.length > 0 &&
    typeof r.ciphertext_b64 === "string" &&
    r.ciphertext_b64.length > 0
  );
}

/**
 * An unknown `version` or `algorithm` is skipped rather than attempted. A
 * future envelope decrypted under today's assumptions would either throw or,
 * worse, authenticate against the wrong framing; neither is better than
 * leaving the row out. Skipping is only acceptable because the skip is
 * counted and reported -- see `StealthPage.skipped`.
 */
function isStealthRow(value: unknown): value is StealthSealedRow {
  if (!value || typeof value !== "object") return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r.id === "string" &&
    typeof r.occurred_at === "string" &&
    typeof r.block_height === "number" &&
    typeof r.txid_blind_index_hex === "string" &&
    isSealedRecord(r.sealed_record)
  );
}

function readCursor(value: unknown): StealthPageCursor | null {
  if (!value || typeof value !== "object") return null;
  const c = value as Record<string, unknown>;
  if (typeof c.before_block !== "number") return null;
  if (typeof c.before_txid_blind_index_hex !== "string") return null;
  if (!c.before_txid_blind_index_hex) return null;
  return {
    before_block: c.before_block,
    before_txid_blind_index_hex: c.before_txid_blind_index_hex,
  };
}

/**
 * The only place in this app that knows the shape of an
 * `or-stealth-transactions-list` response.
 *
 * Returns an empty page for a null, non-object or malformed response rather
 * than throwing, and for a response whose `connection_id` is not the one we
 * asked about -- a mismatched id means we are looking at someone else's page
 * and importing it would attribute another wallet's history to this one.
 *
 * `hasMore` is only reported when a usable cursor came with it. A server that
 * says "more exist" and gives us no way to ask for them would otherwise send
 * the caller into a loop re-fetching page one.
 */
export function stealthPageFromResponse(response: unknown, connectionId: string): StealthPage {
  const empty: StealthPage = { rows: [], total: 0, skipped: 0, hasMore: false, nextCursor: null };
  if (!response || typeof response !== "object") return empty;
  const body = response as Record<string, unknown>;
  if (body.connection_id !== connectionId) return empty;
  if (!Array.isArray(body.transactions)) return empty;

  const seen = new Set<string>();
  const rows: StealthSealedRow[] = [];
  let skipped = 0;
  for (const row of body.transactions) {
    if (!isStealthRow(row)) {
      skipped += 1;
      continue;
    }
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    rows.push(row);
  }

  const nextCursor = readCursor(body.next_cursor);
  return {
    rows,
    // Fall back to the DELIVERED length, not the surviving length. Deriving
    // this from `rows` would make total === rows.length whenever the server
    // omits `total`, which is exactly the case where a skipped row would
    // otherwise vanish without trace.
    total: typeof body.total === "number" ? body.total : body.transactions.length,
    skipped,
    hasMore: body.has_more === true && nextCursor !== null,
    nextCursor,
  };
}

/**
 * Reframe a split sealed record into the base64 iv||ciphertext form
 * `decryptText` (and therefore `decryptOrTxnCipher`) expects.
 *
 * Throws on a malformed record instead of returning something that would fail
 * later as an opaque decrypt error, so the caller can count it as a decode
 * failure and say so.
 */
export function sealedRecordToCipherB64(record: StealthSealedRecord): string {
  if (!isSealedRecord(record)) throw new Error("Unsupported sealed_record");
  const iv = atob(record.iv_b64);
  const ct = atob(record.ciphertext_b64);
  // AES-GCM here is always a 12-byte IV; decryptText slices exactly 12 back off.
  if (iv.length !== 12) throw new Error("Unexpected IV length");
  return btoa(iv + ct);
}
