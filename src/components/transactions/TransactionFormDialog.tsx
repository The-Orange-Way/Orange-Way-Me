/**
 * TransactionFormDialog — add or edit a transaction. Supports Expense /
 * Income / Transfer toggle. For Transfer, two account selects appear and
 * the parent's createTransfer() is used. Otherwise createTransaction() or
 * updateTransaction() is invoked.
 */
import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { DateField } from "@/components/ui/date-field";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { toastError } from "@/lib/friendly-error";
import type { Account } from "@/lib/connectors";
import type { DecryptedCategory } from "@/hooks/useCategories";
import type { DecryptedTxn, TxnDraft, TransferDraft } from "@/hooks/useTransactions";
import { useAccounts } from "@/hooks/useAccounts";
import { InlineCreateAccountDialog } from "@/components/connections/InlineCreateAccountDialog";

type TxType = "expense" | "income" | "transfer";

// Number(0.00000006).toString() returns "6e-8" — JS switches to scientific
// notation for values < 1e-6, which is normal for sat-sized BTC amounts and
// unreadable in an editable input. Round-trip through toFixed(8) and strip
// trailing zeros so 0.00000006 shows as "0.00000006" while 5.5 stays "5.5".
function formatAmountForInput(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "0";
  return n.toFixed(8).replace(/\.?0+$/, "") || "0";
}

export function TransactionFormDialog({
  open,
  onOpenChange,
  accounts,
  categories,
  initial,
  onCreate,
  onUpdate,
  onTransfer,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  accounts: Account[];
  categories: DecryptedCategory[];
  initial?: DecryptedTxn | null;
  onCreate: (draft: TxnDraft) => Promise<void>;
  onUpdate: (id: string, draft: TxnDraft) => Promise<void>;
  onTransfer: (draft: TransferDraft) => Promise<void>;
}) {
  const isEdit = Boolean(initial);
  const initialAmt = initial ? Number(initial.amount) : 0;
  const initialType: TxType = initialAmt >= 0 ? "income" : "expense";

  const [txType, setTxType] = useState<TxType>(initialType);
  const [date, setDate] = useState(initial?.date ?? format(new Date(), "yyyy-MM-dd"));
  const [accountId, setAccountId] = useState(initial?.account_id ?? accounts[0]?.id ?? "");
  const [toAccountId, setToAccountId] = useState(accounts[1]?.id ?? "");
  const [amount, setAmount] = useState(initial ? Math.abs(initialAmt).toString() : "");
  const [merchant, setMerchant] = useState(initial?.merchant ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [categoryId, setCategoryId] = useState<string>(initial?.category_id ?? "__none");
  const [memo, setMemo] = useState(initial?.memo ?? "");
  const [tagsInput, setTagsInput] = useState((initial?.tags ?? []).join(", "));
  const [submitting, setSubmitting] = useState(false);
  // Sentinel + inline-create flow for the account dropdowns. `createTarget`
  // tells the dialog which select to populate after the new account lands.
  const NEW_SENTINEL = "__new_account__";
  const [createTarget, setCreateTarget] = useState<"from" | "to" | "account" | null>(null);
  // The parent passes `accounts` as a prop (frozen snapshot). When the user
  // creates a new wallet inline we need it to appear in the dropdown without
  // closing the modal. Merge the parent's prop with this modal's live hook
  // data so the new id renders by name as soon as refresh resolves.
  const { accounts: liveAccounts, refresh: refreshAccounts } = useAccounts();
  const mergedAccounts = useMemo(() => {
    const m = new Map(accounts.map((a) => [a.id, a]));
    for (const a of liveAccounts) m.set(a.id, a);
    return Array.from(m.values());
  }, [accounts, liveAccounts]);

  useEffect(() => {
    if (!open) return;
    setTxType(initialType);
    setDate(initial?.date ?? format(new Date(), "yyyy-MM-dd"));
    setAccountId(initial?.account_id ?? accounts[0]?.id ?? "");
    setToAccountId(
      accounts.find((a) => a.id !== (initial?.account_id ?? accounts[0]?.id))?.id ?? "",
    );
    setAmount(initial ? formatAmountForInput(Math.abs(initialAmt)) : "");
    setMerchant(initial?.merchant ?? "");
    setDescription(initial?.description ?? "");
    setCategoryId(initial?.category_id ?? "__none");
    setMemo(initial?.memo ?? "");
    setTagsInput((initial?.tags ?? []).join(", "));
  }, [open, initial, accounts, initialAmt, initialType]);

  const sortedCats = useMemo(
    () => [...categories].sort((a, b) => a.name.localeCompare(b.name)),
    [categories],
  );

  // Currency to display in the Amount input suffix — derived from the
  // selected wallet so the user always knows what unit they're entering.
  const selectedWallet = mergedAccounts.find((a) => a.id === accountId);
  const amountCurrency = selectedWallet?.currency ?? "";

  const submit = async () => {
    if (!accountId) return toast.error("Pick an account");
    const numAmt = Number(amount);
    if (!Number.isFinite(numAmt) || numAmt <= 0) return toast.error("Enter a positive amount");
    if (!description.trim()) return toast.error("Description is required");

    setSubmitting(true);
    try {
      if (txType === "transfer") {
        if (isEdit) {
          toast.error("Editing a transfer isn't supported yet. Delete and recreate it.");
          return;
        }
        await onTransfer({
          date,
          fromAccountId: accountId,
          toAccountId,
          amount: amount,
          description: description.trim(),
          category_id: categoryId === "__none" ? null : categoryId,
          memo: memo.trim() || null,
        });
      } else {
        const signed = txType === "expense" ? -Math.abs(numAmt) : Math.abs(numAmt);
        const tags = tagsInput
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean);
        const draft: TxnDraft = {
          date,
          account_id: accountId,
          amount: signed.toString(),
          description: description.trim(),
          merchant: merchant.trim() || null,
          category_id: categoryId === "__none" ? null : categoryId,
          memo: memo.trim() || null,
          tags: tags.length ? tags : null,
        };
        if (isEdit && initial) await onUpdate(initial.id, draft);
        else await onCreate(draft);
      }
      toast.success(isEdit ? "Transaction updated" : "Transaction added");
      onOpenChange(false);
    } catch (err) {
      toastError(err, "Save failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{isEdit ? "Edit transaction" : "Add transaction"}</DialogTitle>
          </DialogHeader>

          {!isEdit && (
            <div className="grid grid-cols-3 gap-1 rounded-md bg-muted p-1">
              {(["expense", "income", "transfer"] as TxType[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  className={`rounded px-3 py-1.5 text-sm capitalize transition-colors ${
                    txType === t ? "bg-background shadow-sm font-medium" : "text-muted-foreground"
                  }`}
                  onClick={() => setTxType(t)}
                >
                  {t}
                </button>
              ))}
            </div>
          )}

          <div className="grid gap-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Date</Label>
                <DateField value={date} onChange={setDate} />
              </div>
              <div>
                <Label>Amount</Label>
                <div className="relative">
                  <Input
                    type="text"
                    inputMode="decimal"
                    value={amount}
                    onChange={(e) => {
                      // Permit digits, one decimal point, and optional leading minus
                      const v = e.target.value;
                      if (v === "" || /^-?\d*\.?\d*$/.test(v)) setAmount(v);
                    }}
                    placeholder="0.00"
                    className={amountCurrency ? "pr-14" : undefined}
                  />
                  {amountCurrency && (
                    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium text-muted-foreground">
                      {amountCurrency}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {txType === "transfer" ? (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>From account</Label>
                  <Select
                    value={accountId}
                    onValueChange={(v) => {
                      if (v === NEW_SENTINEL) setCreateTarget("from");
                      else setAccountId(v);
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NEW_SENTINEL} className="font-medium text-primary">
                        <span className="inline-flex items-center gap-2">
                          <Plus className="h-3.5 w-3.5" />
                          New account
                        </span>
                      </SelectItem>
                      {mergedAccounts.map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          {a.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>To account</Label>
                  <Select
                    value={toAccountId}
                    onValueChange={(v) => {
                      if (v === NEW_SENTINEL) setCreateTarget("to");
                      else setToAccountId(v);
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NEW_SENTINEL} className="font-medium text-primary">
                        <span className="inline-flex items-center gap-2">
                          <Plus className="h-3.5 w-3.5" />
                          New account
                        </span>
                      </SelectItem>
                      {mergedAccounts.map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          {a.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            ) : (
              <div>
                <Label>Account</Label>
                <Select
                  value={accountId}
                  onValueChange={(v) => {
                    if (v === NEW_SENTINEL) setCreateTarget("account");
                    else setAccountId(v);
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NEW_SENTINEL} className="font-medium text-primary">
                      <span className="inline-flex items-center gap-2">
                        <Plus className="h-3.5 w-3.5" />
                        New account
                      </span>
                    </SelectItem>
                    {mergedAccounts.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {txType !== "transfer" && (
              <div>
                <Label>Merchant</Label>
                <Input
                  value={merchant}
                  onChange={(e) => setMerchant(e.target.value)}
                  placeholder="e.g. Starbucks"
                />
              </div>
            )}

            <div>
              <Label>Description</Label>
              <Input value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>

            <div>
              <Label>Category</Label>
              <Select value={categoryId} onValueChange={setCategoryId}>
                <SelectTrigger>
                  <SelectValue placeholder="Uncategorized" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">Uncategorized</SelectItem>
                  {sortedCats.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {txType !== "transfer" && (
              <div>
                <Label>Tags (comma-separated)</Label>
                <Input value={tagsInput} onChange={(e) => setTagsInput(e.target.value)} />
              </div>
            )}

            <div>
              <Label>Memo</Label>
              <Textarea value={memo} onChange={(e) => setMemo(e.target.value)} rows={2} />
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={submitting}>
              {submitting ? "Saving…" : isEdit ? "Save changes" : "Add"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {createTarget !== null && (
        <InlineCreateAccountDialog
          onCancel={() => setCreateTarget(null)}
          onCreated={async (newId) => {
            const target = createTarget;
            setCreateTarget(null);
            if (target === "from" || target === "account") setAccountId(newId);
            else if (target === "to") setToAccountId(newId);
            // useAccounts() is per-component state — InlineCreateAccountDialog's
            // internal refresh updates ITS copy, not the parent's. Pull the new
            // account into THIS modal's accounts list so the dropdown shows it
            // selected by name (not just by id).
            await refreshAccounts();
          }}
        />
      )}
    </>
  );
}
