/**
 * DeleteCategoryDialog — confirm category deletion. If any transactions
 * reference the category, prompt the user to reassign them to another
 * category (or clear their category) before the row is deleted.
 */
import { useEffect, useState } from "react";
import { useAsyncAction } from "@/hooks/useAsyncAction";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import type { DecryptedCategory } from "@/hooks/useCategories";

export function DeleteCategoryDialog({
  target,
  categories,
  countInCategory,
  onCancel,
  onConfirm,
}: {
  target: DecryptedCategory | null;
  categories: DecryptedCategory[];
  countInCategory: (id: string) => Promise<number>;
  onCancel: () => void;
  onConfirm: (id: string, reassignTo: string | null) => Promise<void>;
}) {
  const [count, setCount] = useState<number | null>(null);
  const [reassignTo, setReassignTo] = useState<string>("__none");
  const [confirmDelete, deleting] = useAsyncAction(async () => {
    if (!target) return;
    await onConfirm(target.id, reassignTo === "__none" ? null : reassignTo);
  });

  useEffect(() => {
    if (!target) {
      setCount(null);
      setReassignTo("__none");
      return;
    }
    let cancelled = false;
    countInCategory(target.id)
      .then((n) => {
        if (!cancelled) setCount(n);
      })
      .catch(() => {
        if (!cancelled) setCount(0);
      });
    return () => {
      cancelled = true;
    };
  }, [target, countInCategory]);

  const eligibleTargets = categories.filter((c) => c.id !== target?.id);

  return (
    <AlertDialog open={!!target} onOpenChange={(v) => !v && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {target?.name ?? "category"}?</AlertDialogTitle>
          <AlertDialogDescription>
            {count === null
              ? "Checking usage…"
              : count === 0
                ? "No transactions reference this category. Safe to delete."
                : `${count} transaction${count === 1 ? "" : "s"} reference this category. Pick where to reassign them before deleting.`}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {count !== null && count > 0 && (
          <div className="space-y-2 py-2">
            <Label>Reassign transactions to</Label>
            <Select value={reassignTo} onValueChange={setReassignTo}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">Leave uncategorized</SelectItem>
                {eligibleTargets.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              // AlertDialogAction auto-closes the dialog on click; we don't
              // want that mid-flight or the busy state is invisible.
              e.preventDefault();
              void confirmDelete();
            }}
            disabled={count === null || deleting}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {deleting ? "Deleting…" : "Delete"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
