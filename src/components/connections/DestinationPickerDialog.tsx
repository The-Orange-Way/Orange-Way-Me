/**
 * DestinationPickerDialog — Personal-side destination account picker (Phase 4).
 *
 * Shown after WalletPickerStep. For each selected source wallet (BTC, USD, …)
 * the user picks which Personal `accounts` row the synced transactions should
 * land in for display + future routing. A "+ New wallet" button opens the
 * inline-create dialog so users never have to leave the picker to set up a
 * destination.
 *
 * Mapping cardinality: defaults to 1:1 per wallet, but the data model
 * (connection_account_map) supports N. The Phase 4 UI exposes a single
 * select per wallet — the multi-select / split UX is a future workflow.
 *
 * No transactions are auto-created — this only writes the encrypted mapping
 * row(s). Display logic and "Routed to" badges live in the TransactionList /
 * ConnectionsPage components.
 */
import { useEffect, useMemo, useState } from "react";
import { Plus, Check, ChevronsUpDown } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toastError } from "@/lib/friendly-error";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { useAccounts } from "@/hooks/useAccounts";
import { useConnectionAccountMap } from "@/hooks/useConnectionAccountMap";
import { ACCOUNT_TYPE_LABELS } from "@/lib/connectors/constants";
import { InlineCreateAccountDialog } from "./InlineCreateAccountDialog";
import type { Account } from "@/lib/connectors/types";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export interface DestinationPickerWallet {
  external_wallet_id: string;
  /** Decrypted plaintext for display (e.g. "BTC", "USD"). */
  currency: string;
  /** Decrypted user-supplied label, if any. */
  label?: string | null;
}

interface DestinationPickerDialogProps {
  orConnectionId: string;
  /** Source wallets the user just selected in WalletPickerStep (or wants to remap). */
  wallets: DestinationPickerWallet[];
  onCancel: () => void;
  onDone: () => void;
}

export function DestinationPickerDialog({
  orConnectionId,
  wallets,
  onCancel,
  onDone,
}: DestinationPickerDialogProps) {
  const { accounts, loading: accountsLoading, refresh: refreshAccounts } = useAccounts();
  const {
    setMappingForWallet,
    getActiveAccountIds,
    refresh: refreshMap,
  } = useConnectionAccountMap();

  // wallet.external_wallet_id → selected Personal accounts.id (or empty string for none)
  const [selection, setSelection] = useState<Record<string, string>>({});
  const [createOpenForWallet, setCreateOpenForWallet] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Hydrate selection from existing mappings (edit-mapping flow) and reapply
  // when the underlying maps refresh after an inline create.
  useEffect(() => {
    setSelection((prev) => {
      const next = { ...prev };
      for (const w of wallets) {
        if (next[w.external_wallet_id]) continue;
        const existing = getActiveAccountIds(orConnectionId, w.external_wallet_id);
        if (existing.length > 0) next[w.external_wallet_id] = existing[0];
      }
      return next;
    });
  }, [wallets, orConnectionId, getActiveAccountIds]);

  async function handleConfirm() {
    setSubmitting(true);
    try {
      for (const w of wallets) {
        const accId = selection[w.external_wallet_id];
        const desired = accId ? [accId] : [];
        await setMappingForWallet(orConnectionId, w.external_wallet_id, desired);
      }
      toast.success("Destinations saved");
      onDone();
    } catch (err) {
      toastError(err, "We couldn't save your destinations. Try again.");
      setSubmitting(false);
    }
  }

  return (
    <>
      <Dialog
        open={createOpenForWallet === null}
        onOpenChange={(o) => {
          if (!o && !submitting) onCancel();
        }}
      >
        <DialogContent
          className="max-w-lg"
          onPointerDownOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>Where should these wallets land?</DialogTitle>
            <DialogDescription>
              Pick an Orange Way account for each source wallet. The mapping is encrypted with your
              vault key, so the server can&apos;t see which account belongs to which wallet.
            </DialogDescription>
          </DialogHeader>

          {wallets.length === 0 ? (
            <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
              No source wallets to map. Skip and return to the connections list.
            </div>
          ) : (
            <div className="space-y-3">
              {wallets.map((w) => (
                <WalletDestinationRow
                  key={w.external_wallet_id}
                  wallet={w}
                  accounts={accounts}
                  accountsLoading={accountsLoading}
                  selectedAccountId={selection[w.external_wallet_id] ?? ""}
                  onSelect={(id) =>
                    setSelection((prev) => ({ ...prev, [w.external_wallet_id]: id }))
                  }
                  onRequestCreate={() => setCreateOpenForWallet(w.external_wallet_id)}
                />
              ))}
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onCancel} disabled={submitting}>
              Skip for now
            </Button>
            <Button
              type="button"
              onClick={handleConfirm}
              disabled={submitting || wallets.length === 0}
            >
              {submitting ? "Saving…" : "Save destinations"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {createOpenForWallet !== null && (
        <InlineCreateAccountDialog
          defaultCurrency={
            wallets.find((w) => w.external_wallet_id === createOpenForWallet)?.currency ?? "USD"
          }
          defaultName={(() => {
            const w = wallets.find((x) => x.external_wallet_id === createOpenForWallet);
            if (!w) return "";
            const base = w.label?.trim() || `${w.currency} wallet`;
            return base;
          })()}
          onCancel={() => setCreateOpenForWallet(null)}
          onCreated={async (newId) => {
            // Auto-select the new account in the picker for the requesting wallet.
            const walletId = createOpenForWallet;
            setCreateOpenForWallet(null);
            if (walletId) {
              setSelection((prev) => ({ ...prev, [walletId]: newId }));
            }
            // useAccounts() is per-component state — InlineCreateAccountDialog's
            // internal refresh updates ITS copy; the parent's `accounts` array
            // would stay stale and the combobox wouldn't show the new wallet.
            // Refresh the parent's copy too so the new id renders selected.
            await Promise.all([refreshMap(), refreshAccounts()]);
          }}
        />
      )}
    </>
  );
}

interface WalletDestinationRowProps {
  wallet: DestinationPickerWallet;
  accounts: Account[];
  accountsLoading: boolean;
  selectedAccountId: string;
  onSelect: (accountId: string) => void;
  onRequestCreate: () => void;
}

/**
 * Soft currency-mismatch check.
 *
 * The OR sync bridge stamps `enc_currency = 'sats'` on every Bitcoin
 * row that ships sats integers (orImportBridge.pickCurrency:
 * "sats" beats the destination account's currency for sat-amount txs).
 * That means a BTC OR wallet routed to a USD Personal account ends up
 * with sats-denominated transactions sitting under a USD-labelled
 * account — totals and per-account ledgers will mix units silently.
 *
 * The fix isn't to block the mapping (sometimes users genuinely do
 * want to dump multiple currencies into one umbrella account), but to
 * surface a soft warning so the user can self-correct if the mismatch
 * was unintentional. The picker still saves the mapping; this is just
 * a UX prompt.
 */
function isCurrencyMismatch(walletCurrency: string, accountCurrency: string): boolean {
  const w = walletCurrency.trim().toUpperCase();
  const a = accountCurrency.trim().toUpperCase();
  if (!w || !a) return false;
  // sats ↔ BTC are the same asset, just different units. The orImportBridge
  // stamps "sats" for amount_sats payloads regardless of the account label.
  // Treat them as compatible.
  const isBtcLike = (s: string) => s === "BTC" || s === "SATS";
  if (isBtcLike(w) && isBtcLike(a)) return false;
  return w !== a;
}

function WalletDestinationRow({
  wallet,
  accounts,
  accountsLoading,
  selectedAccountId,
  onSelect,
  onRequestCreate,
}: WalletDestinationRowProps) {
  const [open, setOpen] = useState(false);
  const selected = useMemo(
    () => accounts.find((a) => a.id === selectedAccountId) ?? null,
    [accounts, selectedAccountId],
  );

  const sourceLabel =
    wallet.label?.trim() || (wallet.currency ? `${wallet.currency} wallet` : "Wallet");
  const mismatch = selected ? isCurrencyMismatch(wallet.currency, selected.currency) : false;

  return (
    <div
      className={cn(
        "flex flex-col gap-2 rounded-md border p-3 sm:flex-row sm:items-center sm:gap-3",
        mismatch && "border-amber-500/40 bg-amber-500/5",
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{sourceLabel}</div>
        <div className="text-xs uppercase tracking-wide text-muted-foreground">
          {wallet.currency || "?"}
        </div>
        {mismatch && selected && (
          <div className="mt-1 text-[11px] text-amber-700 dark:text-amber-400">
            Currency mismatch: source is {wallet.currency.toUpperCase()}, destination is{" "}
            {selected.currency.toUpperCase()}. Synced transactions land under this account with
            their original currency, which can mix units in reports. Pick a same-currency
            destination if that&rsquo;s not what you want.
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              role="combobox"
              aria-expanded={open}
              className="min-w-[180px] justify-between text-sm"
            >
              <span className="truncate">
                {accountsLoading ? "Loading…" : selected ? selected.name : "Pick a destination"}
              </span>
              <ChevronsUpDown className="ml-2 h-3 w-3 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[260px] p-0" align="end">
            <Command>
              <CommandInput placeholder="Search accounts…" />
              <CommandList>
                <CommandEmpty>No accounts yet.</CommandEmpty>
                <CommandGroup>
                  {accounts.map((a) => (
                    <CommandItem
                      key={a.id}
                      value={`${a.name} ${a.currency} ${ACCOUNT_TYPE_LABELS[a.type]}`}
                      onSelect={() => {
                        onSelect(a.id);
                        setOpen(false);
                      }}
                    >
                      <Check
                        className={cn(
                          "mr-2 h-4 w-4",
                          selectedAccountId === a.id ? "opacity-100" : "opacity-0",
                        )}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm">{a.name}</div>
                        <div className="truncate text-xs text-muted-foreground">
                          {ACCOUNT_TYPE_LABELS[a.type]} · {a.currency}
                        </div>
                      </div>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onRequestCreate}
          title="Create a new wallet"
        >
          <Plus className="h-3 w-3" />
          <span className="ml-1 hidden sm:inline">New</span>
        </Button>
      </div>
    </div>
  );
}
