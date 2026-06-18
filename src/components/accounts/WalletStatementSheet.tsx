/**
 * WalletStatementSheet — slide-in statement view for a single wallet.
 * Mirrors the V3 statement-popup UX: header with Delete + Reconcile, an
 * orange inputs row in reconcile mode (Statement Balance + As-of date +
 * Select All / Deselect All), Starting/Ending balance cards, the
 * transactions table with per-row Status badges, and a sticky bottom bar
 * showing Statement / Starting+Checked / Difference + Complete button.
 */
import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { toastError } from "@/lib/friendly-error";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useAccountTransactions } from "@/hooks/useAccountTransactions";
import { useVault } from "@/context/VaultContext";
import { useDashboardPrefs } from "@/hooks/useDashboardPrefs";
import { numberLocale } from "@/lib/locale";
import { formatCurrencyWithMode } from "@/lib/format";
import type { BtcDisplayMode } from "@/lib/format";
import type { Account } from "@/lib/connectors";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";

const BALANCED_EPSILON = 0.5; // sats-tolerant; float-tolerant for fiat too

// ─── Formatters ──────────────────────────────────────────────────────────────

function fmtBal(n: number, currency: string, mode: BtcDisplayMode, locale?: string): string {
  if (n < 0) return `-${formatCurrencyWithMode(Math.abs(n), currency, mode, locale)}`;
  return formatCurrencyWithMode(n, currency, mode, locale);
}

// ─── Types ───────────────────────────────────────────────────────────────────

interface Props {
  account: Account | null;
  open: boolean;
  onClose: () => void;
  /** Optional: parent refresh after a balance sync or wallet delete. */
  onRefresh?: () => void;
  /** Optional: vault-encrypted balance update. */
  updateAccount?: (id: string, patch: { balance: string }) => Promise<void>;
  /** Optional: cascading delete (transactions then account). */
  deleteAccount?: (id: string) => Promise<void>;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function WalletStatementSheet({
  account,
  open,
  onClose,
  onRefresh,
  updateAccount,
  deleteAccount,
}: Props) {
  const { prefs } = useDashboardPrefs();
  const loc = numberLocale(prefs.numberFormat);
  const { items, loading, refresh } = useAccountTransactions(account?.id);
  const { buildHouseholdSignatureFields } = useVault();

  const accountCurrency = account?.currency ?? "USD";

  // ── Reconcile state ──────────────────────────────────────────────────────
  const [reconcileMode, setReconcileMode] = useState(false);
  const [reconcileBalance, setReconcileBalance] = useState("");
  const [reconcileDate, setReconcileDate] = useState("");
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [reconciling, setReconciling] = useState(false);

  // ── Other actions ────────────────────────────────────────────────────────
  const [syncingBal, setSyncingBal] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Reset state on close / wallet change
  useEffect(() => {
    if (!open) {
      setReconcileMode(false);
      setReconcileBalance("");
      setReconcileDate("");
      setCheckedIds(new Set());
    }
  }, [open, account?.id]);

  // ── Derived data ─────────────────────────────────────────────────────────

  const startingBalance = useMemo(() => {
    const raw = account?.metadata?.starting_balance;
    return typeof raw === "number" ? raw : 0;
  }, [account]);

  const rows = useMemo(() => {
    const sorted = [...items].sort((a, b) => {
      const d = a.date.localeCompare(b.date);
      if (d !== 0) return d;
      return a.id.localeCompare(b.id);
    });
    // Running-balance accumulator. The `running +=` inside the .map callback
    // is the standard JS pattern for prefix-sums and is fully contained
    // inside this useMemo (deterministic, one pass, no observable side
    // effects outside the closure). The react-hooks/immutability rule is
    // over-zealous here — there is no React state being mutated.
    let running = startingBalance;
    return sorted.map((t) => {
      // eslint-disable-next-line react-hooks/immutability
      running += Number(t.amount) || 0;
      return { ...t, runningBalance: running };
    });
  }, [items, startingBalance]);

  const rowsNewestFirst = useMemo(() => [...rows].reverse(), [rows]);

  const endingBalance = rows.length === 0 ? startingBalance : rows[rows.length - 1].runningBalance;

  // ── Reconcile math ───────────────────────────────────────────────────────

  const checkedTotal = useMemo(() => {
    if (!reconcileMode) return 0;
    let total = 0;
    for (const t of items) {
      if (checkedIds.has(t.id)) total += Number(t.amount) || 0;
    }
    return total;
  }, [items, checkedIds, reconcileMode]);

  const reconcileBalanceNum = useMemo(() => {
    const raw = reconcileBalance.trim();
    if (!raw) return null;
    const n = parseFloat(raw.replace(/,/g, ""));
    return Number.isFinite(n) ? n : null;
  }, [reconcileBalance]);

  const reconcileDifference = useMemo(() => {
    if (reconcileBalanceNum === null) return null;
    return reconcileBalanceNum - startingBalance - checkedTotal;
  }, [reconcileBalanceNum, startingBalance, checkedTotal]);

  const isBalanced =
    reconcileDifference !== null && Math.abs(reconcileDifference) < BALANCED_EPSILON;

  // ── Handlers ─────────────────────────────────────────────────────────────

  function toggleCheck(id: string) {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAll() {
    setCheckedIds(new Set(rows.map((t) => t.id)));
  }

  function deselectAll() {
    setCheckedIds(new Set());
  }

  function exitReconcile() {
    setReconcileMode(false);
    setReconcileBalance("");
    setReconcileDate("");
    setCheckedIds(new Set());
  }

  async function completeReconciliation() {
    if (!account || !isBalanced || reconciling) return;
    setReconciling(true);
    try {
      const ids = Array.from(checkedIds);
      const { error: e } = await supabase
        .from("transactions")
        .update({ cleared_status: "reconciled", ...buildHouseholdSignatureFields() })
        .in("id", ids);
      if (e) throw new Error(e.message);
      exitReconcile();
      await refresh();
    } catch (err) {
      console.error("[WalletStatementSheet] reconcile failed", err);
    } finally {
      setReconciling(false);
    }
  }

  async function syncBalanceToStatement() {
    if (!account || !updateAccount) return;
    setSyncingBal(true);
    try {
      await updateAccount(account.id, { balance: String(endingBalance) });
      onRefresh?.();
    } catch (err) {
      console.error("[WalletStatementSheet] balance sync failed", err);
    } finally {
      setSyncingBal(false);
    }
  }

  async function confirmDelete() {
    if (!account || !deleteAccount) return;
    setDeleting(true);
    try {
      await deleteAccount(account.id);
      setDeleteOpen(false);
      onRefresh?.();
      onClose();
    } catch (err) {
      // Catch the new safety error from useAccounts.deleteAccount that
      // refuses to cascade-delete transactions silently. The proper
      // archive-or-force-delete UX lives in AccountDetailPage; from the
      // sheet we surface a prompt and let the user navigate.
      if (
        err &&
        typeof err === "object" &&
        (err as { name?: string }).name === "AccountNotEmptyError"
      ) {
        const txCount = (err as { transactionCount?: number }).transactionCount ?? 0;
        toast.warning(
          `This account has ${txCount} transaction${txCount === 1 ? "" : "s"}. Open the wallet page to archive (recommended) or permanently delete.`,
        );
        setDeleteOpen(false);
      } else {
        console.error("[WalletStatementSheet] delete failed", err);
        toastError(err, "Delete failed");
      }
    } finally {
      setDeleting(false);
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────

  const balanceMismatch =
    rows.length > 0 && Math.abs(endingBalance - Number(account?.balance ?? endingBalance)) > 0.0001;

  return (
    <>
      <Sheet
        open={open}
        onOpenChange={(o) => {
          if (!o) {
            exitReconcile();
            onClose();
          }
        }}
      >
        <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-3xl">
          {/* Header */}
          <SheetHeader className="flex-row items-start justify-between gap-3 border-b border-border px-6 py-4 pr-14">
            <div className="min-w-0">
              <SheetTitle className="truncate text-lg">
                {account?.name ?? "Account"}
                {reconcileMode && (
                  <span className="ml-2 text-sm font-normal text-muted-foreground">
                    — Reconcile
                  </span>
                )}
              </SheetTitle>
              {account && (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {accountCurrency}
                  {account.institution ? ` · ${account.institution}` : ""}
                </p>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {!reconcileMode && deleteAccount && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setDeleteOpen(true)}
                  className="h-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
                >
                  <Trash2 className="mr-1 h-3.5 w-3.5" />
                  Delete
                </Button>
              )}
              <Button
                variant={reconcileMode ? "default" : "outline"}
                size="sm"
                className="h-8"
                onClick={() => (reconcileMode ? exitReconcile() : setReconcileMode(true))}
              >
                {reconcileMode ? "Exit Reconcile" : "Reconcile"}
              </Button>
            </div>
          </SheetHeader>

          {/* Reconcile inputs row */}
          {reconcileMode && (
            <div className="flex flex-wrap items-center gap-3 border-b border-border bg-amber-50/60 px-6 py-3 dark:bg-amber-950/20">
              <label className="text-[11px] font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-400">
                Statement Balance
              </label>
              <Input
                value={reconcileBalance}
                onChange={(e) => setReconcileBalance(e.target.value)}
                placeholder={`0 ${accountCurrency}`}
                className="h-8 w-[180px] font-mono text-xs"
              />
              <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                As of
              </label>
              <Input
                type="date"
                value={reconcileDate}
                onChange={(e) => setReconcileDate(e.target.value)}
                className="h-8 w-[160px] text-xs"
              />
              <div className="flex-1" />
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={selectAll}>
                Select All
              </Button>
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={deselectAll}>
                Deselect All
              </Button>
            </div>
          )}

          {/* Body */}
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
            {loading ? (
              <div className="flex items-center justify-center py-10">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <>
                {/* Balance cards */}
                <div className="mb-4 grid grid-cols-2 gap-4">
                  <div className="rounded-lg border border-border bg-card px-4 py-3">
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                      Starting Balance
                    </p>
                    <p className="mt-1 font-mono text-lg">
                      {fmtBal(startingBalance, accountCurrency, prefs.btcDisplayMode, loc)}
                    </p>
                  </div>
                  <div className="rounded-lg border border-border bg-card px-4 py-3">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                        Ending Balance
                      </p>
                      {balanceMismatch && updateAccount && !reconcileMode && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-5 text-[10px] text-muted-foreground hover:text-foreground"
                          onClick={syncBalanceToStatement}
                          disabled={syncingBal}
                        >
                          {syncingBal ? "…" : "Sync ↑"}
                        </Button>
                      )}
                    </div>
                    <p className="mt-1 font-mono text-lg">
                      {fmtBal(endingBalance, accountCurrency, prefs.btcDisplayMode, loc)}
                    </p>
                  </div>
                </div>

                {/* Transactions table */}
                <div className="overflow-hidden rounded-lg border border-border">
                  <table className="w-full table-fixed text-sm">
                    <colgroup>
                      {reconcileMode && <col className="w-10" />}
                      <col className="w-24" />
                      <col />
                      <col className="w-36" />
                      <col className="w-36" />
                      <col className="w-28" />
                    </colgroup>
                    <thead className="border-b border-border bg-muted/30">
                      <tr>
                        {reconcileMode && <th className="px-2 py-2" />}
                        <th className="px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                          Date
                        </th>
                        <th className="px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                          Description
                        </th>
                        <th className="px-3 py-2 text-right text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                          Amount
                        </th>
                        <th className="px-3 py-2 text-right text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                          Balance
                        </th>
                        <th className="px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                          Status
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {rowsNewestFirst.length === 0 ? (
                        <tr>
                          <td
                            colSpan={reconcileMode ? 6 : 5}
                            className="py-10 text-center text-sm text-muted-foreground"
                          >
                            No transactions yet.
                          </td>
                        </tr>
                      ) : (
                        rowsNewestFirst.map((t) => {
                          const txCurrency = t.currency ?? accountCurrency;
                          const n = Number(t.amount) || 0;
                          const isNeg = n < 0;
                          const isReconciled = t.cleared_status === "reconciled";
                          const isCleared = t.cleared_status === "cleared";
                          const isChecked = checkedIds.has(t.id);

                          return (
                            <tr
                              key={t.id}
                              className={cn(
                                "transition-colors hover:bg-muted/40",
                                reconcileMode &&
                                  isChecked &&
                                  "bg-emerald-50/60 dark:bg-emerald-950/20",
                              )}
                            >
                              {reconcileMode && (
                                <td className="px-2 py-2.5 align-middle">
                                  <Checkbox
                                    checked={isChecked}
                                    onCheckedChange={() => toggleCheck(t.id)}
                                  />
                                </td>
                              )}
                              <td className="px-3 py-2.5 align-middle font-mono text-xs text-muted-foreground">
                                {t.date}
                              </td>
                              <td className="px-3 py-2.5 align-middle">
                                <div className="truncate text-sm">{t.description}</div>
                                {t.merchant && t.merchant !== t.description && (
                                  <div className="truncate text-xs text-muted-foreground">
                                    {t.merchant}
                                  </div>
                                )}
                              </td>
                              <td
                                className={cn(
                                  "whitespace-nowrap px-3 py-2.5 text-right align-middle font-mono text-xs tabular-nums",
                                  isNeg
                                    ? "text-destructive"
                                    : "text-emerald-600 dark:text-emerald-400",
                                )}
                              >
                                {`${isNeg ? "-" : "+"}${formatCurrencyWithMode(
                                  Math.abs(n),
                                  txCurrency,
                                  prefs.btcDisplayMode,
                                  loc,
                                )}`}
                              </td>
                              <td className="whitespace-nowrap px-3 py-2.5 text-right align-middle font-mono text-xs tabular-nums text-muted-foreground">
                                {fmtBal(t.runningBalance, txCurrency, prefs.btcDisplayMode, loc)}
                              </td>
                              <td className="px-3 py-2.5 align-middle">
                                {isReconciled ? (
                                  <Badge className="gap-1 bg-emerald-100 text-emerald-800 hover:bg-emerald-100 dark:bg-emerald-900/40 dark:text-emerald-300">
                                    <CheckCircle2 className="h-3 w-3" />
                                    Reconciled
                                  </Badge>
                                ) : isCleared ? (
                                  <Badge
                                    variant="outline"
                                    className="border-blue-300 text-blue-700 dark:border-blue-700 dark:text-blue-400"
                                  >
                                    Cleared
                                  </Badge>
                                ) : (
                                  <span className="text-xs text-muted-foreground">—</span>
                                )}
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>

          {/* Sticky bottom reconcile bar */}
          {reconcileMode && reconcileBalance && (
            <div
              className={cn(
                "flex items-center gap-6 border-t border-border px-6 py-3",
                isBalanced
                  ? "bg-emerald-50 dark:bg-emerald-950/20"
                  : "bg-amber-50 dark:bg-amber-950/20",
              )}
            >
              <div className="flex flex-1 gap-6 text-xs">
                <div>
                  <p className="uppercase tracking-wide text-muted-foreground">Statement</p>
                  <p className="mt-0.5 font-mono text-sm">
                    {reconcileBalanceNum !== null
                      ? fmtBal(reconcileBalanceNum, accountCurrency, prefs.btcDisplayMode, loc)
                      : "—"}
                  </p>
                </div>
                <div>
                  <p className="uppercase tracking-wide text-muted-foreground">
                    Starting + Checked
                  </p>
                  <p className="mt-0.5 font-mono text-sm">
                    {fmtBal(
                      startingBalance + checkedTotal,
                      accountCurrency,
                      prefs.btcDisplayMode,
                      loc,
                    )}
                  </p>
                </div>
                <div>
                  <p className="uppercase tracking-wide text-muted-foreground">Difference</p>
                  <p
                    className={cn(
                      "mt-0.5 flex items-center gap-1 font-mono text-sm",
                      isBalanced
                        ? "text-emerald-700 dark:text-emerald-400"
                        : "text-amber-700 dark:text-amber-400",
                    )}
                  >
                    {isBalanced ? (
                      <>
                        <CheckCircle2 className="h-4 w-4" />
                        Balanced!
                      </>
                    ) : (
                      fmtBal(reconcileDifference ?? 0, accountCurrency, prefs.btcDisplayMode, loc)
                    )}
                  </p>
                </div>
              </div>
              <Button disabled={!isBalanced || reconciling} onClick={completeReconciliation}>
                {reconciling && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
                {reconciling ? "Saving…" : isBalanced ? "Complete Reconciliation" : "Not Balanced"}
              </Button>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* Delete confirmation */}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {account?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the wallet and all of its transactions. This cannot be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void confirmDelete();
              }}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              Delete wallet
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
