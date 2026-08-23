/**
 * TransactionsPage — primary workhorse view.
 *
 * Pulls transactions for the current date range, decrypts them, and renders
 * them in a virtualized list. Supports search (blind-index + client substring),
 * filters, bulk actions, add/edit/split/transfer/delete.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useAsyncAction } from "@/hooks/useAsyncAction";
import { Route } from "@/routes/transactions";
import { Plus, Search, SlidersHorizontal, X, ArrowUpDown, Wallet } from "lucide-react";
import { toast } from "sonner";
import { toastError } from "@/lib/friendly-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { useAccounts } from "@/hooks/useAccounts";
import { useCategories } from "@/hooks/useCategories";
import { useRules } from "@/hooks/useRules";
import {
  useTransactions,
  type DecryptedTxn,
  type TxnDraft,
  type TransferDraft,
  type SplitChild,
} from "@/hooks/useTransactions";
import { monthRange, presetRange, type DateRange } from "@/lib/date-ranges";
import { MonthNavigator } from "./MonthNavigator";
import { TransactionsList } from "./TransactionsList";
import { BulkActionsBar } from "./BulkActionsBar";
import { FiltersDrawer, EMPTY_FILTERS, type TxnFilters } from "./FiltersDrawer";
import { TransactionFormDialog } from "./TransactionFormDialog";
import { SplitTransactionDialog } from "./SplitTransactionDialog";
import { TxnImportExportDialog } from "./TxnImportExportDialog";
import { Alert, AlertDescription } from "@/components/ui/alert";

export function TransactionsPage() {
  const { wallet: initialWallet } = Route.useSearch();
  const [anchor, setAnchor] = useState(new Date());
  const [range, setRange] = useState<DateRange>(monthRange(new Date()));
  const [search, setSearch] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filters, setFilters] = useState<TxnFilters>(() =>
    initialWallet ? { ...EMPTY_FILTERS, accountIds: [initialWallet] } : EMPTY_FILTERS,
  );
  // If the URL wallet param changes (e.g. user navigates from a different wallet),
  // reset the account filter to match.
  const prevWallet = useRef(initialWallet);
  useEffect(() => {
    if (initialWallet !== prevWallet.current) {
      prevWallet.current = initialWallet;
      setFilters((f) => ({
        ...f,
        accountIds: initialWallet ? [initialWallet] : [],
      }));
    }
  }, [initialWallet]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<DecryptedTxn | null>(null);
  const [splitting, setSplitting] = useState<DecryptedTxn | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DecryptedTxn | null>(null);
  const [confirmDelete, deleting] = useAsyncAction(async () => {
    if (!deleteTarget) return;
    try {
      await deleteTransaction(deleteTarget.id);
      toast.success("Transaction deleted");
    } catch (err) {
      toastError(err, "Delete failed");
    } finally {
      setDeleteTarget(null);
    }
  });
  const [ioOpen, setIoOpen] = useState(false);

  const { accounts } = useAccounts();
  const { categories, seedDefaults } = useCategories();
  const { apply: applyRules, recordFired } = useRules();
  const {
    items,
    loading,
    totals,
    decryptFailCount,
    createTransaction,
    createTransfer,
    updateTransaction,
    deleteTransaction,
    splitTransaction,
    bulkSetCategory,
    bulkDelete,
    bulkAddTag,
    searchByMerchant,
  } = useTransactions({ startDate: range.start, endDate: range.end });

  // Out-of-range HMAC search: when the user types a search term, also run an
  // exact-match HMAC lookup across the user's whole history. Merged with the
  // in-range substring matches so the user finds hits from any date range.
  const [hmacHits, setHmacHits] = useState<DecryptedTxn[]>([]);
  useEffect(() => {
    const q = search.trim();
    if (!q) {
      setHmacHits([]);
      return;
    }
    const tid = window.setTimeout(() => {
      searchByMerchant(q)
        .then(setHmacHits)
        .catch(() => setHmacHits([]));
    }, 350);
    return () => window.clearTimeout(tid);
  }, [search, searchByMerchant]);

  // Seed default categories the first time the user opens this page.
  useEffect(() => {
    if (categories.length === 0) void seedDefaults().catch(() => {});
  }, [categories.length, seedDefaults]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    // Merge in-range items with out-of-range HMAC hits (dedup by id).
    const byId = new Map<string, DecryptedTxn>();
    for (const t of items) byId.set(t.id, t);
    for (const t of hmacHits) if (!byId.has(t.id)) byId.set(t.id, t);
    const merged = Array.from(byId.values()).sort((a, b) => b.date.localeCompare(a.date));

    return merged.filter((t) => {
      if (filters.accountIds.length && !filters.accountIds.includes(t.account_id)) return false;
      if (
        filters.categoryIds.length &&
        (!t.category_id || !filters.categoryIds.includes(t.category_id))
      )
        return false;
      const n = Number(t.amount);
      const abs = Math.abs(n);
      if (filters.amountMin && abs < Number(filters.amountMin)) return false;
      if (filters.amountMax && abs > Number(filters.amountMax)) return false;
      if (filters.hasMemo && !t.memo) return false;
      if (filters.type === "expense" && n >= 0) return false;
      if (filters.type === "income" && n <= 0) return false;
      if (filters.type === "transfer" && !t.transfer_group_id) return false;
      if (q) {
        const blob = `${t.merchant ?? ""} ${t.description}`.toLowerCase();
        if (!blob.includes(q)) return false;
      }
      return true;
    });
  }, [items, hmacHits, filters, search]);

  const activeFilterChips = useMemo(() => {
    const chips: { id: string; label: string; onRemove: () => void }[] = [];
    filters.accountIds.forEach((id) => {
      const acc = accounts.find((a) => a.id === id);
      if (acc)
        chips.push({
          id: `acc-${id}`,
          label: `Account: ${acc.name}`,
          onRemove: () =>
            setFilters((f) => ({ ...f, accountIds: f.accountIds.filter((x) => x !== id) })),
        });
    });
    filters.categoryIds.forEach((id) => {
      const cat = categories.find((c) => c.id === id);
      if (cat)
        chips.push({
          id: `cat-${id}`,
          label: `Category: ${cat.name}`,
          onRemove: () =>
            setFilters((f) => ({ ...f, categoryIds: f.categoryIds.filter((x) => x !== id) })),
        });
    });
    if (filters.amountMin)
      chips.push({
        id: "amin",
        label: `Min: ${filters.amountMin}`,
        onRemove: () => setFilters((f) => ({ ...f, amountMin: "" })),
      });
    if (filters.amountMax)
      chips.push({
        id: "amax",
        label: `Max: ${filters.amountMax}`,
        onRemove: () => setFilters((f) => ({ ...f, amountMax: "" })),
      });
    if (filters.hasMemo)
      chips.push({
        id: "memo",
        label: "Has memo",
        onRemove: () => setFilters((f) => ({ ...f, hasMemo: false })),
      });
    if (filters.type !== "all")
      chips.push({
        id: "type",
        label: `Type: ${filters.type}`,
        onRemove: () => setFilters((f) => ({ ...f, type: "all" })),
      });
    return chips;
  }, [filters, accounts, categories]);

  const toggleSelect = (id: string) => {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleBulkCategorize = async (categoryId: string) => {
    try {
      await bulkSetCategory(Array.from(selected), categoryId);
      toast.success(`Categorized ${selected.size} transactions`);
      setSelected(new Set());
    } catch (err) {
      toastError(err, "Bulk update failed");
    }
  };

  const handleBulkDelete = async () => {
    try {
      await bulkDelete(Array.from(selected));
      toast.success(`Deleted ${selected.size} transactions`);
      setSelected(new Set());
    } catch (err) {
      toastError(err, "Bulk delete failed");
    }
  };

  const handleBulkAddTag = async (tag: string) => {
    try {
      await bulkAddTag(Array.from(selected), tag);
      toast.success(`Tagged ${selected.size} transactions`);
      setSelected(new Set());
    } catch (err) {
      toastError(err, "Add tag failed");
    }
  };

  const openAdd = () => {
    setEditing(null);
    setFormOpen(true);
  };
  const openEdit = (t: DecryptedTxn) => {
    setEditing(t);
    setFormOpen(true);
  };

  // Apply rules to a create-draft. If the user manually picked a category,
  // we set is_manual_category=true and suppress rule set_category actions.
  const withRulesApplied = (draft: TxnDraft): TxnDraft => {
    const userPickedCategory = Boolean(draft.category_id);
    const { draft: modified, firedRuleIds } = applyRules(
      {
        account_id: draft.account_id,
        date: draft.date,
        amount: draft.amount,
        description: draft.description,
        merchant: draft.merchant ?? null,
        category_id: draft.category_id ?? null,
        memo: draft.memo ?? null,
        tags: draft.tags ?? null,
      },
      { skipSetCategory: userPickedCategory },
    );
    // Best-effort fire tracking (fire-and-forget).
    for (const id of firedRuleIds) {
      void recordFired(id, 1);
    }
    return {
      ...draft,
      merchant: modified.merchant ?? draft.merchant,
      category_id: modified.category_id ?? draft.category_id,
      memo: modified.memo ?? draft.memo,
      tags: modified.tags ?? draft.tags,
      is_manual_category: userPickedCategory,
    };
  };

  const handleCreate = (draft: TxnDraft) => createTransaction(withRulesApplied(draft));
  const handleUpdate = (id: string, draft: TxnDraft) =>
    updateTransaction(id, { ...draft, is_manual_category: Boolean(draft.category_id) });
  const handleTransfer = (draft: TransferDraft) => createTransfer(draft);
  const handleSplit = (parentId: string, children: SplitChild[]) =>
    splitTransaction(parentId, children);

  return (
    <div className="space-y-5 px-4 py-4 sm:px-6 sm:py-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight">Transactions</h1>
          <p className="text-sm text-muted-foreground">
            {filtered.length} of {items.length} · Inflow{" "}
            <span className="font-mono text-emerald-600 dark:text-emerald-400">
              {totals.inflow.toFixed(2)}
            </span>{" "}
            · Outflow{" "}
            <span className="font-mono text-destructive">{totals.outflow.toFixed(2)}</span>
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:gap-2">
          <Button variant="outline" onClick={() => setIoOpen(true)} className="w-full sm:w-auto">
            <ArrowUpDown className="mr-2 h-4 w-4" /> Import / Export
          </Button>
          <Button onClick={openAdd} disabled={accounts.length === 0} className="w-full sm:w-auto">
            <Plus className="mr-2 h-4 w-4" /> Add transaction
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <MonthNavigator
          anchor={anchor}
          range={range}
          onChange={(a, r) => {
            setAnchor(a);
            setRange(r);
          }}
        />
        <div className="relative w-full sm:ml-auto sm:max-w-sm sm:flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search merchant or description…"
            className="pl-8"
          />
        </div>
        <Select
          value={filters.accountIds.length === 1 ? filters.accountIds[0] : "__all__"}
          onValueChange={(v) =>
            setFilters((f) => ({
              ...f,
              accountIds: v === "__all__" ? [] : [v],
            }))
          }
        >
          <SelectTrigger className="w-full sm:w-[180px]">
            <span className="inline-flex items-center gap-2">
              <Wallet className="h-4 w-4" />
              <SelectValue placeholder="All wallets" />
            </span>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All wallets</SelectItem>
            {accounts.map((a) => (
              <SelectItem key={a.id} value={a.id}>
                {a.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="outline" onClick={() => setFiltersOpen(true)}>
          <SlidersHorizontal className="mr-2 h-4 w-4" /> Filters
        </Button>
      </div>

      {activeFilterChips.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {activeFilterChips.map((c) => (
            <Badge key={c.id} variant="secondary" className="gap-1">
              {c.label}
              <button
                type="button"
                onClick={c.onRemove}
                className="ml-1"
                aria-label={`Remove filter: ${c.label}`}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
          <Button variant="ghost" size="sm" onClick={() => setFilters(EMPTY_FILTERS)}>
            Clear all
          </Button>
        </div>
      )}

      <BulkActionsBar
        count={selected.size}
        categories={categories}
        onClear={() => setSelected(new Set())}
        onCategorize={handleBulkCategorize}
        onAddTag={handleBulkAddTag}
        onDelete={handleBulkDelete}
      />

      {!loading && decryptFailCount > 0 && (
        <Alert variant="default" className="border-yellow-300 bg-yellow-50 text-yellow-800 dark:border-yellow-800 dark:bg-yellow-950/30 dark:text-yellow-200">
          <AlertDescription>
            {decryptFailCount} {decryptFailCount === 1 ? "row" : "rows"} could not be decrypted and are not shown. This can happen after a vault key change.
          </AlertDescription>
        </Alert>
      )}

      {loading ? (
        <div className="rounded-lg border border-border p-12 text-center text-sm text-muted-foreground">
          Decrypting transactions…
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-12 text-center text-sm text-muted-foreground space-y-3">
          {items.length > 0 ? (
            <>
              <p>
                {items.length} {items.length === 1 ? "transaction" : "transactions"} in{" "}
                {range.label} — but none match your current filters or search.
              </p>
              <div className="flex justify-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setFilters(EMPTY_FILTERS);
                    setSearch("");
                  }}
                >
                  Clear filters
                </Button>
              </div>
            </>
          ) : range.preset !== "all_time" ? (
            <>
              <p>No transactions in {range.label}.</p>
              <Button variant="outline" size="sm" onClick={() => setRange(presetRange("all_time"))}>
                View all time
              </Button>
            </>
          ) : (
            <p>No transactions yet.</p>
          )}
        </div>
      ) : (
        <TransactionsList
          items={filtered}
          accounts={accounts}
          categories={categories}
          selected={selected}
          onToggleSelect={toggleSelect}
          highlight={search}
          rowActions={{
            onEdit: openEdit,
            onSplit: (t) => setSplitting(t),
            onCategorize: (t) => {
              setSelected(new Set([t.id]));
            },
            onDelete: (t) => setDeleteTarget(t),
            onSetCategory: async (t, categoryId) => {
              await updateTransaction(t.id, {
                date: t.date,
                account_id: t.account_id,
                amount: t.amount,
                currency: t.currency,
                description: t.description,
                merchant: t.merchant,
                category_id: categoryId,
                memo: t.memo,
                tags: t.tags,
                is_manual_category: !!categoryId,
              });
            },
          }}
        />
      )}

      <FiltersDrawer
        open={filtersOpen}
        onOpenChange={setFiltersOpen}
        accounts={accounts}
        categories={categories}
        filters={filters}
        onApply={setFilters}
      />

      <TransactionFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        accounts={accounts}
        categories={categories}
        initial={editing}
        onCreate={handleCreate}
        onUpdate={handleUpdate}
        onTransfer={handleTransfer}
      />

      <SplitTransactionDialog
        open={!!splitting}
        onOpenChange={(v) => !v && setSplitting(null)}
        parent={splitting}
        categories={categories}
        onSplit={handleSplit}
      />

      <AlertDialog open={!!deleteTarget} onOpenChange={(v) => !v && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this transaction?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget?.transfer_group_id
                ? "Both halves of the transfer will be deleted."
                : deleteTarget?.is_split_parent
                  ? "All of the parent's split children will also be deleted."
                  : "This action can't be undone."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                // Prevent auto-close: we want the dialog to stay visible
                // with "Deleting…" until the async finishes. Without this
                // the dialog hides immediately and a double-click during
                // the request window fires delete twice.
                e.preventDefault();
                void confirmDelete();
              }}
              disabled={deleting}
            >
              {deleting ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <TxnImportExportDialog
        open={ioOpen}
        onOpenChange={setIoOpen}
        transactions={filtered}
        categoryMap={new Map(categories.map((c) => [c.id, c.name]))}
        accountMap={new Map(accounts.map((a) => [a.id, a.name]))}
        defaultAccountId={accounts[0]?.id ?? ""}
        onImport={async (drafts) => {
          for (const d of drafts) await createTransaction(d);
        }}
      />
    </div>
  );
}
