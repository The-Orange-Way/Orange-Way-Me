/**
 * CategoryFormDialog — create or edit a single category. Users pick name,
 * color (swatch palette), icon (lucide name), parent category, and type.
 */
import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { CategoryType, DecryptedCategory } from "@/hooks/useCategories";

const PALETTE = [
  "#22c55e",
  "#f97316",
  "#06b6d4",
  "#8b5cf6",
  "#eab308",
  "#ec4899",
  "#f43f5e",
  "#10b981",
  "#3b82f6",
  "#0ea5e9",
  "#f59e0b",
  "#64748b",
];

const ICONS = [
  "Wallet",
  "Home",
  "Car",
  "ShoppingCart",
  "Utensils",
  "ShoppingBag",
  "Plane",
  "Heart",
  "Film",
  "Bitcoin",
  "Zap",
  "Coffee",
  "Briefcase",
  "Gift",
  "TrendingUp",
  "ArrowLeftRight",
  "PiggyBank",
  "Percent",
  "BookOpen",
  "Ticket",
  "Map",
  "BedDouble",
  "Pill",
  "Dumbbell",
];

export function CategoryFormDialog({
  open,
  onOpenChange,
  initial,
  defaultParentId,
  categories,
  onSave,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initial: DecryptedCategory | null;
  defaultParentId: string | null;
  categories: DecryptedCategory[];
  onSave: (draft: {
    name: string;
    color: string;
    icon: string;
    parent_id: string | null;
    type: CategoryType;
  }) => Promise<void>;
}) {
  const isEdit = Boolean(initial);

  const [name, setName] = useState("");
  const [color, setColor] = useState(PALETTE[0]);
  const [icon, setIcon] = useState(ICONS[0]);
  const [parentId, setParentId] = useState<string>("__none");
  const [type, setType] = useState<CategoryType>("expense");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (initial) {
      setName(initial.name);
      setColor(initial.color ?? PALETTE[0]);
      setIcon(initial.icon ?? ICONS[0]);
      setParentId(initial.parent_id ?? "__none");
      setType(initial.type);
    } else {
      setName("");
      setColor(PALETTE[0]);
      setIcon(ICONS[0]);
      setParentId(defaultParentId ?? "__none");
      setType("expense");
    }
  }, [open, initial, defaultParentId]);

  // When editing, don't allow setting the category as its own parent (or
  // parenting to any of its descendants — would create a cycle).
  const descendantIds = getDescendantIds(initial?.id ?? null, categories);
  const eligibleParents = categories.filter(
    (c) => c.id !== initial?.id && !descendantIds.has(c.id),
  );

  const submit = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await onSave({
        name: name.trim(),
        color,
        icon,
        parent_id: parentId === "__none" ? null : parentId,
        type,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit category" : "New category"}</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
          className="space-y-4"
        >
          <div className="space-y-2">
            <Label htmlFor="cat-name">Name</Label>
            <Input
              id="cat-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              autoFocus
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Type</Label>
              <Select value={type} onValueChange={(v) => setType(v as CategoryType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="expense">Expense</SelectItem>
                  <SelectItem value="income">Income</SelectItem>
                  <SelectItem value="transfer">Transfer</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Parent</Label>
              <Select value={parentId} onValueChange={setParentId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">— None (top-level) —</SelectItem>
                  {eligibleParents.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Color</Label>
            <div className="flex flex-wrap gap-2">
              {PALETTE.map((p) => (
                <button
                  type="button"
                  key={p}
                  onClick={() => setColor(p)}
                  className={`h-7 w-7 rounded-full transition-transform ${
                    color === p ? "ring-2 ring-offset-2 ring-foreground/60 scale-110" : ""
                  }`}
                  style={{ background: p }}
                  aria-label={p}
                />
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label>Icon</Label>
            <Select value={icon} onValueChange={setIcon}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-60">
                {ICONS.map((i) => (
                  <SelectItem key={i} value={i}>
                    {i}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
            <Button type="submit" disabled={saving || !name.trim()}>
              {saving ? "Saving…" : isEdit ? "Save changes" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function getDescendantIds(id: string | null, all: DecryptedCategory[]): Set<string> {
  const out = new Set<string>();
  if (!id) return out;
  const walk = (parent: string) => {
    for (const c of all) {
      if (c.parent_id === parent && !out.has(c.id)) {
        out.add(c.id);
        walk(c.id);
      }
    }
  };
  walk(id);
  return out;
}
