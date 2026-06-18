import type { ReactNode } from "react";
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
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAsyncAction } from "@/hooks/useAsyncAction";

/**
 * Branded confirmation dialog backed by shadcn AlertDialog.
 *
 * Use as a controlled component: parent owns `open` state, sets it true to
 * prompt, and clears it from `onOpenChange`. The action button calls
 * `onConfirm` then closes — parent doesn't need to manage close-on-confirm.
 *
 * Replaces native `window.confirm()` calls so the dialog renders inside the
 * app's own theme instead of the off-brand "<host> says…" prompt.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirm",
  confirmLabelBusy,
  cancelLabel = "Cancel",
  destructive = false,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  confirmLabel?: string;
  /** Shown in place of confirmLabel while the async onConfirm is running. */
  confirmLabelBusy?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void | Promise<void>;
}) {
  const [confirm, busy] = useAsyncAction(async () => {
    try {
      await Promise.resolve(onConfirm());
    } finally {
      onOpenChange(false);
    }
  });
  return (
    <AlertDialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>{cancelLabel}</AlertDialogCancel>
          <AlertDialogAction
            className={cn(destructive && buttonVariants({ variant: "destructive" }))}
            disabled={busy}
            onClick={(e) => {
              // AlertDialogAction auto-closes after onClick. preventDefault
              // keeps the dialog visible so the busy label is observable and
              // a double-click can't re-fire onConfirm before the first call
              // settles — useAsyncAction also drops repeat calls.
              e.preventDefault();
              void confirm();
            }}
          >
            {busy ? (confirmLabelBusy ?? `${confirmLabel}…`) : confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
