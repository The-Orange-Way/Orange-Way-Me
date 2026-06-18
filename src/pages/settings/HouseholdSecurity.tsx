/**
 * Settings → Household security page — Phase 4.5.
 *
 * Household-Owner-only. Three sections:
 *
 *   1. Refresh household security — last refreshed + button to open
 *      the wizard.
 *   2. Download a backup — one-click export.
 *   3. Refresh history — list of jobs, with "Undo the last refresh"
 *      available when a job is within its 30-day rollback window.
 *
 * Gated on `households.owner_id = auth.uid()`.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, Shield, Download, History, RotateCcw, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { useVault } from "@/context/VaultContext";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { toastError } from "@/lib/friendly-error";
import HouseholdRekeyWizard from "@/components/rekey/HouseholdRekeyWizard";
import {
  exportHouseholdBackup,
  rollbackHouseholdRekey,
  type HouseholdBackupFormat,
} from "@/lib/household-rekey";
import { mintSigningKeyForHousehold, householdHasSigningKey } from "@/lib/household-osk";
import { useSupportSession } from "@/hooks/useSupportSession";
import { useNow } from "@/hooks/useNow";
import { featureFlags } from "@/lib/feature-flags";
import { Pen, LifeBuoy, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface RotationJobSummary {
  id: string;
  status: string;
  trigger_type: string;
  refresh_mode: string;
  started_at: string;
  completed_at: string | null;
  rollback_expires_at: string | null;
  rows_total: number;
  started_by: string;
}

interface OwnedHousehold {
  id: string;
}

export default function HouseholdSecurity() {
  const { user } = useAuth();
  const vault = useVault();
  const now = useNow(60_000);

  const [loading, setLoading] = useState(true);
  const [household, setHousehold] = useState<OwnedHousehold | null>(null);
  const [lastRotatedAt, setLastRotatedAt] = useState<string | null>(null);
  const [history, setHistory] = useState<RotationJobSummary[]>([]);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [backupOpen, setBackupOpen] = useState(false);
  const [backupFormat, setBackupFormat] = useState<HouseholdBackupFormat>("csv");
  const [backupWorking, setBackupWorking] = useState(false);
  const [rollbackJobId, setRollbackJobId] = useState<string | null>(null);
  const [rollbackWorking, setRollbackWorking] = useState(false);

  const firstLoadRef = useRef(true);

  // Phase 4.4: signing-key state + support-session controls.
  const [signingKeyReady, setSigningKeyReady] = useState<boolean>(false);
  const [signingWorking, setSigningWorking] = useState<boolean>(false);
  const [supportEmail, setSupportEmail] = useState<string>("support@orangeway.app");
  // Backend accepts 1 / 6 / 12 / 24 hours. We expose the longer values
  // (the customer-facing brief asks for short/medium/long).
  const [supportDuration, setSupportDuration] = useState<"6" | "12" | "24">("6");
  const [supportWorking, setSupportWorking] = useState<boolean>(false);
  const supportSession = useSupportSession(household?.id ?? null);

  const refresh = useCallback(async () => {
    if (!user) return;
    // Only show the full-page loader on the very first load. Subsequent
    // refreshes (e.g. after the wizard completes) keep the UI mounted so
    // the wizard's internal step state isn't wiped by an unmount/remount
    // cycle.
    if (firstLoadRef.current) setLoading(true);

    // Only the household OWNER sees this page's controls. Look up a
    // household owned by the current user.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any;
    const { data: hh } = await db
      .from("households")
      .select("id")
      .eq("owner_id", user.id)
      .maybeSingle();
    const owned = (hh as OwnedHousehold | null) ?? null;
    setHousehold(owned);

    if (!owned) {
      setLastRotatedAt(null);
      setHistory([]);
      setLoading(false);
      firstLoadRef.current = false;
      return;
    }

    const { data: active } = await db
      .from("household_active_key_versions")
      .select("last_rotated_at")
      .eq("household_id", owned.id)
      .maybeSingle();
    setLastRotatedAt(
      (active as { last_rotated_at?: string | null } | null)?.last_rotated_at ?? null,
    );

    const { data: jobs } = await db
      .from("household_key_rotation_jobs")
      .select(
        "id, status, trigger_type, refresh_mode, started_at, completed_at, " +
          "rollback_expires_at, rows_total, started_by",
      )
      .eq("household_id", owned.id)
      .order("started_at", { ascending: false })
      .limit(20);
    setHistory((jobs as RotationJobSummary[] | null) ?? []);

    setLoading(false);
    firstLoadRef.current = false;
  }, [user]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Phase 4.4: refresh the "is the signing key minted?" indicator
  // whenever the household changes.
  useEffect(() => {
    if (!household?.id) {
      setSigningKeyReady(false);
      return;
    }
    let active = true;
    void (async () => {
      const ok = await householdHasSigningKey(household.id);
      if (active) setSigningKeyReady(ok);
    })();
    return () => {
      active = false;
    };
  }, [household?.id]);

  const handleSignAccount = useCallback(async () => {
    if (!household) return;
    setSigningWorking(true);
    try {
      await mintSigningKeyForHousehold(household.id);
      setSigningKeyReady(true);
      toast.success("Your account is now signed. Future changes are verified end-to-end.");
    } catch (err) {
      toastError(err, "Could not sign your account.");
    } finally {
      setSigningWorking(false);
    }
  }, [household]);

  const handleGrantSupport = useCallback(async () => {
    if (!household) return;
    if (!supportEmail.trim()) {
      toast.error("Please enter the support email.");
      return;
    }
    setSupportWorking(true);
    try {
      await supportSession.grant(supportEmail.trim(), Number(supportDuration) as 6 | 12 | 24);
      toast.success("Support now has temporary access.");
    } catch (err) {
      toastError(err, "Could not grant support access.");
    } finally {
      setSupportWorking(false);
    }
  }, [household, supportEmail, supportDuration, supportSession]);

  const handleEndSupport = useCallback(async () => {
    if (!supportSession.session) return;
    setSupportWorking(true);
    try {
      await supportSession.end(supportSession.session.id);
      toast.success("Support access has ended.");
    } catch (err) {
      toastError(err, "Could not end support access.");
    } finally {
      setSupportWorking(false);
    }
  }, [supportSession]);

  const handleBackup = useCallback(async () => {
    if (!household) return;
    setBackupWorking(true);
    try {
      const blob = await exportHouseholdBackup(household.id, backupFormat, vault.decryptText);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const ext = backupFormat === "json" ? "json" : "csv";
      a.download = `orangeway-household-backup-${new Date().toISOString().slice(0, 10)}.${ext}`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Backup downloaded. Keep it somewhere safe.");
      setBackupOpen(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not build the backup.";
      toast.error(msg);
    } finally {
      setBackupWorking(false);
    }
  }, [household, backupFormat, vault.decryptText]);

  const handleRollback = useCallback(
    async (jobId: string) => {
      setRollbackWorking(true);
      try {
        await rollbackHouseholdRekey(jobId);
        toast.success("Previous household keys restored. Please reload to continue.");
        setRollbackJobId(null);
        await refresh();
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Could not undo the refresh.";
        toast.error(msg);
      } finally {
        setRollbackWorking(false);
      }
    },
    [refresh],
  );

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading household security…
      </div>
    );
  }

  if (!household) {
    return (
      <div className="space-y-4">
        <div>
          <Button asChild variant="ghost" size="sm" className="-ml-3">
            <Link to="/settings">
              <ArrowLeft className="mr-1 h-4 w-4" />
              Settings
            </Link>
          </Button>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">Household security</h1>
        </div>
        <div className="max-w-2xl rounded-lg border border-border bg-card p-5">
          <p className="text-sm text-muted-foreground">
            Only the household Owner can refresh household security. Create a household from
            Settings → Household first.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="-ml-3">
          <Link to="/settings">
            <ArrowLeft className="mr-1 h-4 w-4" />
            Settings
          </Link>
        </Button>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Household security</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Refresh the keys that protect your household's shared data.
        </p>
      </div>

      <div className="max-w-2xl space-y-6">
        {/* Refresh household security section */}
        <section className="space-y-4 rounded-lg border border-border bg-card p-5">
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" />
            <h3 className="text-base font-semibold text-card-foreground">
              Refresh household security
            </h3>
          </div>
          <p className="text-sm text-muted-foreground">
            {lastRotatedAt
              ? `Last refreshed: ${new Date(lastRotatedAt).toLocaleString()}`
              : "Not refreshed yet."}
          </p>
          <p className="text-sm text-muted-foreground">
            Refreshing creates new household keys, re-issues them to everyone currently in your
            household, and leaves removed members without access to future data.
          </p>
          <Button onClick={() => setWizardOpen(true)}>Refresh security now</Button>
        </section>

        {/* Backup section */}
        <section className="space-y-4 rounded-lg border border-border bg-card p-5">
          <div className="flex items-center gap-2">
            <Download className="h-5 w-5 text-primary" />
            <h3 className="text-base font-semibold text-card-foreground">Download a backup</h3>
          </div>
          <p className="text-sm text-muted-foreground">
            Your backup is decrypted and stored on this device. Keep it somewhere safe.
          </p>
          <Button variant="outline" onClick={() => setBackupOpen(true)}>
            Download household backup
          </Button>
        </section>

        {/* Phase 4.4 sections — gated behind featureFlags.phase44Public.
            Both "Sign your account" and "Customer support access" stay
            hidden until the real ML-DSA verifier ships. */}
        {featureFlags.phase44Public && (
          <>
            {/* Phase 4.4: sign your account (Household Signing Key) */}
            <section className="space-y-4 rounded-lg border border-border bg-card p-5">
              <div className="flex items-center gap-2">
                <Pen className="h-5 w-5 text-primary" />
                <h3 className="text-base font-semibold text-card-foreground">Sign your account</h3>
              </div>
              <p className="text-sm text-muted-foreground">
                Signing your account locks future changes to your verified devices. Anyone tampering
                with your data on the server, even our staff, will be detected.
              </p>
              {signingKeyReady ? (
                <p className="text-sm text-green-700">
                  Your account is signed. Future changes are verified end-to-end.
                </p>
              ) : (
                <Button onClick={() => void handleSignAccount()} disabled={signingWorking}>
                  {signingWorking && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Sign your account
                </Button>
              )}
            </section>

            {/* Phase 4.4: customer support access */}
            <section className="space-y-4 rounded-lg border border-border bg-card p-5">
              <div className="flex items-center gap-2">
                <LifeBuoy className="h-5 w-5 text-primary" />
                <h3 className="text-base font-semibold text-card-foreground">
                  Customer support access
                </h3>
              </div>
              {supportSession.session ? (
                <div className="space-y-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                  <p>
                    <strong>Active.</strong> Support has temporary access to this household until{" "}
                    {new Date(supportSession.session.expires_at).toLocaleString()}.
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void handleEndSupport()}
                    disabled={supportWorking}
                  >
                    {supportWorking && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    <X className="mr-1 h-4 w-4" />
                    End now
                  </Button>
                </div>
              ) : (
                <>
                  <p className="text-sm text-muted-foreground">
                    Need help? You can grant our support team temporary access to troubleshoot. They
                    get the same read access as a partner; you can end the session at any time.
                    Access auto-ends when the timer runs out.
                  </p>
                  <div className="space-y-2">
                    <Label htmlFor="support-email">Support email</Label>
                    <Input
                      id="support-email"
                      type="email"
                      value={supportEmail}
                      onChange={(e) => setSupportEmail(e.target.value)}
                      placeholder="support@orangeway.app"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="support-duration">How long?</Label>
                    <Select
                      value={supportDuration}
                      onValueChange={(v) => setSupportDuration(v as "6" | "12" | "24")}
                    >
                      <SelectTrigger id="support-duration">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="6">6 hours</SelectItem>
                        <SelectItem value="12">12 hours</SelectItem>
                        <SelectItem value="24">24 hours (maximum)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <Button onClick={() => void handleGrantSupport()} disabled={supportWorking}>
                    {supportWorking && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Grant access
                  </Button>
                </>
              )}
            </section>
          </>
        )}

        {/* Refresh history */}
        <section className="space-y-4 rounded-lg border border-border bg-card p-5">
          <div className="flex items-center gap-2">
            <History className="h-5 w-5 text-muted-foreground" />
            <h3 className="text-base font-semibold text-card-foreground">Refresh history</h3>
          </div>
          {history.length === 0 ? (
            <p className="text-sm text-muted-foreground">No household refreshes yet.</p>
          ) : (
            <div className="space-y-2">
              {history.map((j) => {
                const rollbackable =
                  j.status === "complete" &&
                  j.rollback_expires_at &&
                  new Date(j.rollback_expires_at).getTime() > now;
                return (
                  <div
                    key={j.id}
                    className="flex items-center justify-between gap-3 rounded-md border border-border p-3 text-sm"
                  >
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs text-muted-foreground">
                          {new Date(j.started_at).toLocaleString()}
                        </span>
                        <StatusBadge status={j.status} />
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {friendlyTrigger(j.trigger_type)} · {friendlyMode(j.refresh_mode)} ·{" "}
                        {j.rows_total.toLocaleString()} rows
                        {rollbackable && j.rollback_expires_at && (
                          <>
                            {" "}
                            · undo available until{" "}
                            {new Date(j.rollback_expires_at).toLocaleDateString()}
                          </>
                        )}
                      </p>
                    </div>
                    {rollbackable && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setRollbackJobId(j.id)}
                        disabled={rollbackWorking}
                      >
                        <RotateCcw className="mr-1 h-4 w-4" />
                        Undo the last refresh
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {history.some(
            (j) =>
              j.status === "complete" &&
              j.rollback_expires_at &&
              new Date(j.rollback_expires_at).getTime() > now,
          ) && (
            <p className="border-t border-border pt-2 text-xs text-muted-foreground">
              Undo restores the previous household keys. Only use this if something is wrong after
              the latest refresh.
            </p>
          )}
        </section>
      </div>

      {/* Backup format picker */}
      <Dialog
        open={backupOpen}
        onOpenChange={(o) => {
          if (!o && !backupWorking) setBackupOpen(false);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Download household backup</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <p>Choose a format. Both contain the same data.</p>
            <Select
              value={backupFormat}
              onValueChange={(v) => setBackupFormat(v as HouseholdBackupFormat)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="csv">CSV — best for spreadsheets (recommended)</SelectItem>
                <SelectItem value="json">JSON — machine-readable</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBackupOpen(false)} disabled={backupWorking}>
              Cancel
            </Button>
            <Button onClick={() => void handleBackup()} disabled={backupWorking}>
              {backupWorking && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Download
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rollback confirm */}
      <Dialog
        open={!!rollbackJobId}
        onOpenChange={(o) => {
          if (!o && !rollbackWorking) setRollbackJobId(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Undo the last refresh?</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <p className="font-semibold">This restores the previous household keys.</p>
            <p className="text-muted-foreground">
              Only use this if something is wrong after the latest refresh. Your household members
              will need to reload after the undo finishes.
            </p>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setRollbackJobId(null)}
              disabled={rollbackWorking}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={rollbackWorking}
              onClick={() => {
                if (rollbackJobId) void handleRollback(rollbackJobId);
              }}
            >
              {rollbackWorking && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Undo now
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Refresh wizard — always mounted when a household exists so it
          can preserve and reset its own internal step state cleanly
          across open/close cycles. */}
      {household && (
        <HouseholdRekeyWizard
          householdId={household.id}
          open={wizardOpen}
          onClose={() => setWizardOpen(false)}
          onCompleted={() => {
            void refresh();
          }}
        />
      )}
    </div>
  );
}

function friendlyTrigger(trigger: string): string {
  switch (trigger) {
    case "first_time_setup":
      return "First-time setup";
    case "manual":
      return "Manual refresh";
    case "post_revoke":
      return "After removing a member";
    default:
      return trigger;
  }
}

function friendlyMode(mode: string): string {
  switch (mode) {
    case "quick":
      return "Quick";
    case "deep":
      return "Deep";
    default:
      return mode;
  }
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    pending: { label: "Pending", cls: "bg-gray-100 text-gray-700" },
    generating_keys: { label: "Preparing keys", cls: "bg-amber-100 text-amber-800" },
    wrapping_members: { label: "Sharing keys", cls: "bg-amber-100 text-amber-800" },
    rekeying_rows: { label: "Updating data", cls: "bg-amber-100 text-amber-800" },
    finalizing: { label: "Finishing", cls: "bg-amber-100 text-amber-800" },
    complete: { label: "Complete", cls: "bg-green-100 text-green-800" },
    aborted: { label: "Stopped", cls: "bg-red-100 text-red-800" },
    rolled_back: { label: "Rolled back", cls: "bg-red-100 text-red-800" },
  };
  const v = map[status] ?? { label: status, cls: "bg-gray-100 text-gray-700" };
  return (
    <span className={`rounded px-2 py-0.5 text-[10px] font-semibold ${v.cls}`}>{v.label}</span>
  );
}
