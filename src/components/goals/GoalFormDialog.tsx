/**
 * Create / edit a goal. Supports both Save Up and Pay Down.
 */
import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateField } from "@/components/ui/date-field";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAccounts } from "@/hooks/useAccounts";
import type { Goal, GoalDraft, GoalType, PayDownStrategy, SaveUpStrategy } from "@/hooks/useGoals";
import { toast } from "sonner";
import { toastError } from "@/lib/friendly-error";
import { PiggyBank, Banknote } from "lucide-react";
import { numberLocale } from "@/lib/locale";
import { formatCurrencyWithMode } from "@/lib/format";
import { useDashboardPrefs } from "@/hooks/useDashboardPrefs";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initial?: Goal | null;
  onSave: (draft: GoalDraft) => Promise<void>;
}

export function GoalFormDialog({ open, onOpenChange, initial, onSave }: Props) {
  const { accounts } = useAccounts();
  const { prefs } = useDashboardPrefs();
  const loc = numberLocale(prefs.numberFormat);
  const [type, setType] = useState<GoalType>("save_up");
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const [targetDate, setTargetDate] = useState("");
  const [linked, setLinked] = useState<string[]>([]);
  const [saveStrategy, setSaveStrategy] = useState<SaveUpStrategy>("all_balance");
  const [allocation, setAllocation] = useState("");
  const [startingBalance, setStartingBalance] = useState("");
  const [interest, setInterest] = useState("");
  const [minPayment, setMinPayment] = useState("");
  const [paydownStrategy, setPaydownStrategy] = useState<PayDownStrategy>("avalanche");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (initial) {
      setType(initial.type);
      setName(initial.name);
      setTarget(initial.target_amount);
      setTargetDate(initial.target_date ?? "");
      setLinked(initial.linked_account_ids);
      if (initial.type === "save_up") {
        setSaveStrategy((initial.strategy as SaveUpStrategy) ?? "all_balance");
        setAllocation(initial.manual_allocation ?? "");
      } else {
        setPaydownStrategy((initial.strategy as PayDownStrategy) ?? "avalanche");
        setStartingBalance(initial.starting_balance ?? "");
        setInterest(initial.interest_rate ?? "");
        setMinPayment(initial.minimum_payment ?? "");
      }
    } else {
      setType("save_up");
      setName("");
      setTarget("");
      setTargetDate("");
      setLinked([]);
      setSaveStrategy("all_balance");
      setAllocation("");
      setStartingBalance("");
      setInterest("");
      setMinPayment("");
      setPaydownStrategy("avalanche");
    }
  }, [open, initial]);

  const eligibleAccounts = useMemo(() => {
    if (type === "save_up") {
      return accounts.filter((a) =>
        ["checking", "savings", "investment", "bitcoin", "real_estate", "other"].includes(a.type),
      );
    }
    return accounts.filter((a) => ["credit", "loan"].includes(a.type));
  }, [accounts, type]);

  function toggleAccount(id: string) {
    setLinked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function handleSave() {
    if (!name.trim()) {
      toast.error("Name is required");
      return;
    }
    if (!target || Number(target) <= 0) {
      toast.error("Target must be a positive number");
      return;
    }
    setSaving(true);
    try {
      const draft: GoalDraft = {
        type,
        name: name.trim(),
        target_amount: target,
        target_date: targetDate || null,
        linked_account_ids: linked,
        strategy: type === "save_up" ? saveStrategy : paydownStrategy,
        manual_allocation:
          type === "save_up" && saveStrategy === "specific_amount" ? allocation : null,
        starting_balance: type === "pay_down" ? startingBalance || target : null,
        interest_rate: type === "pay_down" ? interest || "0" : null,
        minimum_payment: type === "pay_down" ? minPayment || null : null,
      };
      await onSave(draft);
      toast.success(initial ? "Goal updated" : "Goal created");
      onOpenChange(false);
    } catch (err) {
      toastError(err, "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{initial ? "Edit goal" : "New goal"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {!initial && (
            <Tabs value={type} onValueChange={(v) => setType(v as GoalType)}>
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="save_up" className="gap-2">
                  <PiggyBank className="h-4 w-4" /> Save Up
                </TabsTrigger>
                <TabsTrigger value="pay_down" className="gap-2">
                  <Banknote className="h-4 w-4" /> Pay Down
                </TabsTrigger>
              </TabsList>
            </Tabs>
          )}

          <div className="space-y-2">
            <Label>Name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={type === "save_up" ? "e.g. Emergency fund" : "e.g. Visa card"}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>{type === "save_up" ? "Target amount" : "Total to pay off"}</Label>
              <Input
                inputMode="decimal"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                placeholder="10000"
              />
            </div>
            <div className="space-y-2">
              <Label>Target date (optional)</Label>
              <DateField value={targetDate} onChange={setTargetDate} />
            </div>
          </div>

          {type === "pay_down" && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Starting balance</Label>
                <Input
                  inputMode="decimal"
                  value={startingBalance}
                  onChange={(e) => setStartingBalance(e.target.value)}
                  placeholder="Same as target"
                />
              </div>
              <div className="space-y-2">
                <Label>Interest rate (% APR)</Label>
                <Input
                  inputMode="decimal"
                  value={interest}
                  onChange={(e) => setInterest(e.target.value)}
                  placeholder="24.99"
                />
              </div>
              <div className="space-y-2 col-span-2">
                <Label>Minimum payment / month (optional)</Label>
                <Input
                  inputMode="decimal"
                  value={minPayment}
                  onChange={(e) => setMinPayment(e.target.value)}
                  placeholder="35"
                />
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label>Linked account{type === "save_up" ? "(s)" : ""}</Label>
            <div className="max-h-40 overflow-auto rounded-md border border-border p-2 space-y-1">
              {eligibleAccounts.length === 0 && (
                <p className="text-xs text-muted-foreground p-2">
                  No eligible accounts. Add a {type === "save_up" ? "savings" : "credit/loan"}{" "}
                  account first.
                </p>
              )}
              {eligibleAccounts.map((a) => (
                <label
                  key={a.id}
                  className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-muted/50 cursor-pointer text-sm"
                >
                  <Checkbox
                    checked={linked.includes(a.id)}
                    onCheckedChange={() => toggleAccount(a.id)}
                  />
                  <span className="flex-1 truncate">{a.name}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {formatCurrencyWithMode(a.balance, a.currency, prefs.btcDisplayMode, loc)}
                  </span>
                </label>
              ))}
            </div>
          </div>

          {type === "save_up" && (
            <div className="space-y-2">
              <Label>Allocation strategy</Label>
              <Select
                value={saveStrategy}
                onValueChange={(v) => setSaveStrategy(v as SaveUpStrategy)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all_balance">Track full account balance</SelectItem>
                  <SelectItem value="specific_amount">Allocate specific amount</SelectItem>
                </SelectContent>
              </Select>
              {saveStrategy === "specific_amount" && (
                <Input
                  inputMode="decimal"
                  value={allocation}
                  onChange={(e) => setAllocation(e.target.value)}
                  placeholder="Allocated amount"
                />
              )}
            </div>
          )}

          {type === "pay_down" && (
            <div className="space-y-2">
              <Label>Payoff strategy preference</Label>
              <Select
                value={paydownStrategy}
                onValueChange={(v) => setPaydownStrategy(v as PayDownStrategy)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="avalanche">Avalanche (highest APR first)</SelectItem>
                  <SelectItem value="snowball">Snowball (smallest balance first)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : initial ? "Save changes" : "Create goal"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
