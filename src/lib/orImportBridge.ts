/**
 * orImportBridge — Phase 5: convert OR-synced transactions into
 * Personal `transactions` table rows.
 *
 * Design (Personal-specific):
 *   - Pure logic. The caller (ConnectionsPage) supplies the
 *     decrypted OR transactions, the active mapping resolver,
 *     the user id, and the encryption helpers. No React hooks
 *     here so this module stays trivially unit-testable.
 *   - Single-entry transaction model (no double-entry / journal-entry
 *     ledger): each OR tx becomes ONE `transactions` row, written
 *     under the destination account picked via
 *     `connection_account_map`. Direction is encoded as the sign
 *     on the amount ("+1.00" / "-1.00"), matching the convention
 *     `useTransactions.buildEncryptedRow` already uses.
 *   - Idempotency: relies on the unique index idx_transactions_external
 *     on `(user_id, external_source, external_id)`. This index is PLAIN
 *     (no WHERE predicate) by design, and the deployed index matches the
 *     migration history exactly: migration
 *     20260423130000_transactions_external_id.sql first created it partial
 *     (`WHERE external_id IS NOT NULL`), then migration
 *     20260428000000_fix_transactions_external_id_index.sql deliberately
 *     dropped and recreated it plain, because supabase-js cannot infer a
 *     partial index as the ON CONFLICT target (Postgres error 42P10). So
 *     being plain is intentional and load-bearing, not drift. Re-running on
 *     the same OR batch is a no-op: Supabase `upsert`
 *     with `ignoreDuplicates: true` translates to `ON CONFLICT DO NOTHING`
 *     so user edits to imported rows are preserved. Caveat: because the
 *     index is plain, rows with `external_id IS NULL` are all distinct and
 *     are NOT deduplicated by it.
 *   - Unmapped wallets (no active row in connection_account_map
 *     for the OR (connection, source_wallet)) are SKIPPED. They
 *     remain visible in the connection's TransactionList with the
 *     existing "unmapped" badge so the user can route them later
 *     via the Edit mapping dialog and re-sync.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Subset of the decrypted OR transaction payload that the bridge
 * needs. Mirrors the `DecryptedTx` interface in
 * `src/components/connections/TransactionList.tsx` — kept narrow
 * so the bridge has no transitive UI imports.
 */
export interface OrImportTransaction {
  /** OR-issued transaction id — used as the dedup key. */
  id: string;
  direction: "in" | "out";
  type: string;
  /** Bitcoin / Lightning sats integer. Either this or `amount`. */
  amount_sats?: number;
  /** Fiat-style decimal amount (e.g. USD). Either this or `amount_sats`. */
  amount?: number;
  /** ISO currency code or "BTC"/"sats". May be undefined when unknown. */
  currency?: string;
  description?: string | null;
  counterparty?: string | null;
  /** ISO 8601 timestamp. */
  timestamp: string;
  /**
   * The OR source-wallet this transaction came from. Required for
   * mapping resolution; null when OR couldn't tag the row (legacy
   * pre-discovery path) — those rows are always skipped because
   * we have no way to route them.
   */
  source_wallet_id: string | null;
}

/**
 * One account whose opening date was moved back so older imported
 * transactions could land. Both dates are plain YYYY-MM-DD.
 */
export interface OpenedAtRepair {
  accountId: string;
  /** The opening date the account carried before the import. */
  from: string;
  /** The opening date it was moved back to. */
  to: string;
}

/** Plain-language outcome summary for the post-sync toast. */
export interface OrImportResult {
  /** Number of rows whose insert succeeded (or were skipped because
   *  they already existed — the unique index swallows them). */
  imported: number;
  /** Rows skipped because no active mapping points the OR
   *  source_wallet at a Personal account. */
  unmapped: number;
  /** Rows skipped because OR did not stamp a `source_wallet_id`. */
  untagged: number;
  /** Rows that hit a non-fatal error during encryption or insert.
   *  Always logged via the supplied logger; never thrown. */
  errored: number;
  /** Subset of `errored` where the failure originated inside buildRow
   *  (almost always an encryptText throw). Isolates crypto failures
   *  from insert-level errors so the log can pinpoint the root cause. */
  decryptFailures: number;
  /** Total number of OR transactions the caller handed us. */
  total: number;
  /** The unique source-wallet ids whose rows ended up in `unmapped`.
   *  Surfaced so the UI can tell the user *which* wallets need a
   *  destination — without this they only see "4 unmapped" and have
   *  no way to act on it. */
  unmappedWalletIds: string[];
  /**
   * Net signed amount change per Personal account (keyed by account UUID)
   * for rows that were *actually inserted* this run. Duplicate rows
   * (ignoreDuplicates: true) are excluded so the caller can safely add
   * this delta to the current stored balance without double-counting on
   * re-syncs. Zero entries are omitted.
   */
  netByAccount: Record<string, number>;
  /**
   * Accounts whose opening date this run moved back so the batch could
   * land. Empty on a normal incremental sync; non-empty on the first
   * import of a wallet that has real history. Surfaced so the UI can
   * tell the user their opening date changed rather than changing it
   * behind their back.
   */
  openedAtRepairs: OpenedAtRepair[];
  /**
   * Subset of `errored` where the database rejected the chunk because
   * the rows predate their account's opening date. Counted separately
   * so the caller can name the cause instead of showing a generic
   * "import failed".
   */
  blockedByOpeningDate: number;
  /**
   * DL-1424. Number of times a balance credit was refused because the
   * transaction's amount unit did not match a destination account's currency
   * (e.g. a satoshi integer routed into an account kept in whole BTC).
   * Counted per DESTINATION ACCOUNT, not per transaction: a transaction
   * mapped to more than one account (the 1:N mapping loop) can add more than
   * one to this count. The row is still imported with its own correct
   * `enc_currency`; only the stored-balance credit is skipped, because adding
   * the raw number would corrupt the balance by a factor of 1e8. Counted,
   * never guessed.
   */
  unitMismatch: number;
}

/**
 * The crypto + db surface the bridge needs. Kept as plain
 * functions / objects (not hook returns) so unit tests can stub
 * them without a React tree.
 */
export interface OrImportDeps {
  /** Authenticated Supabase client (RLS enforces user_id). */
  supabase: Pick<SupabaseClient, "from">;
  /** auth.uid() value — written to every row's user_id. */
  userId: string;
  /** Vault MEK encrypt — same helper used by useTransactions. */
  encryptText: (plaintext: string) => Promise<string>;
  /** Resolve OR (connection, source_wallet) → Personal accounts.id values.
   *  Empty array means "unmapped". Pulled from useConnectionAccountMap. */
  resolveAccountIds: (orConnectionId: string, sourceWalletId: string) => string[];
  /**
   * Optional currency lookup keyed by Personal accountId. Lets us
   * stamp `enc_currency` consistently with the destination account
   * even when the OR payload doesn't include a currency. Returns
   * undefined when the lookup fails — bridge will then fall back
   * to whatever the OR payload supplied.
   */
  getAccountCurrency?: (accountId: string) => string | undefined;
  /** Per-row error sink. Caller decides whether to surface to UI. */
  onError?: (orTxId: string, err: unknown) => void;
  /**
   * Phase 4.4: optional household-scope + signature builder. When the
   * caller's vault has an active household, supply
   * `VaultContext.buildHouseholdSignatureFields`. The bridge then
   * stamps every imported row with `household_id`, `signature_b64`,
   * `signature_key_version`. Omit (or return all-NULL) for solo
   * users — the server trigger short-circuits on NULL household_id.
   */
  buildSignatureFields?: () => {
    household_id: string | null;
    signature_b64: string | null;
    signature_key_version: number | null;
  };
}

const EXTERNAL_SOURCE = "orangerails";

/**
 * The invariant in migration 20260530000000 raises with this phrase.
 * Matching on it lets us name the real cause in the result instead of
 * folding it into the generic error tally.
 */
const OPENED_AT_REJECTION = /before account opened_at/i;

/**
 * Convert a single OR transaction's amount to the signed string
 * Personal stores. Bitcoin sats are kept as integers; fiat stays
 * decimal. Outflows are negative ("-12.50" / "-1500"); inflows are
 * positive ("12.50" / "1500"). Falls back to "0" when neither
 * `amount_sats` nor `amount` is present — caller already filtered
 * these out via `untagged`/`errored` counts.
 */
function buildSignedAmount(tx: OrImportTransaction): string {
  let abs: number;
  if (typeof tx.amount_sats === "number" && Number.isFinite(tx.amount_sats)) {
    abs = Math.abs(Math.round(tx.amount_sats));
  } else if (typeof tx.amount === "number" && Number.isFinite(tx.amount)) {
    abs = Math.abs(tx.amount);
  } else {
    return "0";
  }
  const signed = tx.direction === "out" ? -abs : abs;
  // Integers stay integers; decimals keep the JS toString. We
  // intentionally don't force `.toFixed(2)` — Personal stores the
  // raw amount as a string and the formatter pads at render time.
  return signed.toString();
}

/**
 * Pick the best currency string. Priority:
 *   1. "sats" when `amount_sats` is present — the amount field is a
 *      satoshi integer regardless of what the Account's currency label
 *      says. This prevents Bitcoin wallets labelled "BTC" from having
 *      their sats integers formatted as 8-decimal BTC values.
 *   2. The destination Account's currency (most authoritative for
 *      non-Bitcoin amounts — it's what the user picked when mapping).
 *   3. The OR payload's `currency`.
 *   4. null — leave enc_currency NULL, render falls back to "".
 */
function pickCurrency(tx: OrImportTransaction, accountCurrency: string | undefined): string | null {
  if (typeof tx.amount_sats === "number" && Number.isFinite(tx.amount_sats)) return "sats";
  if (accountCurrency && accountCurrency.trim().length > 0) return accountCurrency;
  if (tx.currency && tx.currency.trim().length > 0) return tx.currency;
  return null;
}

/**
 * DL-1424. True when the signed amount we would credit to the account's stored
 * balance is in the same unit as that balance.
 *
 * The balance is stored in the account's own currency. The credited amount is
 * in the transaction's native unit: a satoshi integer when `amount_sats` is
 * set, otherwise the tx currency (falling back to the account currency when the
 * payload omits one). When those units differ, adding the raw number corrupts
 * the balance, the classic case being a Bitcoin wallet reporting sats imported
 * into an account the user keeps in whole BTC, which inflates it by 1e8.
 *
 * We never guess a conversion. Returns false ONLY for a provable mismatch:
 * when the account currency is unknown we cannot prove one, so we return true
 * and preserve the existing behaviour rather than silently stop crediting.
 *
 * The compare is case-insensitive: a difference of case ("btc" vs "BTC") is
 * not a provable unit mismatch, only a labelling difference, so it must not
 * refuse the credit.
 */
function balanceUnitMatches(tx: OrImportTransaction, accountCurrency: string | undefined): boolean {
  const balanceUnit = accountCurrency?.trim();
  if (!balanceUnit) return true;
  const amountUnit =
    typeof tx.amount_sats === "number" && Number.isFinite(tx.amount_sats)
      ? "sats"
      : tx.currency && tx.currency.trim().length > 0
        ? tx.currency.trim()
        : balanceUnit;
  return amountUnit.toUpperCase() === balanceUnit.toUpperCase();
}

/**
 * Build the description that lands in the encrypted column. We
 * prefer the OR description, fall back to counterparty (e.g.
 * "Lightning invoice from alice@example.com"), then to the raw
 * type label so the row is never blank.
 */
function pickDescription(tx: OrImportTransaction): string {
  if (tx.description && tx.description.trim().length > 0) return tx.description;
  if (tx.counterparty && tx.counterparty.trim().length > 0) return tx.counterparty;
  if (tx.type) return capitalize(tx.type);
  return "Imported transaction";
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Slice an ISO timestamp to the YYYY-MM-DD plaintext date column
 * Personal uses. Robust against bad input — returns the empty
 * string if parsing fails so the caller skips the row.
 */
function isoToDate(iso: string): string {
  if (!iso || typeof iso !== "string") return "";
  const idx = iso.indexOf("T");
  if (idx > 0) return iso.slice(0, idx);
  // Some OR payloads ship pure date already — accept as-is when valid.
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  // Last-ditch: parse via Date. Not great for offset-less strings
  // but better than dropping the row entirely.
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

/**
 * Take the YYYY-MM-DD head of a timestamp column. Returns null when the
 * value is not a date we recognise, so a surprise shape can never be
 * compared as if it were a date.
 */
function toDateOnly(value: unknown): string | null {
  if (typeof value !== "string" || value.length < 10) return null;
  const head = value.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(head) ? head : null;
}

/**
 * Shift a YYYY-MM-DD date back one day. Returns the input unchanged when
 * it does not parse, so a bad value can never widen an opening date to
 * something arbitrary. The one-day margin matches the demo-seed helper
 * and keeps the comparison safe when the column's timezone renders the
 * boundary day differently from the transaction date.
 */
function dateMinusOneDay(date: string): string {
  const t = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(t)) return date;
  return new Date(t - 86_400_000).toISOString().slice(0, 10);
}

/**
 * Move each account's opening date back when the batch we are about to
 * write contains something older than it.
 *
 * Why this exists: `accounts.opened_at` is stamped `now()` the moment the
 * row is created, and migration 20260530000000 rejects any transaction
 * dated before it. Imported history is nearly always older than the
 * account row, so without this a first sync of a real wallet has every
 * row rejected.
 *
 * Widening backwards is always safe. The invariant only rejects
 * transactions that predate the opening date, so an earlier date cannot
 * invalidate a row that already exists, and the parallel trigger in the
 * same migration only guards moving an opening date forward.
 *
 * Exported so the connections UI can offer the same repair as an explicit
 * action on an account that is already stuck.
 */
export async function widenAccountOpeningDates(
  earliestByAccount: Map<string, string>,
  deps: Pick<OrImportDeps, "supabase" | "buildSignatureFields">,
): Promise<{ repaired: OpenedAtRepair[]; failed: string[] }> {
  const repaired: OpenedAtRepair[] = [];
  const failed: string[] = [];
  const accountIds = Array.from(earliestByAccount.keys());
  if (accountIds.length === 0) return { repaired, failed };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const accountsTable = () => (deps.supabase as any).from("accounts");
  const { data, error } = await accountsTable().select("id, opened_at").in("id", accountIds);
  if (error) throw error;

  for (const row of (data ?? []) as Array<{ id: string; opened_at: string | null }>) {
    const earliest = earliestByAccount.get(row.id);
    const current = toDateOnly(row.opened_at);
    // Nothing to do when the account already opens early enough, or when
    // the column holds something we cannot read as a date.
    if (!earliest || !current || earliest >= current) continue;

    const target = dateMinusOneDay(earliest);
    const patch = {
      opened_at: target,
      ...(deps.buildSignatureFields?.() ?? {}),
    };
    const { error: upErr } = await accountsTable().update(patch).eq("id", row.id);
    if (upErr) {
      failed.push(row.id);
      // Valueless signal at error level, the object at log level, matching
      // the breadcrumb split used everywhere else in this module.
      console.error("[orImportBridge] could not widen an account opening date");
      console.log("[orImportBridge] widen opening date detail", upErr);
      continue;
    }
    repaired.push({ accountId: row.id, from: current, to: target });
  }
  return { repaired, failed };
}

/**
 * Build the encrypted row payload the transactions table accepts.
 * Mirrors `useTransactions.buildEncryptedRow` minus the
 * fields that don't apply to imported data:
 *   - `enc_merchant`, `enc_category_id`, `enc_memo`, `enc_tags`:
 *     null on first import. The user can edit afterward; the
 *     unique index makes future re-syncs ignore the row,
 *     so user edits are never overwritten.
 *   - `hmac_*`: null. Computed when the user later sets a
 *     merchant/category via the standard transaction edit flow.
 *   - `is_split_parent`, `split_parent_id`, `transfer_group_id`,
 *     `is_manual_category`: defaults from the schema.
 */
async function buildRow(
  tx: OrImportTransaction,
  accountId: string,
  deps: OrImportDeps,
): Promise<Record<string, unknown> | null> {
  const date = isoToDate(tx.timestamp);
  if (!date) return null;
  const amount = buildSignedAmount(tx);
  const description = pickDescription(tx);
  const currency = pickCurrency(tx, deps.getAccountCurrency?.(accountId));

  const enc_amount = await deps.encryptText(amount);
  const enc_description = await deps.encryptText(description);
  const enc_currency = currency ? await deps.encryptText(currency) : null;
  const enc_merchant = tx.counterparty ? await deps.encryptText(tx.counterparty) : null;

  return {
    user_id: deps.userId,
    account_id: accountId,
    date,
    enc_amount,
    enc_currency,
    enc_description,
    enc_merchant,
    enc_category_id: null,
    enc_memo: null,
    enc_tags: null,
    enc_owner: null,
    hmac_merchant: null,
    hmac_category: null,
    is_split_parent: false,
    split_parent_id: null,
    transfer_group_id: null,
    is_manual_category: false,
    external_id: tx.id,
    external_source: EXTERNAL_SOURCE,
    ...(deps.buildSignatureFields?.() ?? {}),
  };
}

/**
 * Import a batch of decrypted OR transactions from a single OR
 * connection. Returns a structured result the caller can use to
 * surface a toast or progress UI.
 *
 * Batching: rows are upserted in chunks of 100 to stay well under
 * Supabase's payload limits. We use `upsert(..., { onConflict:
 * 'user_id,external_source,external_id', ignoreDuplicates: true })`
 * so that re-syncing the same OR batch is a no-op AND any user
 * edits to a previously-imported row survive untouched (the
 * `ignoreDuplicates` flag is the load-bearing piece — without
 * it, upsert would clobber edits).
 */
export async function importOrTransactions(
  orConnectionId: string,
  txs: OrImportTransaction[],
  deps: OrImportDeps,
): Promise<OrImportResult> {
  const result: OrImportResult = {
    imported: 0,
    unmapped: 0,
    untagged: 0,
    errored: 0,
    decryptFailures: 0,
    total: txs.length,
    unmappedWalletIds: [],
    netByAccount: {},
    openedAtRepairs: [],
    blockedByOpeningDate: 0,
    unitMismatch: 0,
  };

  // Track plaintext signed amount keyed by "accountId::externalId" so we can
  // credit the correct account when the upsert response tells us which rows
  // were actually inserted (vs. silently skipped as duplicates).
  const amountKey = (accountId: string, externalId: string) => `${accountId}::${externalId}`;
  const amountByKey = new Map<string, number>();

  // Pre-resolve mappings so per-tx work is just a Map lookup.
  // Cache by source_wallet_id since multiple txs share a wallet.
  const walletToAccountIds = new Map<string, string[]>();
  const unmappedSeen = new Set<string>();
  function lookup(walletId: string): string[] {
    let cached = walletToAccountIds.get(walletId);
    if (cached === undefined) {
      cached = deps.resolveAccountIds(orConnectionId, walletId);
      walletToAccountIds.set(walletId, cached);
    }
    return cached;
  }

  const rows: Record<string, unknown>[] = [];

  for (const tx of txs) {
    if (!tx.source_wallet_id) {
      result.untagged += 1;
      continue;
    }
    const accountIds = lookup(tx.source_wallet_id);
    if (accountIds.length === 0) {
      result.unmapped += 1;
      if (!unmappedSeen.has(tx.source_wallet_id)) {
        unmappedSeen.add(tx.source_wallet_id);
        result.unmappedWalletIds.push(tx.source_wallet_id);
      }
      continue;
    }
    // 1:N mapping support (rare in Phase 4 but the schema allows
    // it): we write one row per destination. Each gets its own
    // external_id collision check from the unique index.
    // Phase 5 ships exactly this — split routing UX comes later.
    for (const accountId of accountIds) {
      try {
        const row = await buildRow(tx, accountId, deps);
        if (row) {
          rows.push(row);
          // Record the plaintext signed amount so we can update account
          // balances for rows that are actually inserted (not duplicates).
          // DL-1424: only credit the balance when the amount's unit matches
          // the account's currency. A mismatch (e.g. a sats integer routed
          // into a whole-BTC account) would corrupt the balance by 1e8, so we
          // skip the credit and count it rather than guess a conversion. The
          // row still lands with its own correct enc_currency.
          if (balanceUnitMatches(tx, deps.getAccountCurrency?.(accountId))) {
            amountByKey.set(amountKey(accountId, tx.id), Number(buildSignedAmount(tx)) || 0);
          } else {
            result.unitMismatch += 1;
            // Valueless signal at warn level; values at log level, matching the
            // breadcrumb split used everywhere else in this module.
            console.warn(
              "[orImportBridge] balance credit skipped: amount unit does not match account currency for 1 tx",
            );
            console.log("[orImportBridge] unit mismatch detail", {
              id: tx.id,
              accountId,
              accountCurrency: deps.getAccountCurrency?.(accountId),
              hasSats: typeof tx.amount_sats === "number",
              currency: tx.currency,
            });
          }
        } else {
          result.errored += 1;
          // warn carries no values: warn/error breadcrumbs are kept by
          // beforeBreadcrumb and flushed to the error tracker. Values
          // (tx id, timestamp) go to console.log which is dropped before
          // the breadcrumb buffer and never leaves the browser.
          console.warn("[orImportBridge] null row (bad date) for 1 tx");
          console.log("[orImportBridge] null row detail", { id: tx.id, timestamp: tx.timestamp });
          deps.onError?.(tx.id, new Error(`Invalid date on OR transaction: "${tx.timestamp}"`));
        }
      } catch (err) {
        result.errored += 1;
        result.decryptFailures += 1;
        // Same split: valueless error at warn/error level, full object at log level.
        console.error("[orImportBridge] buildRow threw for 1 tx");
        console.log("[orImportBridge] buildRow threw detail", err);
        deps.onError?.(tx.id, err);
      }
    }
  }

  if (rows.length === 0) {
    console.log("[orImportBridge] run summary (0 rows built)", {
      total: result.total,
      unmapped: result.unmapped,
      untagged: result.untagged,
      errored: result.errored,
      decryptFailures: result.decryptFailures,
    });
    return result;
  }

  // Make room for the batch before writing it. Every destination account
  // whose opening date is later than its oldest row in this batch gets
  // moved back, otherwise the invariant rejects the whole chunk.
  const earliestByAccount = new Map<string, string>();
  for (const row of rows) {
    const accountId = row.account_id as string;
    const date = row.date as string;
    if (!accountId || !date) continue;
    const current = earliestByAccount.get(accountId);
    if (current === undefined || date < current) earliestByAccount.set(accountId, date);
  }
  try {
    const { repaired } = await widenAccountOpeningDates(earliestByAccount, deps);
    result.openedAtRepairs = repaired;
    if (repaired.length > 0) {
      console.warn("[orImportBridge] widened opening dates so older rows could land");
      console.log("[orImportBridge] widened opening dates detail", repaired);
    }
  } catch (err) {
    // Non-fatal by design: if we cannot read or write the opening dates we
    // still attempt the import, so this degrades to the previous behaviour
    // instead of blocking a sync that might have nothing old in it.
    console.error("[orImportBridge] opening-date reconcile skipped");
    console.log("[orImportBridge] opening-date reconcile detail", err);
  }

  const CHUNK = 100;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    // The cast mirrors useTransactions/useAccounts: the generated
    // Supabase types lag the migration in this commit (the external_id
    // columns are added by the same migration that ships this code).
    // The runtime contract is stable.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const txnsTable = (deps.supabase as any).from("transactions");
    const { error, data } = await txnsTable
      .upsert(chunk, {
        onConflict: "user_id,external_source,external_id",
        ignoreDuplicates: true,
      })
      .select("id, account_id, external_id");
    if (error) {
      // A whole-chunk failure is non-fatal — tally each row as
      // errored, log once, and continue with the next chunk so a
      // single bad chunk doesn't lose every row.
      // Supabase error objects can carry partial row data in their
      // message/details fields, so keep the valueless signal at
      // error level and the object itself at log level.
      const message = String((error as { message?: unknown }).message ?? "");
      if (OPENED_AT_REJECTION.test(message)) {
        // Named separately so the caller can say "these are older than the
        // account's opening date" rather than "import failed".
        result.blockedByOpeningDate += chunk.length;
        console.error("[orImportBridge] chunk rejected: rows predate the account opening date");
      } else {
        console.error("[orImportBridge] upsert chunk failed");
      }
      console.log("[orImportBridge] upsert chunk failed detail", error);
      for (const r of chunk) {
        const tid = (r as { external_id?: string }).external_id ?? "(unknown)";
        deps.onError?.(tid, error);
      }
      result.errored += chunk.length;
      continue;
    }
    // `ignoreDuplicates: true` returns only the rows that were
    // actually inserted. Existing duplicates are silently absent
    // from `data` — perfect for our "imported" counter and balance delta.
    const inserted = Array.isArray(data) ? data.length : 0;
    result.imported += inserted;
    // Accumulate the signed amount for each actually-inserted row so the
    // caller can update the account's stored balance by the net delta.
    for (const row of (data ?? []) as Array<{
      id: string;
      account_id: string;
      external_id: string | null;
    }>) {
      if (!row.account_id || !row.external_id) continue;
      const key = amountKey(row.account_id, row.external_id);
      const amt = amountByKey.get(key);
      if (amt !== undefined) {
        result.netByAccount[row.account_id] = (result.netByAccount[row.account_id] ?? 0) + amt;
      }
    }
  }

  console.log("[orImportBridge] run summary", {
    total: result.total,
    imported: result.imported,
    unmapped: result.unmapped,
    untagged: result.untagged,
    errored: result.errored,
    decryptFailures: result.decryptFailures,
    openedAtRepairs: result.openedAtRepairs.length,
    blockedByOpeningDate: result.blockedByOpeningDate,
    unitMismatch: result.unitMismatch,
  });
  return result;
}

/**
 * Look up which OR external_ids are already in the local
 * `transactions` table for a given list. Used by TransactionList
 * to render an "in ledger" badge per row without per-row queries.
 *
 * Returns a Set of OR transaction ids that are present locally.
 */
export async function fetchImportedExternalIds(
  externalIds: string[],
  deps: Pick<OrImportDeps, "supabase" | "userId">,
): Promise<Set<string>> {
  if (externalIds.length === 0) return new Set();
  // Dedupe defensively — caller may pass repeats.
  const unique = Array.from(new Set(externalIds));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const txnsTable = (deps.supabase as any).from("transactions");
  const { data, error } = await txnsTable
    .select("external_id")
    .eq("user_id", deps.userId)
    .eq("external_source", EXTERNAL_SOURCE)
    .in("external_id", unique);
  if (error) {
    // Treat a lookup failure as "nothing imported" — the badge
    // simply won't appear. Surfacing a spinner for badges would
    // be more disruptive than the silent omission.
    // Supabase error object at log level only (see warn/error breadcrumb note above).
    console.warn("[orImportBridge] fetchImportedExternalIds failed");
    console.log("[orImportBridge] fetchImportedExternalIds failed detail", error);
    return new Set();
  }
  const set = new Set<string>();
  for (const row of (data ?? []) as Array<{ external_id: string | null }>) {
    if (row.external_id) set.add(row.external_id);
  }
  return set;
}
