/**
 * Paging decision for `or-transactions-list` (OWM-T0722).
 *
 * The endpoint does not carry a `hasMore` flag the way
 * `or-stealth-transactions-list` does. Reading it directly
 * (`Orange-The-World/orangerails` `supabase/functions/or-transactions-list`):
 * `truncated` / `next_before` fire ONLY when a single page overflows OR's
 * response byte cap (a safety valve for very large ciphertext blobs), never
 * because more rows exist below the requested `limit`. So a page that comes
 * back exactly `limit` rows long, untruncated, is not proof the store is
 * exhausted -- it is the one case this endpoint gives no direct signal for.
 *
 * This function is the single place that reconciles the two possible
 * signals into one answer: keep paging, or stop.
 *
 *   - `truncated && next_before`: OR cut the response short. Resume from
 *     the cursor it gave us.
 *   - a full, untruncated page (`rows.length === requestedLimit`): may not
 *     be everything. Resume from the oldest row's `occurred_at`, since rows
 *     arrive ordered `occurred_at desc`.
 *   - anything shorter: the store had no more to give, stop.
 *
 * Known gap this cannot close: OR's cursor is `occurred_at`, and the
 * endpoint does not document that column as unique. Its query is
 * `occurred_at < before` (strictly less than), so two rows sharing the
 * exact same timestamp at a page boundary could see the later one dropped.
 * That is an upstream contract limitation, not a bug in this loop.
 */

export interface TransactionRow {
  id: string;
  connection_id: string;
  external_id: string;
  encrypted_payload: string;
  occurred_at: string;
}

export interface TransactionsPage {
  rows: TransactionRow[];
  hasMore: boolean;
  nextBefore: string | null;
}

function isTransactionRow(value: unknown): value is TransactionRow {
  if (!value || typeof value !== "object") return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r.id === "string" &&
    typeof r.connection_id === "string" &&
    typeof r.external_id === "string" &&
    typeof r.encrypted_payload === "string" &&
    typeof r.occurred_at === "string"
  );
}

/**
 * Read one `or-transactions-list` response and decide whether another page
 * is needed. `requestedLimit` must be the exact `limit` sent on the request
 * that produced `response` -- it is the only way to tell a full page (may
 * not be everything) from a short one (nothing left), since this endpoint's
 * own `truncated` flag does not cover that case.
 *
 * Returns an empty, non-paging page for a null, non-object, or malformed
 * response rather than throwing: a read that cannot be understood must not
 * be reported as "no transactions", and it must not spin the caller into a
 * retry loop either.
 *
 * A malformed row is dropped rather than propagated, matching
 * `orRowsForConnection`'s existing behaviour for this same wire shape.
 */
export function nextTransactionsPage(response: unknown, requestedLimit: number): TransactionsPage {
  const empty: TransactionsPage = { rows: [], hasMore: false, nextBefore: null };
  if (!response || typeof response !== "object") return empty;
  const body = response as Record<string, unknown>;
  const rawRows = Array.isArray(body.transactions) ? body.transactions : [];
  const rows = rawRows.filter(isTransactionRow);

  const truncated = body.truncated === true;
  const bodyNextBefore = typeof body.next_before === "string" ? body.next_before : null;
  if (truncated && bodyNextBefore) {
    return { rows, hasMore: true, nextBefore: bodyNextBefore };
  }

  if (rows.length === 0 || rows.length < requestedLimit) {
    return { rows, hasMore: false, nextBefore: null };
  }

  // Full page, not byte-truncated by OR: there may be more below it. Rows
  // arrive ordered occurred_at desc, so the last row is the oldest.
  const oldest = rows[rows.length - 1].occurred_at;
  return { rows, hasMore: true, nextBefore: oldest };
}
