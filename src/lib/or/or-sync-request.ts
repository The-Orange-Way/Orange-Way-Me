/**
 * The or-sync request and its Orange Way Me sink response boundary.
 *
 * or-sync still needs the credentials subkey transiently so it can talk to the
 * upstream provider. It must not receive the transactions subkey. Passing the
 * `orangeway-me` format selects Orange Rails' response sink: OR returns
 * app-shaped plaintext drafts to this browser and does not write them to its
 * encrypted_transactions store. The browser then routes those drafts through
 * importOrTransactions, which encrypts every sensitive field under the vault
 * MEK before the OWM database write.
 *
 * The response format is checked here rather than inferred from the request.
 * A server that ignores or changes `format` must fail closed; falling back to
 * the legacy request would hand over transactions_key again.
 */

import type { OrImportTransaction } from "@/lib/orImportBridge";
import { planSyncRoute, type SyncRoute, type SyncRouteCandidate } from "./sync-route";

export const OR_SYNC_FORMAT = "orangeway-me";

/** A connection as this request needs it: enough to route it, plus its id. */
export interface OrSyncConnection extends SyncRouteCandidate {
  id: string;
}

interface OwmSinkAmount {
  value: string;
  currency: string;
  direction: "in" | "out";
}

/** The row draft emitted by Orange Rails' orangeway-me sink adapter. */
export interface OwmSinkTransactionRow {
  date: string;
  enc_amount: string;
  enc_description: string | null;
  enc_merchant: string | null;
  __resolveAccountId: {
    or_connection_id: string;
    or_external_wallet_id: string | null;
  };
  _meta: {
    or_connection_id: string;
    external_id: string;
    provider_slug: string;
    schema_version: string;
  };
}

/** The sink response fields used by both ConnectionsPage call paths. */
export interface OrSyncResponse {
  synced: number;
  connections: Array<{ connection_id: string; synced: number; error?: string }>;
  rows: {
    transactions?: OwmSinkTransactionRow[];
    [table: string]: unknown[] | undefined;
  };
  metadata: {
    format: typeof OR_SYNC_FORMAT;
    requires_encryption: string[];
  };
}

/**
 * The remaining key handover, injected because the vault export is a React
 * hook. There is deliberately no transactions-key export on this interface.
 */
export interface OrSyncHandover {
  /** Vault export of the Orange Rails credentials subkey, raw base64. */
  exportCredentialsKey(): Promise<string>;
  /** The ow-or-proxy call. Endpoint and payload, exactly as the caller's own. */
  callProxy(endpoint: string, payload: Record<string, unknown>): Promise<unknown>;
}

/** Raised when a connection that must not go to or-sync was handed to it. */
export class OrSyncRouteRefusal extends Error {
  readonly route: SyncRoute;
  readonly connectionId: string;

  constructor(route: SyncRoute, connectionId: string) {
    super("This connection is not synced through this path, so it was not sent.");
    this.name = "OrSyncRouteRefusal";
    this.route = route;
    this.connectionId = connectionId;
  }
}

/**
 * Raised when Orange Rails did not positively identify the response as the
 * requested OWM sink shape. The response body is intentionally not attached:
 * sink rows contain plaintext transaction values while they are in memory.
 */
export class OrSyncSinkContractError extends Error {
  constructor(message = "Orange Rails returned an unexpected sync response format.") {
    super(message);
    this.name = "OrSyncSinkContractError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Positive response-direction check for sink mode. Sending `format` is only a
 * request; metadata.format in the response is the evidence that OR took the
 * non-storing branch.
 */
function assertSinkResponse(value: unknown): asserts value is OrSyncResponse {
  if (!isRecord(value) || !Array.isArray(value.connections) || !isRecord(value.rows)) {
    throw new OrSyncSinkContractError();
  }
  if (
    !isRecord(value.metadata) ||
    value.metadata.format !== OR_SYNC_FORMAT ||
    !Array.isArray(value.metadata.requires_encryption)
  ) {
    throw new OrSyncSinkContractError();
  }
  if (
    typeof value.synced !== "number" ||
    !Number.isFinite(value.synced) ||
    value.connections.some(
      (entry) =>
        !isRecord(entry) ||
        typeof entry.connection_id !== "string" ||
        typeof entry.synced !== "number" ||
        !Number.isFinite(entry.synced) ||
        (entry.error !== undefined && typeof entry.error !== "string"),
    )
  ) {
    throw new OrSyncSinkContractError();
  }
  const transactions = value.rows.transactions;
  if (transactions !== undefined && !Array.isArray(transactions)) {
    throw new OrSyncSinkContractError();
  }
}

function parseSinkRow(value: unknown): OwmSinkTransactionRow {
  if (!isRecord(value) || !isRecord(value._meta) || !isRecord(value.__resolveAccountId)) {
    throw new OrSyncSinkContractError();
  }
  if (
    typeof value.date !== "string" ||
    typeof value.enc_amount !== "string" ||
    (typeof value.enc_description !== "string" && value.enc_description !== null) ||
    (typeof value.enc_merchant !== "string" && value.enc_merchant !== null) ||
    typeof value._meta.or_connection_id !== "string" ||
    typeof value._meta.external_id !== "string" ||
    typeof value._meta.provider_slug !== "string" ||
    typeof value._meta.schema_version !== "string" ||
    typeof value.__resolveAccountId.or_connection_id !== "string" ||
    (typeof value.__resolveAccountId.or_external_wallet_id !== "string" &&
      value.__resolveAccountId.or_external_wallet_id !== null)
  ) {
    throw new OrSyncSinkContractError();
  }
  return value as unknown as OwmSinkTransactionRow;
}

function parseSinkAmount(value: unknown): OwmSinkAmount {
  if (typeof value !== "string") throw new OrSyncSinkContractError();
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new OrSyncSinkContractError();
  }
  if (
    !isRecord(parsed) ||
    typeof parsed.value !== "string" ||
    typeof parsed.currency !== "string" ||
    (parsed.direction !== "in" && parsed.direction !== "out")
  ) {
    throw new OrSyncSinkContractError();
  }
  return parsed as unknown as OwmSinkAmount;
}

/**
 * Convert the sink drafts for one connection into the existing import bridge
 * shape. The bridge, not this function, owns encryption and persistence.
 */
export function sinkTransactionsForConnection(
  response: OrSyncResponse,
  connectionId: string,
): OrImportTransaction[] {
  // Never dynamically persist the response according to
  // metadata.requires_encryption. Only this narrow, validated shape is
  // admitted, and it is converted to the import bridge's plaintext input.
  // Unknown sink fields are dropped; known sensitive fields are always
  // encrypted by the bridge before its upsert.
  const rows = (response.rows.transactions ?? []).map(parseSinkRow);
  return rows
    .filter((row) => row?._meta?.or_connection_id === connectionId)
    .map((row) => {
      const amount = parseSinkAmount(row.enc_amount);
      const numericAmount = Number(amount.value);
      if (
        !row._meta.external_id ||
        !row.date ||
        !row.__resolveAccountId ||
        !Number.isFinite(numericAmount)
      ) {
        throw new OrSyncSinkContractError();
      }

      const common = {
        id: row._meta.external_id,
        direction: amount.direction,
        type: row._meta.provider_slug || "imported",
        description: row.enc_description ?? null,
        counterparty: row.enc_merchant ?? null,
        timestamp: row.date,
        source_wallet_id: row.__resolveAccountId.or_external_wallet_id,
      } satisfies Omit<OrImportTransaction, "amount" | "amount_sats" | "currency">;

      return amount.currency.toLowerCase() === "sats"
        ? { ...common, amount_sats: numericAmount, currency: "sats" }
        : { ...common, amount: numericAmount, currency: amount.currency };
    });
}

export interface LegacyOrTransactionRow {
  connection_id: string;
  encrypted_payload: string;
}

/**
 * Join newly returned sink drafts with rows written by the former ORT-backed
 * scheme. Legacy rows are still opened locally, and stable external ids are
 * deduplicated across the transition so a row present on both sides is
 * imported once.
 */
export async function sinkAndLegacyTransactionsForConnection(
  response: OrSyncResponse | undefined,
  connectionId: string,
  legacyRows: readonly LegacyOrTransactionRow[],
  decryptLegacy: (ciphertext: string) => Promise<string>,
): Promise<{ transactions: OrImportTransaction[]; legacyFailures: number }> {
  const byId = new Map<string, OrImportTransaction>();
  for (const tx of response ? sinkTransactionsForConnection(response, connectionId) : []) {
    byId.set(tx.id, tx);
  }

  let legacyFailures = 0;
  for (const row of legacyRows) {
    if (row.connection_id !== connectionId) continue;
    try {
      const plaintext = await decryptLegacy(row.encrypted_payload);
      const tx = JSON.parse(plaintext) as OrImportTransaction;
      if (!tx.id) throw new Error("legacy transaction is missing its stable id");
      if (!byId.has(tx.id)) byId.set(tx.id, tx);
    } catch {
      legacyFailures += 1;
    }
  }

  return { transactions: Array.from(byId.values()), legacyFailures };
}

/**
 * Ask or-sync to sync these connections through the OWM response sink.
 * Refuses before exporting credentials if any connection belongs elsewhere.
 *
 * There is no legacy fallback. If sink mode is unavailable or its response is
 * not positively identified, the request fails without ever exporting or
 * sending transactions_key.
 */
export async function requestOrSync(
  subaccountId: string,
  connections: readonly OrSyncConnection[],
  handover: OrSyncHandover,
): Promise<OrSyncResponse> {
  for (const conn of connections) {
    const route = planSyncRoute(conn);
    if (route !== "or-sync") {
      throw new OrSyncRouteRefusal(route, conn.id);
    }
  }

  if (connections.length === 0) {
    return {
      synced: 0,
      connections: [],
      rows: {},
      metadata: { format: OR_SYNC_FORMAT, requires_encryption: [] },
    };
  }

  const credentials_key = await handover.exportCredentialsKey();
  const response = await handover.callProxy("or-sync", {
    subaccount_id: subaccountId,
    connection_ids: connections.map((c) => c.id),
    credentials_key,
    format: OR_SYNC_FORMAT,
  });
  assertSinkResponse(response);
  return response;
}
