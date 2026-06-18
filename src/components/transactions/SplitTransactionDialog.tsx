/**
 * SplitTransactionDialog — split a parent transaction into N children
 * whose amounts must sum to the parent's amount within ±$0.01.
 */
import { useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Plus, Trash2 } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { toastError } from "@/lib/friendly-error";
import type { DecryptedCategory } from "@/hooks/useCategories";
import type { DecryptedTxn, SplitChild } from "@/hooks/useTransactions";

export function SplitTransactionDialog({
  open,
  onOpenChange,
  parent,
  categories,
  onSplit,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  parent: DecryptedTxn | null;
  categories: DecryptedCategory[];
  onSplit: (parentId: string, children: SplitChild[]) => Promise<void>;
}) {
  const parentAmt = parent ? Number(parent.amount) : 0;
  const [children, setChildren] = useState<SplitChild[]>([
    { amount: (parentAmt / 2).toFixed(2), description: "", category_id: null },
    { amount: (parentAmt / 2).toFixed(2), description: "", category_id: null },
  ]);
  const [submitting, setSubmitting] = useState(false);

  const sum = useMemo(
    () => children.reduce((acc, c) => acc + Number(c.amount || 0), 0),
    [children],
  );
  const diff = parentAmt - sum;
  const ok = Math.abs(diff) < 0.01;

  const updateChild = (i: number, patch: Partial<SplitChild>) => {
    setChildren((arr) => arr.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
  };
  const addChild = () =>
    setChildren((arr) => [...arr, { amount: "0", description: "", category_id: null }]);
  const removeChild = (i: number) => setChildren((arr) => arr.filter((_, idx) => idx !== i));

  const submit = async () => {
    if (!parent) return;
    if (!ok) return toast.error(`Splits must sum to ${parentAmt.toFixed(2)}`);
    setSubmitting(true);
    try {
      await onSplit(parent.id, children);
      toast.success("Transaction split");
      onOpenChange(false);
    } catch (err) {
      toastError(err, "Split failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            Split {parentAmt.toFixed(2)} – {parent?.merchant ?? parent?.description}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-2">
          {children.map((c, i) => (
            <div key={i} className="grid grid-cols-[120px_1fr_180px_36px] items-end gap-2">
              <div>
                {i === 0 && <Label className="text-xs">Amount</Label>}
                <Input
                  type="number"
                  step="0.01"
                  value={c.amount}
                  onChange={(e) => updateChild(i, { amount: e.target.value })}
                  className="font-mono tabular-nums"
                />
              </div>
              <div>
                {i === 0 && <Label className="text-xs">Description</Label>}
                <Input
                  value={c.description}
                  placeholder={parent?.description ?? "Description"}
                  onChange={(e) => updateChild(i, { description: e.target.value })}
                />
              </div>
              <div>
                {i === 0 && <Label className="text-xs">Category</Label>}
                <Select
                  value={c.category_id ?? "__none"}
                  onValueChange={(v) => updateChild(i, { category_id: v === "__none" ? null : v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="None" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">Uncategorized</SelectItem>
                    {categories.map((cat) => (
                      <SelectItem key={cat.id} value={cat.id}>
                        {cat.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => removeChild(i)}
                disabled={children.length <= 2}
                aria-label="Remove split row"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={addChild}>
            <Plus className="mr-2 h-4 w-4" /> Add row
          </Button>
        </div>

        <div className="flex items-center justify-between rounded-md border border-border p-3 text-sm">
          <span className="text-muted-foreground">Sum of splits</span>
          <span className={`font-mono tabular-nums ${ok ? "text-foreground" : "text-destructive"}`}>
            {sum.toFixed(2)} / {parentAmt.toFixed(2)}{" "}
            {!ok && <span>(off by {diff.toFixed(2)})</span>}
          </span>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!ok || submitting}>
            {submitting ? "Splitting…" : "Save split"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
