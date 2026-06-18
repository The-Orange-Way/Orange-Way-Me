/**
 * InlineCreateAccountDialog — create a Personal `accounts` row from inside
 * the destination-mapping flow without leaving it (Phase 4).
 *
 * Reuses `useAccounts().createAccount` end-to-end so all encryption and
 * vault-keyed insertion happens through the same code path as the regular
 * "Add account" entry point. We do NOT duplicate encryption logic here —
 * we just collect the form fields and hand them off.
 *
 * The connector_type is hardcoded to `'manual'` because OR-driven inserts
 * are still display-only in this phase. When transactions are converted to
 * budget-tracked rows in a later phase the connector_type may evolve.
 */
import { useState } from "react";
import { format } from "date-fns";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAccounts } from "@/hooks/useAccounts";
import { ACCOUNT_TYPES, CURRENCIES } from "@/lib/connectors/constants";
import type { AccountTypeKey } from "@/lib/connectors/types";
import { toast } from "sonner";
import { toastError } from "@/lib/friendly-error";

interface InlineCreateAccountDialogProps {
  /** Defaults the currency picker to the source wallet's currency. */
  defaultCurrency?: string;
  /** Defaults the name field to a sensible suggestion. */
  defaultName?: string;
  onCancel: () => void;
  /** Called with the new account.id after successful creation. */
  onCreated: (newAccountId: string) => void;
}

const KNOWN_CURRENCIES: readonly string[] = CURRENCIES;

function pickDefaultType(currency: string): AccountTypeKey {
  // BTC/sats wallets default to bitcoin; everything else to checking.
  const c = currency.toUpperCase();
  if (c === "BTC" || c === "SATS") return "bitcoin";
  return "checking";
}

export function InlineCreateAccountDialog({
  defaultCurrency = "USD",
  defaultName = "",
  onCancel,
  onCreated,
}: InlineCreateAccountDialogProps) {
  const { createAccount } = useAccounts();
  const initialCurrency = KNOWN_CURRENCIES.includes(defaultCurrency) ? defaultCurrency : "USD";
  const [name, setName] = useState(defaultName);
  const [type, setType] = useState<AccountTypeKey>(pickDefaultType(initialCurrency));
  const [currency, setCurrency] = useState(initialCurrency);
  const [institution, setInstitution] = useState("");
  const [balance, setBalance] = useState("0.00");
  const [balanceAsOf, setBalanceAsOf] = useState(format(new Date(), "yyyy-MM-dd"));
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    try {
      const id = await createAccount("manual", {
        name: name.trim(),
        type,
        currency,
        institution: institution.trim() || null,
        balance: balance.trim() || "0",
        metadata: { balance_as_of: balanceAsOf },
      });
      toast.success("Account created");
      onCreated(id);
    } catch (err) {
      toastError(err, "We couldn't create that account.");
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o && !submitting) onCancel();
      }}
    >
      <DialogContent
        className="max-w-md"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Create a new account</DialogTitle>
          <DialogDescription>
            This adds a new account to Orange Way. All fields are encrypted with your vault key
            before being saved.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="inline-acc-name">Name</Label>
            <Input
              id="inline-acc-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Cold storage, Travel checking…"
              required
              autoFocus
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
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
              <Label>Currency</Label>
              <Select value={currency} onValueChange={setCurrency}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CURRENCIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="inline-acc-inst">Institution (optional)</Label>
            <Input
              id="inline-acc-inst"
              value={institution}
              onChange={(e) => setInstitution(e.target.value)}
              placeholder="Blink, Coinbase, Wealthsimple…"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="inline-acc-bal">Starting balance</Label>
              <Input
                id="inline-acc-bal"
                value={balance}
                inputMode="decimal"
                onChange={(e) => setBalance(e.target.value)}
                className="font-mono"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="inline-acc-bal-date">As of</Label>
              <Input
                id="inline-acc-bal-date"
                type="date"
                value={balanceAsOf}
                onChange={(e) => setBalanceAsOf(e.target.value)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onCancel} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting || !name.trim()}>
              {submitting ? "Encrypting…" : "Create account"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
