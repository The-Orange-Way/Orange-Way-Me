/**
 * HouseholdRekeyWizard — Phase 4.5 seven-step safety dialog.
 *
 * Walks the household Owner through a refresh with plain-English copy
 * at every step. No technical terms leak to the UI (no DEK/KEM/wrap/
 * cipher). The actual refresh is driven by
 * `src/lib/household-rekey.ts`.
 *
 * Screens (copy rule: "refresh" not "rotate"):
 *   1. Intro
 *   2. What happens + Quick vs Deep toggle
 *   3. Backup recommendation (optional download)
 *   4. Timing recommendation
 *   5. Household impact
 *   6. Final review + confirmation checkbox
 *   7. Running (progress bar + stage label)
 *
 * The wizard stays open through completion so the user can see it
 * finish. On success: green checkmark + Close. On abort: error banner
 * + "No data was lost" reassurance + Close.
 */
import { useCallback, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { CheckCircle2, Download, AlertTriangle, Loader2, Shield } from "lucide-react";
import { toast } from "sonner";
import { toastError } from "@/lib/friendly-error";
import { useVault } from "@/context/VaultContext";
import {
  startHouseholdRekeyJob,
  runHouseholdRekeyJob,
  abortHouseholdRekey,
  exportHouseholdBackup,
  type HouseholdRekeyStage,
  type HouseholdRekeyTriggerType,
  type HouseholdRefreshMode,
} from "@/lib/household-rekey";

type WizardStep = 1 | 2 | 3 | 4 | 5 | 6 | 7;
type RunState = "idle" | "running" | "succeeded" | "aborted";

export interface HouseholdRekeyWizardProps {
  householdId: string;
  open: boolean;
  /** Skip to step 2 when opened from the post-remove-member prompt
   *  (the Owner already confirmed the removal — the intro is
   *  redundant). */
  startAtWhatHappens?: boolean;
  triggerType?: HouseholdRekeyTriggerType;
  onClose: () => void;
  onCompleted?: () => void;
}

export function HouseholdRekeyWizard({
  householdId,
  open,
  startAtWhatHappens = false,
  triggerType = "manual",
  onClose,
  onCompleted,
}: HouseholdRekeyWizardProps) {
  const vault = useVault();
  const [step, setStep] = useState<WizardStep>(startAtWhatHappens ? 2 : 1);
  const [acknowledged, setAcknowledged] = useState(false);
  const [backupDownloaded, setBackupDownloaded] = useState(false);
  const [refreshMode, setRefreshMode] = useState<HouseholdRefreshMode>("quick");

  const [jobId, setJobId] = useState<string | null>(null);
  const [rowsTotal, setRowsTotal] = useState<number>(0);
  const [estimatedSeconds, setEstimatedSeconds] = useState<number>(60);
  const [runState, setRunState] = useState<RunState>("idle");
  const [stageLabel, setStageLabel] = useState<string>("Preparing");
  const [rowsProcessed, setRowsProcessed] = useState<number>(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const stageCopy = (stage: HouseholdRekeyStage): string => {
    switch (stage) {
      case "generating_keys":
        return "Preparing new household keys";
      case "wrapping_members":
        return "Sharing the new keys with your household";
      case "rekeying_rows":
        return "Updating your household data";
      case "finalizing":
        return "Finishing up";
    }
  };

  const handleDownloadBackup = useCallback(async () => {
    try {
      const blob = await exportHouseholdBackup(householdId, "csv", vault.decryptText);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `orangeway-household-backup-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      setBackupDownloaded(true);
      toast.success("Backup downloaded. Keep it somewhere safe.");
    } catch (err) {
      toastError(err, "Could not download the backup.");
    }
  }, [householdId, vault.decryptText]);

  const kickOff = useCallback(async () => {
    setStep(7);
    setRunState("running");
    setStageLabel("Preparing");
    setErrorMsg(null);
    let startedJobId: string | null = null;
    try {
      const start = await startHouseholdRekeyJob(householdId, triggerType, refreshMode);
      startedJobId = start.jobId;
      setJobId(start.jobId);
      setRowsTotal(start.rowsTotal);
      setEstimatedSeconds(start.estimatedSeconds);
      await runHouseholdRekeyJob(start.jobId, {
        onStageChange: (s) => setStageLabel(stageCopy(s)),
        onRowProgress: (p) => setRowsProcessed(p),
        onComplete: () => {
          setRunState("succeeded");
          onCompleted?.();
        },
        onAborted: (reason) => {
          setRunState("aborted");
          setErrorMsg(reason);
        },
        onError: (err) => {
          setErrorMsg(err.message);
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "The household refresh failed.";
      setErrorMsg(msg);
      setRunState("aborted");
      if (startedJobId) {
        try {
          await abortHouseholdRekey(startedJobId, msg);
        } catch {
          /* swallow */
        }
      }
    }
  }, [householdId, triggerType, refreshMode, onCompleted]);

  const close = useCallback(() => {
    if (runState === "running") return; // prevent closing mid-run
    onClose();
    // Reset after close so re-opening starts clean.
    setTimeout(() => {
      setStep(startAtWhatHappens ? 2 : 1);
      setAcknowledged(false);
      setBackupDownloaded(false);
      setRefreshMode("quick");
      setJobId(null);
      setRowsTotal(0);
      setEstimatedSeconds(60);
      setRunState("idle");
      setStageLabel("Preparing");
      setRowsProcessed(0);
      setErrorMsg(null);
    }, 200);
  }, [runState, onClose, startAtWhatHappens]);

  const estimatedMinutes = Math.max(1, Math.ceil(estimatedSeconds / 60));
  const rowsPercent =
    rowsTotal > 0 ? Math.min(100, Math.round((rowsProcessed / rowsTotal) * 100)) : 0;

  const stepTitle: Record<WizardStep, string> = {
    1: "Refresh household security",
    2: "Quick or Deep refresh?",
    3: "Download a backup",
    4: "When to refresh",
    5: "What others will see",
    6: "Confirm and start",
    7:
      runState === "running"
        ? "Refreshing household security"
        : runState === "succeeded"
          ? "Household security refreshed"
          : runState === "aborted"
            ? "Refresh could not finish"
            : "Refreshing household security",
  };
  const stepDescription: Record<WizardStep, string> = {
    1: "We'll walk through what's about to change before anything happens.",
    2: "Pick how thorough the refresh should be.",
    3: "Download a backup before refreshing — we strongly recommend it.",
    4: "A note on timing if you share the household with someone.",
    5: "What other household members will see while the refresh runs.",
    6: "Final review before the refresh starts.",
    7: "Refresh in progress — please leave this window open.",
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) close();
      }}
    >
      <DialogContent
        className="max-w-xl"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => {
          if (runState !== "idle") e.preventDefault();
        }}
      >
        <DialogHeader>
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Step {step} of 7
          </p>
          <DialogTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" />
            {stepTitle[step]}
          </DialogTitle>
          <DialogDescription>{stepDescription[step]}</DialogDescription>
        </DialogHeader>

        {/* Step 1 — Intro */}
        {step === 1 && (
          <div className="space-y-3 text-sm">
            <p className="text-base font-semibold">
              You're about to refresh your household's security.
            </p>
            <p className="text-muted-foreground">
              This is a safety step. Please read each screen carefully before continuing.
            </p>
          </div>
        )}

        {/* Step 2 — What happens + Quick vs Deep toggle */}
        {step === 2 && (
          <div className="space-y-4 text-sm">
            <p className="font-semibold">Here's what happens when you refresh:</p>
            <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
              <li>New household keys are created.</li>
              <li>Everyone currently in your household gets the new keys.</li>
              <li>Anyone you've removed from the household can no longer read future data.</li>
            </ul>

            <div className="space-y-2 rounded-md border border-border bg-muted/30 p-3">
              <p className="font-semibold">Choose how thorough the refresh should be:</p>
              <RadioGroup
                value={refreshMode}
                onValueChange={(v) => setRefreshMode(v as HouseholdRefreshMode)}
                className="space-y-2"
              >
                <div className="flex items-start gap-2">
                  <RadioGroupItem value="quick" id="mode-quick" className="mt-0.5" />
                  <Label htmlFor="mode-quick" className="cursor-pointer font-normal leading-tight">
                    <span className="font-semibold">Quick (recommended)</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      Takes seconds to a minute. New keys for everyone in the household; future data
                      is protected by the new keys. Good for routine refreshes and after removing a
                      member.
                    </span>
                  </Label>
                </div>
                <div className="flex items-start gap-2">
                  <RadioGroupItem value="deep" id="mode-deep" className="mt-0.5" />
                  <Label htmlFor="mode-deep" className="cursor-pointer font-normal leading-tight">
                    <span className="font-semibold">Deep</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      Takes longer. Every existing row is also re-protected under the new keys. Use
                      this if you think old data may have been seen by the wrong person.
                    </span>
                  </Label>
                </div>
              </RadioGroup>
            </div>

            <p className="text-xs text-muted-foreground">
              Estimated time: about {estimatedMinutes}{" "}
              {estimatedMinutes === 1 ? "minute" : "minutes"} (shown once the household is checked
              on the next screen).
            </p>
          </div>
        )}

        {/* Step 3 — Backup recommendation */}
        {step === 3 && (
          <div className="space-y-3 text-sm">
            <p className="font-semibold">Recommended: download a backup first.</p>
            <p className="text-muted-foreground">
              Your backup is decrypted and stored on this device. Keep it somewhere safe. You can
              skip this step, but we strongly recommend it.
            </p>
            <Button
              variant={backupDownloaded ? "outline" : "default"}
              onClick={handleDownloadBackup}
              disabled={backupDownloaded}
            >
              {backupDownloaded ? (
                <>
                  <CheckCircle2 className="mr-2 h-4 w-4" />
                  Backup downloaded
                </>
              ) : (
                <>
                  <Download className="mr-2 h-4 w-4" />
                  Download backup
                </>
              )}
            </Button>
          </div>
        )}

        {/* Step 4 — Timing */}
        {step === 4 && (
          <div className="space-y-3 text-sm">
            <p className="font-semibold">Good times to refresh.</p>
            <p className="text-muted-foreground">
              Nights or weekends cause the least disruption if you share the household with a
              partner. During the refresh, household members can still view data but can't make
              changes for a few minutes.
            </p>
          </div>
        )}

        {/* Step 5 — Household impact */}
        {step === 5 && (
          <div className="space-y-3 text-sm">
            <p className="font-semibold">
              Other household members will see a short maintenance message while this runs.
            </p>
            <p className="text-muted-foreground">
              Estimated: 1&ndash;5 minutes (Quick) or longer (Deep). After the refresh finishes,
              other household members should reload their browser to continue.
            </p>
          </div>
        )}

        {/* Step 6 — Final review */}
        {step === 6 && (
          <div className="space-y-3 text-sm">
            <p className="font-semibold">Ready to refresh?</p>
            <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
              <li>New household keys will be created.</li>
              <li>
                {refreshMode === "deep"
                  ? `Every row of your household data (${rowsTotal > 0 ? `${rowsTotal.toLocaleString()} rows` : "everything"}) will be protected under the new keys.`
                  : "Your existing data stays exactly as it is; future writes use the new keys."}
              </li>
              <li>Everyone currently in your household gets the new keys.</li>
              <li>You have 30 days to roll back if anything goes wrong.</li>
            </ul>
            <div className="flex items-start gap-2 pt-1">
              <Checkbox
                id="refresh-confirm"
                checked={acknowledged}
                onCheckedChange={(v) => setAcknowledged(v === true)}
              />
              <Label htmlFor="refresh-confirm" className="text-sm font-normal leading-tight">
                I understand what this does and have downloaded a backup if I need one.
              </Label>
            </div>
          </div>
        )}

        {/* Step 7 — Running / Done / Failed */}
        {step === 7 && (
          <div className="space-y-3 text-sm">
            {runState === "running" && (
              <>
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>{stageLabel}</span>
                </div>
                {rowsTotal > 0 && (
                  <div className="space-y-1">
                    <Progress value={rowsPercent} className="h-2" />
                    <p className="text-xs text-muted-foreground">
                      {rowsProcessed.toLocaleString()} of {rowsTotal.toLocaleString()} rows
                    </p>
                  </div>
                )}
                <p className="text-xs text-muted-foreground">
                  Do not close this tab until the refresh finishes. Progress is saved — you can
                  resume later if needed.
                </p>
              </>
            )}
            {runState === "succeeded" && (
              <div className="flex items-start gap-2 rounded-md border border-primary/40 bg-primary/10 p-3">
                <CheckCircle2 className="mt-0.5 h-5 w-5 text-primary" />
                <span>
                  Household security refreshed. Other household members will be prompted to reload.
                </span>
              </div>
            )}
            {runState === "aborted" && (
              <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3">
                <AlertTriangle className="mt-0.5 h-5 w-5 text-destructive" />
                <div>
                  <p className="font-semibold">
                    {errorMsg ?? "The household refresh was stopped."}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    No data was lost. Your previous household keys are still active.
                  </p>
                </div>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          {step === 1 && (
            <>
              <Button variant="outline" onClick={close}>
                Cancel
              </Button>
              <Button onClick={() => setStep(2)}>Continue</Button>
            </>
          )}
          {step === 2 && (
            <>
              {!startAtWhatHappens && (
                <Button variant="outline" onClick={() => setStep(1)}>
                  Back
                </Button>
              )}
              {startAtWhatHappens && (
                <Button variant="outline" onClick={close}>
                  Cancel
                </Button>
              )}
              <Button onClick={() => setStep(3)}>Continue</Button>
            </>
          )}
          {step === 3 && (
            <>
              <Button variant="outline" onClick={() => setStep(2)}>
                Back
              </Button>
              <Button onClick={() => setStep(4)}>
                {backupDownloaded ? "Continue" : "Continue without backup"}
              </Button>
            </>
          )}
          {step === 4 && (
            <>
              <Button variant="outline" onClick={() => setStep(3)}>
                Back
              </Button>
              <Button onClick={() => setStep(5)}>Continue</Button>
            </>
          )}
          {step === 5 && (
            <>
              <Button variant="outline" onClick={() => setStep(4)}>
                Back
              </Button>
              <Button onClick={() => setStep(6)}>Continue</Button>
            </>
          )}
          {step === 6 && (
            <>
              <Button variant="outline" onClick={() => setStep(5)}>
                Back
              </Button>
              <Button disabled={!acknowledged} onClick={() => void kickOff()}>
                Refresh security now
              </Button>
            </>
          )}
          {step === 7 && runState !== "running" && <Button onClick={close}>Close</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default HouseholdRekeyWizard;
