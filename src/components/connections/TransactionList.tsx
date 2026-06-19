/**
 * TransactionList — per-connection encrypted transaction display.
 *
 * Renders the "Routed to" column derived from the client-side
 * connection_account_map: each transaction's decrypted
 * `source_wallet_id` is looked up against the user's mapping to find
 * the destination account.
 *
 * Phase 5 update: each row now also shows an "in ledger" check next to
 * the routed-to badge once the OR transaction has been folded into the
 * `transactions` table by `orImportBridge`. The lookup is a single
 * batched query keyed on `external_id` so per-row queries don't pile
 * up. Manual-only (unmapped) rows simply never get the check.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, ArrowDownLeft, ArrowUpRight, CheckCircle2 } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import type { Account } from "@/lib/connectors/types";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { fetchImportedExternalIds } from "@/lib/orImportBridge";
import { humanizeError } from "@/lib/friendly-error";

interface DecryptedTx {
  id: string;
  adapter: string;
  direction: "in" | "out";
  type: "lightning" | "onchain" | "trade" | "deposit" | "withdrawal" | "fee";
  amount_sats?: number;
  amount?: number;
  currency?: string;
  description?: string | null;
  counterparty?: string | null;
  status?: string;
  timestamp: string;
  /**
   * Stamped on each tx by or-sync starting in commit 88b01b3 — null on
   * pre-discovery connections (legacy account-wide path) which is the
   * "wallet membership unknown" state.
   */
  source_wallet_id: string | null;
}

export interface EncryptedTxRow {
  id: string;
  connection_id: string;
  external_id: string;
  encrypted_payload: string;
  occurred_at: string;
}

interface DisplayTx {
  rowId: string;
  occurredAt: string;
  payload: DecryptedTx | null;
  decryptError: string | null;
}

export interface TransactionListProps {
  /** The OR connection these transactions belong to. Used for mapping lookup. */
  orConnectionId: string;
  /** Caller invokes the ow-or-proxy `or-transactions-list` endpoint and filters by connection. */
  fetchEncrypted: () => Promise<EncryptedTxRow[]>;
  /** Decrypts a single encrypted_payload (base64 IV+ciphertext) using ORT. */
  decrypt: (ciphertext: string) => Promise<string>;
  /**
   * Resolve a Personal accounts.id (UUID) to its decrypted Account, or null
   * if missing. Backed by useAccounts() in the parent.
   */
  resolveAccount: (accountId: string) => Account | null;
  /**
   * Resolve a (connection, source_wallet_id) pair to one or more Personal
   * accounts.id values. Backed by useConnectionAccountMap.getActiveAccountIds.
   */
  resolveMapping: (orConnectionId: string, sourceWalletId: string) => string[];
  /** Bumped by parent when sync finishes, to trigger a refetch. */
  refreshKey?: number;
}

export function TransactionList({
  orConnectionId,
  fetchEncrypted,
  decrypt,
  resolveAccount,
  resolveMapping,
  refreshKey,
}: TransactionListProps) {
  const { user } = useAuth();
  const [rows, setRows] = useState<DisplayTx[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Phase 5 — set of OR external_ids that already exist in the local
  // `transactions` table. Looked up in one batch query when `rows` is
  // populated, then handed to each row for the "in ledger" badge.
  // Empty set means "lookup not done yet" OR "nothing imported" — the
  // badge simply won't render. This is cheaper than per-row queries
  // (one round-trip vs. N) and immune to the `useTransactions` cache.
  const [importedIds, setImportedIds] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const encrypted = await fetchEncrypted();
      const decoded = await Promise.all(
        encrypted.map(async (r): Promise<DisplayTx> => {
          try {
            const json = await decrypt(r.encrypted_payload);
            const payload = JSON.parse(json) as DecryptedTx;
            return { rowId: r.id, occurredAt: r.occurred_at, payload, decryptError: null };
          } catch (err) {
            return {
              rowId: r.id,
              occurredAt: r.occurred_at,
              payload: null,
              decryptError: err instanceof Error ? err.message : String(err),
            };
          }
        }),
      );
      setRows(decoded);
    } catch (err) {
      setError(humanizeError(err, "We couldn't load these transactions."));
      setRows(null);
    } finally {
      setLoading(false);
    }
  }, [fetchEncrypted, decrypt]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  // Single batched lookup for the "in ledger" badge. Re-runs whenever
  // the decoded rows change (new sync, new mapping, vault unlock).
  // Pull the OR transaction id (`payload.id`) from each row and ask
  // the bridge which ones are already on our side.
  useEffect(() => {
    if (!user || !rows || rows.length === 0) {
      setImportedIds(new Set());
      return;
    }
    const externalIds = rows.map((r) => r.payload?.id).filter((id): id is string => Boolean(id));
    if (externalIds.length === 0) {
      setImportedIds(new Set());
      return;
    }
    let cancelled = false;
    void (async () => {
      const set = await fetchImportedExternalIds(externalIds, {
        supabase,
        userId: user.id,
      });
      if (!cancelled) setImportedIds(set);
    })();
    return () => {
      cancelled = true;
    };
  }, [user, rows, refreshKey]);

  const visibleRows = useMemo(() => rows ?? [], [rows]);

  if (loading && rows === null) {
    return (
      <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
        Loading transactions…
      </div>
    );
  }

  if (error) {
    return (
      <div className="py-2 text-xs text-destructive">Failed to load transactions: {error}</div>
    );
  }

  if (visibleRows.length === 0) {
    return (
      <div className="py-2 text-xs text-muted-foreground">
        No transactions yet — click Sync to fetch the latest from your provider.
      </div>
    );
  }

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[150px]">Date</TableHead>
            <TableHead className="text-right">Amount</TableHead>
            <TableHead>Memo</TableHead>
            <TableHead className="w-[140px]">Wallet</TableHead>
            <TableHead className="w-[160px]">Routed to</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {visibleRows.map((r) => (
            <TransactionRow
              key={r.rowId}
              tx={r}
              orConnectionId={orConnectionId}
              resolveAccount={resolveAccount}
              resolveMapping={resolveMapping}
              isImported={r.payload ? importedIds.has(r.payload.id) : false}
            />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

interface TransactionRowProps {
  tx: DisplayTx;
  orConnectionId: string;
  resolveAccount: (accountId: string) => Account | null;
  resolveMapping: (orConnectionId: string, sourceWalletId: string) => string[];
  /** Phase 5: true iff this OR transaction has already been folded
   *  into the local `transactions` table — drives the small "in
   *  ledger" check next to the routed-to column. */
  isImported: boolean;
}

function TransactionRow({
  tx,
  orConnectionId,
  resolveAccount,
  resolveMapping,
  isImported,
}: TransactionRowProps) {
  const date = formatDate(tx.occurredAt);

  if (!tx.payload) {
    return (
      <TableRow>
        <TableCell className="text-xs text-muted-foreground">{date}</TableCell>
        <TableCell className="text-right text-xs text-destructive">decrypt failed</TableCell>
        <TableCell className="max-w-[280px] truncate text-xs text-muted-foreground" colSpan={3}>
          {tx.decryptError}
        </TableCell>
      </TableRow>
    );
  }

  const p = tx.payload;
  const isIn = p.direction === "in";
  const Icon = isIn ? ArrowDownLeft : ArrowUpRight;
  const sign = isIn ? "+" : "−";
  const amountText =
    typeof p.amount_sats === "number"
      ? `${formatNumber(p.amount_sats)} sats`
      : typeof p.amount === "number"
        ? `${formatMoney(p.amount)} ${p.currency ?? ""}`.trim()
        : "—";
  // Prefer the cleaner counterparty (merchant) over the raw bank-text
  // description. For Quiltt rows the decrypt wrapper now writes a parsed
  // merchant to counterparty, so this shows "Mercury Credit" not
  // "IO AUTOPAY; Merchant name: Mercury Credit".
  const memo = p.counterparty || p.description || (p.type ? capitalize(p.type) : "");

  // Wallet column — show short id of the source wallet (or "—" for legacy
  // pre-discovery rows where source_wallet_id is null).
  const walletShort = p.source_wallet_id ? `${p.source_wallet_id.slice(0, 8)}…` : null;

  // Routed to — look up the encrypted mapping; resolve the first active
  // accountId to its decrypted name. Multiple matches mean the user has set
  // up a 1:N split (rare in Phase 4); we show "+N" suffix.
  let routedNode: React.ReactNode = (
    <span className="text-xs italic text-muted-foreground">unmapped</span>
  );
  if (p.source_wallet_id) {
    const accountIds = resolveMapping(orConnectionId, p.source_wallet_id);
    const accounts = accountIds
      .map((id) => resolveAccount(id))
      .filter((a): a is Account => a !== null);
    if (accounts.length > 0) {
      const primary = accounts[0];
      const extra = accounts.length - 1;
      routedNode = (
        <Badge variant="outline" className="font-normal">
          <span className="truncate">{primary.name}</span>
          {extra > 0 && <span className="ml-1 text-muted-foreground">+{extra}</span>}
        </Badge>
      );
    }
  }

  return (
    <TableRow>
      <TableCell className="whitespace-nowrap text-xs">{date}</TableCell>
      <TableCell className="whitespace-nowrap text-right text-xs">
        <span
          className={`inline-flex items-center gap-1 font-medium ${
            isIn ? "text-green-600 dark:text-green-400" : "text-foreground"
          }`}
        >
          <Icon className="h-3 w-3" />
          {sign}
          {amountText}
        </span>
      </TableCell>
      <TableCell className="max-w-[260px] truncate text-xs text-muted-foreground">
        {memo || <span className="italic">no memo</span>}
      </TableCell>
      <TableCell className="font-mono text-[11px] text-muted-foreground">
        {walletShort ?? <span className="italic">—</span>}
      </TableCell>
      <TableCell className="text-xs">
        <div className="flex items-center gap-1.5">
          {routedNode}
          {isImported && (
            <span
              className="inline-flex items-center gap-0.5 text-[10px] text-green-600 dark:text-green-400"
              title="Imported into your wallet ledger"
            >
              <CheckCircle2 className="h-3 w-3" />
              in ledger
            </span>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function formatNumber(n: number): string {
  return n.toLocaleString();
}

function formatMoney(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
