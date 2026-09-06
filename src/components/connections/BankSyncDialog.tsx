/**
 * BankSyncDialog — progress UI for the OPK bank-transaction sync.
 *
 * The actual fetch+unseal+import logic lives in the parent (ConnectionsPage)
 * because it owns the import deps (MEK encrypt, connection_account_map
 * resolver, household signature builder). This dialog just runs the passed
 * `runSync` callback once per open and renders progress.
 *
 * ZKA: runSync fetches OPK-sealed rows from OR, unseals them with the vault's
 * OPK private key, re-encrypts each field under the MEK, and inserts. No
 * plaintext bank data is ever persisted server-side.
 */

import { useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Loader2, AlertCircle, Check, RefreshCw } from "lucide-react";
import { humanizeError } from "@/lib/friendly-error";

export interface BankSyncProgress {
  done: number;
  total: number;
}

export interface BankSyncOutcome {
  imported: number;
  total: number;
  unmapped: number;
  errored: number;
  /** Balance credits the DL-1424 unit guard refused because the transaction's
   *  unit did not match the destination account's currency. Present so the
   *  dialog can warn instead of reporting silent success (OWM-T0740). */
  unitMismatch: number;
}

/** True when the outcome must not be shown as a plain success (OWM-T0740). */
export function bankSyncHasWarning(outcome: Pick<BankSyncOutcome, "unitMismatch">): boolean {
  return outcome.unitMismatch > 0;
}

interface BankSyncDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Runs the OPK fetch+unseal+import. Reports progress; returns a summary. */
  runSync: (onProgress: (p: BankSyncProgress) => void) => Promise<BankSyncOutcome>;
  onDone?: (outcome: BankSyncOutcome) => void;
}

type Phase = "idle" | "fetching" | "importing" | "done" | "error";

export function BankSyncDialog({ open, onOpenChange, runSync, onDone }: BankSyncDialogProps) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [done, setDone] = useState(0);
  const [total, setTotal] = useState(0);
  const [imported, setImported] = useState(0);
  const [unitMismatch, setUnitMismatch] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Refs so the run-once effect depends only on `open` (callbacks recreated
  // by the parent every render must not re-fire the sync — that was the
  // 329x loop bug). startedRef gates to one run per open.
  const runSyncRef = useRef(runSync);
  const onOpenChangeRef = useRef(onOpenChange);
  const onDoneRef = useRef(onDone);
  const startedRef = useRef(false);

  // Keep callback refs fresh without re-triggering the sync effect.
  useEffect(() => {
    runSyncRef.current = runSync;
    onOpenChangeRef.current = onOpenChange;
    onDoneRef.current = onDone;
  });

  useEffect(() => {
    if (!open) {
      startedRef.current = false;
      return;
    }
    if (startedRef.current) return;
    startedRef.current = true;

    let cancelled = false;
    (async () => {
      setPhase("fetching");
      setDone(0);
      setTotal(0);
      setImported(0);
      setUnitMismatch(0);
      setError(null);
      try {
        const outcome = await runSyncRef.current((p) => {
          if (cancelled) return;
          setPhase("importing");
          setDone(p.done);
          setTotal(p.total);
        });
        if (cancelled) return;
        setImported(outcome.imported);
        setTotal(outcome.total);
        setUnitMismatch(outcome.unitMismatch);
        setPhase("done");
        onDoneRef.current?.(outcome);
        setTimeout(() => {
          if (!cancelled) onOpenChangeRef.current(false);
        }, 1600);
      } catch (err) {
        if (cancelled) return;
        console.error("[BankSyncDialog] sync failed", err);
        setError(humanizeError(err, "Sync failed. Please try again."));
        setPhase("error");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open]);

  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o && (phase === "done" || phase === "error" || phase === "idle")) {
          onOpenChange(false);
        }
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RefreshCw className="h-5 w-5" />
            Syncing your bank
          </DialogTitle>
          <DialogDescription>
            Pulling fresh transactions. Each one is unsealed and re-encrypted with your vault key in
            your browser, so no one else can see your amounts or merchants.
          </DialogDescription>
        </DialogHeader>

        {phase === "fetching" && (
          <div className="flex flex-col items-center gap-3 py-8">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Reaching your bank…</p>
          </div>
        )}

        {phase === "importing" && (
          <div className="space-y-4 py-4">
            <div className="space-y-1">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Importing transactions</span>
                <span className="font-mono tabular-nums">
                  {done}/{total}
                </span>
              </div>
              <Progress value={pct} />
            </div>
          </div>
        )}

        {phase === "done" && (
          <div className="flex flex-col items-center gap-3 py-8">
            {bankSyncHasWarning({ unitMismatch }) ? (
              <AlertCircle className="h-8 w-8 text-amber-600 dark:text-amber-400" />
            ) : (
              <Check className="h-8 w-8 text-green-600 dark:text-green-400" />
            )}
            <p className="text-sm">
              {total === 0
                ? "No transactions returned."
                : imported === total
                  ? `Imported ${imported} ${imported === 1 ? "transaction" : "transactions"}.`
                  : `Imported ${imported} of ${total} ${total === 1 ? "transaction" : "transactions"}.`}
            </p>
            {bankSyncHasWarning({ unitMismatch }) && (
              <p className="text-center text-sm text-amber-600 dark:text-amber-400">
                {unitMismatch} {unitMismatch === 1 ? "balance was" : "balances were"} not updated because
                the account&apos;s currency does not match. Your bitcoin is unaffected; set the
                account&apos;s currency correctly and sync again to apply{" "}
                {unitMismatch === 1 ? "it" : "them"}.
              </p>
            )}
          </div>
        )}

        {phase === "error" && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            <p className="text-destructive">{error ?? "Sync failed"}</p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
