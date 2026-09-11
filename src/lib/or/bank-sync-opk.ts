/**
 * Quiltt bank-transaction sync via the OPK sealed-box path (ZKA).
 *
 * OR's or-quiltt-sync pulls bank transactions from Quiltt and seals each
 * under the subaccount's OPK (libsodium crypto_box_seal) into
 * encrypted_transactions. This module is the client half:
 *
 *   1. registerOpk      — publish the OPK public key on OR so or-quiltt-sync
 *                         can seal to it (call once per user; idempotent).
 *   2. syncQuilttConnection — page through the sealed rows via
 *                         or-transactions-list, crypto_box_seal_open each
 *                         with the OPK private key, map the Quiltt
 *                         cleartext to the import shape, and hand off to
 *                         importOrTransactions (which re-encrypts each
 *                         field under the vault MEK before INSERT).
 *
 * ZKA: the sealed payload is unreadable to OR and Orange Way servers; only
 * this browser (vault unlocked → OPK private key in memory) can open it.
 * The plaintext exists in browser memory for milliseconds per row before
 * importOrTransactions re-seals it under the MEK for at-rest storage.
 */

import { opkSealOpen, OPK_ALG, type OpkKeypair } from "@/lib/or/opk";
import { nextTransactionsPage, type TransactionRow } from "@/lib/or/transactions-page";
import {
  importOrTransactions,
  type OrImportTransaction,
  type OrImportResult,
  type OrImportDeps,
} from "@/lib/orImportBridge";

/** Shape OR seals inside encrypted_payload (see or-quiltt-sync cleartext). */
interface QuilttSealedPayload {
  amount: number | string | null;
  currency: string | null;
  description: string | null;
  entry_type: string | null; // Quiltt entryType: CREDIT (in) / DEBIT (out)
  upstream_status?: string | null;
  account_id: string | null; // Quiltt account id == connection_account_map.or_external_wallet_id
}

/** Row shape returned by or-transactions-list. */
interface EncryptedTxRow {
  id: string;
  connection_id: string;
  external_id: string | null;
  encrypted_payload: string;
  occurred_at: string;
}

type CallProxy = (endpoint: string, payload: Record<string, unknown>) => Promise<unknown>;

/** or-transactions-list page size for the Quiltt bank-sync path. Distinct
 *  from fetchAllTransactionRows' 500 in ConnectionsPage.tsx; nothing ties
 *  the two together, so no reason to change a value that already works. */
const PAGE_LIMIT = 1000;
/** Safety valve so a pathological response (a store that never returns a
 *  short page) cannot spin this loop forever. Matches
 *  fetchAllTransactionRows/fetchStealthRows in ConnectionsPage.tsx. */
const MAX_PAGES = 25;

/**
 * Fetch every or-transactions-list row for the subaccount (OWM-T0726).
 *
 * `nextTransactionsPage` is the one place that knows how to tell "may be
 * more" from "store exhausted" on this endpoint (see transactions-page.ts
 * for why its own `truncated` flag does not settle that alone). This walks
 * pages, stops on `!hasMore`, and caps at `MAX_PAGES`. Rows are not
 * filtered by connection here; the caller does that, same as
 * fetchAllTransactionRows + orRowsForConnection in ConnectionsPage.tsx.
 */
async function fetchAllQuilttTransactionRows(
  callProxy: CallProxy,
  subaccountId: string,
): Promise<TransactionRow[]> {
  const out: TransactionRow[] = [];
  let before: string | undefined;

  for (let i = 0; i < MAX_PAGES; i++) {
    let res: unknown;
    try {
      res = await callProxy("or-transactions-list", {
        subaccount_id: subaccountId,
        limit: PAGE_LIMIT,
        ...(before ? { before } : {}),
      });
    } catch (err) {
      console.warn("[bank-sync] transaction list read failed", err);
      break;
    }
    const page = nextTransactionsPage(res, PAGE_LIMIT);
    out.push(...page.rows);
    if (!page.hasMore || !page.nextBefore) break;
    before = page.nextBefore;
  }
  return out;
}

/**
 * Register the OPK public key on OR for this user. Idempotent — OR returns
 * 'unchanged' if the same key is already registered. Must run before
 * or-quiltt-sync seals anything; safe to call on every Connections mount.
 *
 * Two-call retry pattern to handle OR's rotation guard: on the first call we
 * DON'T set confirm_rotation, so a first-time registration succeeds and a
 * stale-key mismatch returns 409. We then retry once with
 * confirm_rotation: true — that path additionally writes an audit row on
 * OR (see opk_key_rotations) so any future operator can see exactly when
 * a key flipped. The vault is what changes the OPK seed (password change,
 * recovery), so this rotation path is expected legitimate flow.
 */
export async function registerOpk(callProxy: CallProxy, keypair: OpkKeypair): Promise<void> {
  try {
    await callProxy("or-sync-key-register", {
      opk_public: keypair.publicKeyB64,
      opk_alg: OPK_ALG,
    });
  } catch (err) {
    // Detect OR's rotation guard (409 + "confirm_rotation required" body).
    // callProxy wraps non-2xx supabase-js responses in CallProxyError which
    // exposes both .status (parsed from the upstream Response) and .body
    // (parsed JSON). Falling back to a substring scan on the message keeps
    // the path working even if a future caller wires a different proxy
    // wrapper that doesn't yet expose status.
    const e = err as { status?: number; body?: { error?: string }; message?: string };
    const isRotation =
      e?.status === 409 ||
      /confirm_rotation/i.test(e?.body?.error ?? "") ||
      /confirm_rotation/i.test(e?.message ?? "");
    if (!isRotation) throw err;
    await callProxy("or-sync-key-register", {
      opk_public: keypair.publicKeyB64,
      opk_alg: OPK_ALG,
      confirm_rotation: true,
      rotation_reason: "owm-client-vault-rotated",
    });
  }
}

/**
 * Best-effort merchant extraction from Quiltt's raw `description`. Quiltt
 * (via Finicity for Mercury et al.) returns descriptions in formats like:
 *
 *   "IO AUTOPAY; Merchant name: Mercury Credit"
 *   "DEBIT POS PURCHASE; Merchant name: STARBUCKS #1234"
 *   "Credit Cashback Deposit; Merchant name: Mercury IO Cashback"
 *
 * The text after "Merchant name:" is the clean merchant. Falls back to
 * the raw description when the pattern doesn't match. Verified against
 * Quiltt PROD samples via or-quiltt-introspect.
 */
function extractMerchant(description: string | null | undefined): string | null {
  if (!description) return null;
  const m = description.match(/Merchant name:\s*(.+?)(?:\s*[;|]|$)/i);
  if (m && m[1]) return m[1].trim();
  return description.trim() || null;
}

/**
 * Map a Quiltt sealed cleartext + its row metadata to the bridge's import
 * shape. Direction from entryType; magnitude from |amount| (Quiltt signs
 * debits negative, but the bridge wants a magnitude + explicit direction).
 */
function toImportTransaction(
  payload: QuilttSealedPayload,
  row: EncryptedTxRow,
): OrImportTransaction {
  const direction: "in" | "out" =
    (payload.entry_type ?? "").toUpperCase() === "CREDIT" ? "in" : "out";
  const rawAmount =
    typeof payload.amount === "string" ? Number(payload.amount) : (payload.amount ?? 0);
  const magnitude = Number.isFinite(rawAmount) ? Math.abs(rawAmount) : 0;
  const merchant = extractMerchant(payload.description);
  return {
    id: row.external_id ?? row.id,
    direction,
    type: "bank",
    amount: magnitude,
    currency: payload.currency ?? undefined,
    // Preserve the raw bank text as description; surface the cleaner merchant
    // name separately so the list view reads as "Mercury Credit" instead of
    // "IO AUTOPAY; Merchant name: Mercury Credit".
    description: payload.description ?? null,
    counterparty: merchant,
    timestamp: row.occurred_at,
    // The Quiltt account id is the source_wallet the bridge resolves through
    // connection_account_map → Personal accounts.id.
    source_wallet_id: payload.account_id ?? null,
  };
}

export interface SyncQuilttArgs {
  callProxy: CallProxy;
  subaccountId: string;
  connectionId: string;
  keypair: OpkKeypair;
  deps: OrImportDeps;
  /** Optional progress callback: (unsealed, total). */
  onProgress?: (done: number, total: number) => void;
}

export interface SyncQuilttResult extends OrImportResult {
  /** Rows that failed to unseal (wrong key, tampered, non-OPK). */
  unsealFailures: number;
}

/**
 * Fetch + unseal + import all sealed transactions for one Quiltt connection.
 */
export async function syncQuilttConnection(args: SyncQuilttArgs): Promise<SyncQuilttResult> {
  const { callProxy, subaccountId, connectionId, keypair, deps, onProgress } = args;

  const allRows = await fetchAllQuilttTransactionRows(callProxy, subaccountId);
  const rows = allRows.filter((t) => t.connection_id === connectionId);
  const total = rows.length;

  const decoded: OrImportTransaction[] = [];
  let unsealFailures = 0;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    try {
      const json = await opkSealOpen(row.encrypted_payload, keypair);
      const payload = JSON.parse(json) as QuilttSealedPayload;
      decoded.push(toImportTransaction(payload, row));
    } catch {
      unsealFailures += 1;
    }
    onProgress?.(i + 1, total);
  }

  const result = await importOrTransactions(connectionId, decoded, deps);
  return { ...result, unsealFailures };
}
