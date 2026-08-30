import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { ArrowLeft, Edit3, Loader2, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAccounts, AccountNotEmptyError } from "@/hooks/useAccounts";
import { useAccountTransactions } from "@/hooks/useAccountTransactions";
import { formatCurrencyWithMode } from "@/lib/format";
import { useLocaleFormat, numberLocale } from "@/lib/locale";
import { useDashboardPrefs } from "@/hooks/useDashboardPrefs";
import { ACCOUNT_TYPES, ACCOUNT_TYPE_LABELS } from "@/lib/connectors/constants";
import { TransactionsTable } from "@/components/accounts/TransactionsTable";
import type { AccountTypeKey } from "@/lib/connectors";
import { getConnector } from "@/lib/connectors";
import { toast } from "sonner";
import { toastError } from "@/lib/friendly-error";

export function AccountDetailPage() {
  const { id } = useParams({ from: "/accounts/$id" });
  const navigate = useNavigate();
  const { accounts, loading, refreshBalance, updateAccount, deleteAccount, archiveAccount } =
    useAccounts();
  const { prefs } = useDashboardPrefs();
  const fmt = useLocaleFormat();
  const loc = numberLocale(prefs.numberFormat);
  const { items, loading: txnsLoading } = useAccountTransactions(id);
  const [refreshing, setRefreshing] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // When the user clicks "Delete account" and the account has
  // transactions, we don't permanently delete on the first click.
  // Instead the dialog flips into a "has transactions" state offering
  // Archive (recommended, reversible) or Permanently delete (destructive).
  const [pendingHasTxs, setPendingHasTxs] = useState<number | null>(null);
  const [archiving, setArchiving] = useState(false);

  const account = useMemo(() => accounts.find((a) => a.id === id), [accounts, id]);
  const connector = account ? getConnector(account.connector_type) : null;

  if (loading && !account) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
        Decrypting wallet…
      </div>
    );
  }

  if (!account) {
    return (
      <div className="space-y-4 text-center">
        <h1 className="text-2xl font-semibold">Account not found</h1>
        <Button asChild variant="outline">
          <Link to="/accounts">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to wallets
          </Link>
        </Button>
      </div>
    );
  }

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await refreshBalance(account.id);
      toast.success("Balance refreshed");
    } catch (err) {
      toastError(err, "Refresh failed");
    } finally {
      setRefreshing(false);
    }
  };

  // Two-stage delete: first click triggers a transaction-count check
  // via the hook. Empty accounts delete immediately. Non-empty accounts
  // throw AccountNotEmptyError; the dialog stays open and offers
  // Archive (recommended) or Force-delete (lose all transactions).
  const handleDelete = async () => {
    setDeleting(true);
    try {
      await deleteAccount(account.id);
      toast.success("Account deleted");
      navigate({ to: "/accounts" });
    } catch (err) {
      if (err instanceof AccountNotEmptyError) {
        setPendingHasTxs(err.transactionCount);
        setDeleting(false);
        return;
      }
      toastError(err, "Delete failed");
      setDeleting(false);
    }
  };

  const handleForceDelete = async () => {
    setDeleting(true);
    try {
      await deleteAccount(account.id, { force: true });
      toast.success("Account and transactions permanently deleted");
      navigate({ to: "/accounts" });
    } catch (err) {
      toastError(err, "Delete failed");
      setDeleting(false);
    }
  };

  const handleArchive = async () => {
    setArchiving(true);
    try {
      await archiveAccount(account.id);
      toast.success(
        "Account archived. Transactions are kept; the account is hidden from the active list.",
      );
      navigate({ to: "/accounts" });
    } catch (err) {
      toastError(err, "Archive failed");
      setArchiving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="-ml-2 mb-2 h-8">
          <Link to="/accounts">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Wallets
          </Link>
        </Button>

        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-3xl font-semibold tracking-tight">{account.name}</h1>
              <Badge variant="secondary">{ACCOUNT_TYPE_LABELS[account.type] ?? account.type}</Badge>
            </div>
            {account.institution && (
              <p className="mt-1 text-sm text-muted-foreground">{account.institution}</p>
            )}
            <div className="mt-4 font-mono text-4xl font-semibold tabular-nums">
              {formatCurrency(account.balance, account.currency, loc)}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Last updated {fmt.formatDate(new Date(account.updated_at))}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            {connector?.refreshBalance && (
              <Button variant="outline" onClick={handleRefresh} disabled={refreshing}>
                {refreshing ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="mr-2 h-4 w-4" />
                )}
                Refresh balance
              </Button>
            )}
            <Button variant="outline" onClick={() => setEditOpen(true)}>
              <Edit3 className="mr-2 h-4 w-4" />
              Edit
            </Button>
            <Button
              variant="outline"
              onClick={() => setDeleteOpen(true)}
              className="text-destructive"
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Delete
            </Button>
          </div>
        </div>
      </div>

      <Tabs defaultValue="transactions">
        <TabsList>
          <TabsTrigger value="transactions">Transactions</TabsTrigger>
          <TabsTrigger value="details">Details</TabsTrigger>
          <TabsTrigger value="connector">Connector</TabsTrigger>
        </TabsList>
        <TabsContent value="transactions" className="pt-4">
          <TransactionsTable items={items} loading={txnsLoading} />
        </TabsContent>
        <TabsContent value="details" className="pt-4">
          <dl className="grid grid-cols-2 gap-y-3 rounded-lg border border-border p-4 text-sm">
            <dt className="text-muted-foreground">Currency</dt>
            <dd className="font-mono">{account.currency}</dd>
            <dt className="text-muted-foreground">Type</dt>
            <dd>{ACCOUNT_TYPE_LABELS[account.type] ?? account.type}</dd>
            <dt className="text-muted-foreground">Created</dt>
            <dd>{fmt.formatDate(new Date(account.created_at))}</dd>
            {typeof account.metadata?.balance_as_of === "string" && (
              <>
                <dt className="text-muted-foreground">Starting balance as of</dt>
                <dd>{fmt.formatDate(new Date(account.metadata.balance_as_of))}</dd>
              </>
            )}
            <dt className="text-muted-foreground">Account ID</dt>
            <dd className="font-mono text-xs">{account.id}</dd>
          </dl>
        </TabsContent>
        <TabsContent value="connector" className="pt-4">
          <div className="rounded-lg border border-border p-4 text-sm">
            <div className="font-medium">{connector?.label ?? account.connector_type}</div>
            <p className="mt-1 text-muted-foreground">{connector?.description}</p>
            {account.metadata && Object.keys(account.metadata).length > 0 && (
              <pre className="mt-3 overflow-auto rounded bg-muted p-3 text-xs">
                {JSON.stringify(account.metadata, null, 2)}
              </pre>
            )}
          </div>
        </TabsContent>
      </Tabs>

      <EditAccountDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        initial={{
          name: account.name,
          type: account.type,
          balance: account.balance,
          institution: account.institution ?? "",
        }}
        connectorType={account.connector_type}
        onSave={async (patch) => {
          await updateAccount(account.id, patch);
          toast.success("Account updated");
        }}
      />

      <Dialog
        open={deleteOpen}
        onOpenChange={(o) => {
          setDeleteOpen(o);
          if (!o) {
            // Reset the second-stage state when the dialog closes so a
            // future click starts fresh from "Delete account?" rather
            // than "Has transactions" .
            setPendingHasTxs(null);
          }
        }}
      >
        <DialogContent>
          {pendingHasTxs === null ? (
            // Stage 1: ask for confirmation, run the empty-or-not check.
            <>
              <DialogHeader>
                <DialogTitle>Delete {account.name}?</DialogTitle>
                <DialogDescription>
                  Empty accounts delete cleanly. If this account has transactions you&rsquo;ll be
                  offered an Archive option (recommended) before any data is removed.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setDeleteOpen(false)} disabled={deleting}>
                  Cancel
                </Button>
                <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
                  {deleting ? "Checking…" : "Delete account"}
                </Button>
              </DialogFooter>
            </>
          ) : (
            // Stage 2: account has transactions. Default action is Archive
            // (reversible). Force-delete is still available for users who
            // really want to lose the data.
            <>
              <DialogHeader>
                <DialogTitle>
                  {account.name} has {pendingHasTxs} transaction{pendingHasTxs === 1 ? "" : "s"}
                </DialogTitle>
                <DialogDescription>
                  <strong>Archive</strong> hides the account from the active list and keeps every
                  transaction intact. You can restore it any time from the archived view.{" "}
                  <strong>Permanently delete</strong> removes the account and erases all of its
                  transactions. This cannot be undone.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter className="flex flex-col gap-2 sm:flex-row">
                <Button
                  variant="ghost"
                  onClick={() => setDeleteOpen(false)}
                  disabled={deleting || archiving}
                >
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  onClick={handleForceDelete}
                  disabled={deleting || archiving}
                >
                  {deleting ? "Deleting…" : "Permanently delete"}
                </Button>
                <Button onClick={handleArchive} disabled={deleting || archiving}>
                  {archiving ? "Archiving…" : "Archive instead"}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function EditAccountDialog({
  open,
  onOpenChange,
  initial,
  connectorType,
  onSave,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  initial: { name: string; type: AccountTypeKey; balance: string; institution: string };
  connectorType: string;
  onSave: (patch: {
    name?: string;
    type?: AccountTypeKey;
    balance?: string;
    institution?: string | null;
  }) => Promise<void>;
}) {
  const [name, setName] = useState(initial.name);
  const [type, setType] = useState<AccountTypeKey>(initial.type);
  const [balance, setBalance] = useState(initial.balance);
  const [institution, setInstitution] = useState(initial.institution);
  const [saving, setSaving] = useState(false);
  const balanceLocked = connectorType !== "manual";

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const patch: Parameters<typeof onSave>[0] = {};
      if (name !== initial.name) patch.name = name;
      if (type !== initial.type) patch.type = type;
      if (!balanceLocked && balance !== initial.balance) patch.balance = balance;
      if (institution !== initial.institution) patch.institution = institution || null;
      if (Object.keys(patch).length) await onSave(patch);
      onOpenChange(false);
    } catch (err) {
      toastError(err, "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit account</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="ed-name">Name</Label>
            <Input id="ed-name" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="space-y-2">
            <Label>Type</Label>
            <Select value={type} onValueChange={(v) => setType(v as AccountTypeKey)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ACCOUNT_TYPES.map((t) => (
                  <SelectItem key={t.key} value={t.key}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="ed-inst">Institution</Label>
            <Input
              id="ed-inst"
              value={institution}
              onChange={(e) => setInstitution(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ed-bal">Balance</Label>
            <Input
              id="ed-bal"
              value={balance}
              onChange={(e) => setBalance(e.target.value)}
              disabled={balanceLocked}
              className="font-mono"
            />
            {balanceLocked && (
              <p className="text-xs text-muted-foreground">
                Balance is managed by the connector. Use Refresh to update.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : "Save changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
