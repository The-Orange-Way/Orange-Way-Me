import { useEffect, useMemo, useState } from "react";
import { ArchiveRestore, Plus, Wallet } from "lucide-react";
import { toast } from "sonner";
import { toastError } from "@/lib/friendly-error";
import { Button } from "@/components/ui/button";
import { useAccounts } from "@/hooks/useAccounts";
import { useConnectionAccountMap } from "@/hooks/useConnectionAccountMap";
import { useOrConnectionsList } from "@/hooks/useOrConnectionsList";
import { ACCOUNT_TYPE_LABELS, ACCOUNT_TYPE_ORDER } from "@/lib/connectors/constants";
import {
  formatTotalsWithMode,
  isBitcoinCurrency,
  normalizeBitcoinToSats,
  sumByCurrency,
  toAccountSubtotalEntries,
  toBalanceEntry,
} from "@/lib/format";
import { AccountCard, type AccountConnectionStatus } from "@/components/accounts/AccountCard";
import { AddAccountDialog } from "@/components/accounts/AddAccountDialog";
import { WalletStatementSheet } from "@/components/accounts/WalletStatementSheet";
import type { Account, AccountTypeKey } from "@/lib/connectors";
import { useDashboardPrefs } from "@/hooks/useDashboardPrefs";
import { numberLocale } from "@/lib/locale";
import { useTransactions } from "@/hooks/useTransactions";

export function AccountsPage() {
  const {
    accounts,
    loading,
    error,
    refresh,
    updateAccount,
    deleteAccount,
    restoreAccount,
    listArchivedAccounts,
  } = useAccounts();
  const { rows: mapRows } = useConnectionAccountMap();
  const { result: orResult } = useOrConnectionsList();
  const { prefs } = useDashboardPrefs();

  // For the "live balance" fallback: when a wallet's stored balance is $0
  // but we've imported transactions for it, show the running sum so the user
  // doesn't stare at $0 forever. We pull 5 years; banks rarely expose older.
  const fiveYearsAgo = useMemo(() => {
    const d = new Date();
    d.setFullYear(d.getFullYear() - 5);
    return d.toISOString().slice(0, 10);
  }, []);
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const { items: allTxns } = useTransactions({ startDate: fiveYearsAgo, endDate: today });
  const currencyByAccount = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of accounts) m.set(a.id, a.currency);
    return m;
  }, [accounts]);
  const txnSumByAccount = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of allTxns) {
      const n = Number(t.amount);
      if (!Number.isFinite(n)) continue;
      // Normalize each row BEFORE adding it. One bitcoin account can hold a
      // hand-entered decimal BTC row next to imported sats rows, and adding
      // those raw gives a number in no unit at all, which the display
      // heuristic then reads as decimal BTC and inflates by 1e8. Bitcoin
      // accounts accumulate in sats; everything else stays in its own unit.
      const cur = currencyByAccount.get(t.account_id);
      const v = cur && isBitcoinCurrency(cur) ? normalizeBitcoinToSats(n, cur) : n;
      m.set(t.account_id, (m.get(t.account_id) ?? 0) + v);
    }
    return m;
  }, [allTxns, currencyByAccount]);
  const loc = numberLocale(prefs.numberFormat);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [statementAccount, setStatementAccount] = useState<Account | null>(null);

  // Per-account OR connection status. Walks every active mapping, looks
  // up the connection it points at, and aggregates statuses (worst
  // status wins: error > disconnected > active). Accounts not fed by
  // any OR connection don't appear in the map, and AccountCard hides the
  // badge when status is undefined.
  const accountConnectionStatus = useMemo(() => {
    const out = new Map<string, AccountConnectionStatus>();
    if (mapRows.length === 0) return out;

    // OR was unreachable: we know which accounts are fed by an OR
    // connection but not their real status. Surface an explicit
    // "unknown" badge on those, never a silent healthy.
    if (orResult.state === "unreadable") {
      for (const row of mapRows) {
        if (!row.is_active) continue;
        const prev = out.get(row.account_id);
        out.set(row.account_id, {
          status: "unknown",
          lastError: null,
          lastSyncAt: null,
          connectionCount: (prev?.connectionCount ?? 0) + 1,
        });
      }
      return out;
    }

    // Vault locked or OR never provisioned: nothing OR-side to surface.
    if (orResult.state !== "loaded") return out;

    const orConnections = orResult.connections;
    if (orConnections.length === 0) return out;
    const connById = new Map(orConnections.map((c) => [c.connectionId, c]));
    const STATUS_RANK: Record<AccountConnectionStatus["status"], number> = {
      error: 3,
      disconnected: 2,
      active: 1,
      unknown: 0,
    };
    for (const row of mapRows) {
      if (!row.is_active) continue;
      const conn = connById.get(row.or_connection_id);
      if (!conn) continue;
      const prev = out.get(row.account_id);
      const candidate: AccountConnectionStatus = {
        status: conn.status,
        lastError: conn.lastError,
        lastSyncAt: conn.lastSyncAt,
        connectionCount: 1,
      };
      if (!prev) {
        out.set(row.account_id, candidate);
        continue;
      }
      // Worse-status wins; tie → keep the most recent lastSyncAt.
      const prevRank = STATUS_RANK[prev.status];
      const candRank = STATUS_RANK[conn.status];
      const merged: AccountConnectionStatus = {
        status: candRank > prevRank ? conn.status : prev.status,
        lastError: candRank >= prevRank ? conn.lastError : prev.lastError,
        lastSyncAt:
          (conn.lastSyncAt ?? "") > (prev.lastSyncAt ?? "") ? conn.lastSyncAt : prev.lastSyncAt,
        connectionCount: prev.connectionCount + 1,
      };
      out.set(row.account_id, merged);
    }
    return out;
  }, [orResult, mapRows]);
  // Archived view is opt-in. Loaded lazily on first toggle so the
  // page's first paint doesn't pay for a second decrypt pass.
  const [showArchived, setShowArchived] = useState(false);
  const [archivedLoading, setArchivedLoading] = useState(false);
  const [archivedAccounts, setArchivedAccounts] = useState<Account[]>([]);
  const [restoringId, setRestoringId] = useState<string | null>(null);

  useEffect(() => {
    if (!showArchived) return;
    let cancelled = false;
    setArchivedLoading(true);
    (async () => {
      try {
        const list = await listArchivedAccounts();
        if (!cancelled) setArchivedAccounts(list);
      } catch (err) {
        if (!cancelled) {
          toastError(err, "Could not load archived accounts");
          setShowArchived(false);
        }
      } finally {
        if (!cancelled) setArchivedLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [showArchived, listArchivedAccounts, accounts.length]);

  async function handleRestore(id: string) {
    setRestoringId(id);
    try {
      await restoreAccount(id);
      // Refresh archived list so the restored account drops out of it.
      const list = await listArchivedAccounts();
      setArchivedAccounts(list);
      toast.success("Account restored");
    } catch (err) {
      toastError(err, "Restore failed");
    } finally {
      setRestoringId(null);
    }
  }

  const grouped = useMemo(() => {
    const map = new Map<AccountTypeKey, Account[]>();
    for (const a of accounts) {
      // Normalize any unrecognized type to "other" so an account never
      // silently vanishes from the page (e.g. bank accounts that were
      // saved with a non-standard type like "bank").
      const key: AccountTypeKey = ACCOUNT_TYPE_ORDER.includes(a.type) ? a.type : "other";
      const list = map.get(key) ?? [];
      list.push(a);
      map.set(key, list);
    }
    return ACCOUNT_TYPE_ORDER.filter((k) => map.has(k)).map((k) => ({
      type: k,
      items: map.get(k)!,
    }));
  }, [accounts]);

  const netWorthLabel = useMemo(
    () =>
      formatTotalsWithMode(
        // toBalanceEntry carries format_version through and applies the same
        // live-balance fallback as the AccountCard: when stored is exactly $0
        // but transactions exist, their sum stands in. Keeps the net worth in
        // sync with what the user sees on each card.
        sumByCurrency(accounts.map((a) => toBalanceEntry(a, txnSumByAccount.get(a.id)))),
        prefs.btcDisplayMode,
        loc,
      ),
    [accounts, prefs.btcDisplayMode, loc, txnSumByAccount],
  );

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
        Decrypting accounts…
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
        {error}
      </div>
    );
  }

  if (accounts.length === 0) {
    return (
      <>
        <div className="space-y-6 px-4 py-4 sm:px-6 sm:py-6">
          <h1 className="text-3xl font-semibold tracking-tight">Accounts</h1>
          <div className="mx-auto max-w-xl rounded-2xl border border-border bg-card p-10 text-center shadow-card">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
              <Wallet className="h-6 w-6 text-primary" />
            </div>
            <h2 className="mt-4 text-xl font-semibold">Let's add your first account</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Manually, from a CSV statement, or by watching a Bitcoin xpub.
            </p>
            <div className="mt-6 flex flex-col items-center justify-center gap-2 sm:flex-row">
              <Button onClick={() => setDialogOpen(true)} size="lg">
                <Plus className="mr-2 h-4 w-4" />
                Add account
              </Button>
            </div>
          </div>
        </div>
        <AddAccountDialog open={dialogOpen} onOpenChange={setDialogOpen} />
      </>
    );
  }

  return (
    <>
      <div className="space-y-8 px-4 py-4 sm:px-6 sm:py-6">
        <header className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-3xl font-semibold tracking-tight">Accounts</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Net worth: <span className="font-mono tabular-nums">{netWorthLabel}</span>
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowArchived((s) => !s)}
              className="w-full sm:w-auto"
            >
              <ArchiveRestore className="mr-2 h-4 w-4" />
              {showArchived ? "Hide archived" : "Show archived"}
            </Button>
            <Button onClick={() => setDialogOpen(true)} className="w-full sm:w-auto">
              <Plus className="mr-2 h-4 w-4" />
              Add account
            </Button>
          </div>
        </header>

        <div className="space-y-8">
          {grouped.map((group) => {
            // Same live-balance fallback as the net worth line above: pass each
            // account's transaction sum so a zero stored balance is not counted
            // as zero here while counting correctly there.
            const totals = sumByCurrency(toAccountSubtotalEntries(group.items, txnSumByAccount));
            return (
              <section key={group.type}>
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                    {ACCOUNT_TYPE_LABELS[group.type]}
                  </h2>
                  <span className="font-mono text-sm tabular-nums text-muted-foreground">
                    {formatTotalsWithMode(totals, prefs.btcDisplayMode, loc)}
                  </span>
                </div>
                <div className="space-y-2">
                  {group.items.map((a) => (
                    <AccountCard
                      key={a.id}
                      account={a}
                      onStatement={setStatementAccount}
                      connectionStatus={accountConnectionStatus.get(a.id)}
                      txnSum={txnSumByAccount.get(a.id)}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>

        {showArchived && (
          <section className="rounded-lg border border-dashed border-border/60 bg-muted/20 p-4">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                  Archived accounts
                </h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Hidden from the active list and excluded from totals. Transactions are kept
                  intact. Restore to bring them back.
                </p>
              </div>
            </div>
            {archivedLoading ? (
              <div className="text-sm text-muted-foreground">Loading archived accounts&hellip;</div>
            ) : archivedAccounts.length === 0 ? (
              <div className="text-sm text-muted-foreground">
                No archived accounts. Archive an account to keep its history without showing it in
                your active list.
              </div>
            ) : (
              <ul className="space-y-2">
                {archivedAccounts.map((a) => (
                  <li
                    key={a.id}
                    className="flex items-center justify-between rounded-md border border-border bg-background px-4 py-3"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{a.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {ACCOUNT_TYPE_LABELS[a.type]}
                        {a.institution ? ` · ${a.institution}` : ""}
                        {` · ${a.currency}`}
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void handleRestore(a.id)}
                      disabled={restoringId === a.id}
                    >
                      <ArchiveRestore className="mr-1 h-3.5 w-3.5" />
                      {restoringId === a.id ? "Restoring…" : "Restore"}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>
      <AddAccountDialog open={dialogOpen} onOpenChange={setDialogOpen} />
      <WalletStatementSheet
        account={statementAccount}
        open={statementAccount !== null}
        onClose={() => setStatementAccount(null)}
        updateAccount={updateAccount}
        deleteAccount={deleteAccount}
        onRefresh={refresh}
      />
    </>
  );
}
