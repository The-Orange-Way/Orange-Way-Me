/**
 * Settings -> Reset vault page.
 *
 * Branch logic is ENTIRELY client-side, keyed on whether the MEK is
 * currently held in memory (isUnlocked from VaultContext). Never
 * queries server auth to decide which path to show.
 *
 * Unlocked path: export-first gate -> typed confirmation -> reset.
 * Locked path: honest copy about data loss -> typed confirmation -> reset.
 *
 * Reset = delete vault_metadata row, which wipes the MEK wraps and
 * recovery ciphertext. OR connections are severed (credentials were
 * encrypted with the MEK, now unrecoverable). Transaction history
 * stays (kept in separate tables with no vault dependency).
 */
import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useVault } from "@/context/VaultContext";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertTriangle, ArrowLeft, Download } from "lucide-react";
import { toast } from "sonner";

/** User must type this exactly (case-insensitive) to unlock the reset button. */
const CONFIRM_PHRASE = "reset my vault";

export function ResetVaultPage() {
  const { isUnlocked, lock } = useVault();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [exportedFirst, setExportedFirst] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);

  const phraseMatch = confirmText.trim().toLowerCase() === CONFIRM_PHRASE;
  // When unlocked, the export checkbox must also be checked.
  const canReset = phraseMatch && (!isUnlocked || exportedFirst);

  const handleReset = async () => {
    if (!canReset || !user) return;
    setBusy(true);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const db = supabase as any;
      const { error } = await db.from("vault_metadata").delete().eq("user_id", user.id);
      if (error) throw error;

      // Wipe in-memory MEK so the rest of this session cannot encrypt.
      lock();
      try {
        localStorage.removeItem("ow_greeting_name");
      } catch {
        /* localStorage blocked: non-fatal */
      }
      toast.success("Vault reset. Create a new vault password to continue.");
      // Hard reload so VaultContext re-runs its vault check and
      // AppGate shows CreateVaultFlow (setHasVault is not exposed).
      window.location.href = "/";
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not reset vault.";
      toast.error(msg);
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="-ml-3">
          <Link to="/settings">
            <ArrowLeft className="mr-1 h-4 w-4" />
            Settings
          </Link>
        </Button>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Reset vault</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Remove your vault and all saved connections. Your transaction history stays.
        </p>
      </div>

      <div className="max-w-lg space-y-4">
        {/* Warning banner */}
        <div className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <div className="space-y-1">
            <p className="font-medium text-destructive">This cannot be undone.</p>
            <p className="text-muted-foreground">
              This removes all your wallet and bank connections and their saved credentials. You
              will need to reconnect each one. Your transaction history stays.
            </p>
          </div>
        </div>

        {/* Export gate (only when vault is unlocked) */}
        {isUnlocked ? (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Step 1: download a backup first</CardTitle>
              <CardDescription>
                Your vault is unlocked so you can export your data now. We recommend it before
                resetting.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Button asChild variant="outline" size="sm">
                <Link to="/settings/import-export">
                  <Download className="mr-2 h-4 w-4" />
                  Go to Import / Export
                </Link>
              </Button>
              <label className="flex cursor-pointer items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={exportedFirst}
                  onChange={(e) => setExportedFirst(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-input accent-primary"
                />
                <span className="text-muted-foreground">
                  I have downloaded a backup or do not need one.
                </span>
              </label>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Your vault is locked</CardTitle>
              <CardDescription>
                Without your vault password or recovery kit you cannot export your encrypted data.
                Resetting will erase your connections and credentials permanently. Your transaction
                history will remain.
              </CardDescription>
            </CardHeader>
          </Card>
        )}

        {/* Confirmation input */}
        <Card className={isUnlocked && !exportedFirst ? "pointer-events-none opacity-40" : ""}>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              {isUnlocked ? "Step 2: confirm and reset" : "Confirm and reset"}
            </CardTitle>
            <CardDescription>
              Type <span className="font-mono font-semibold">reset my vault</span> to continue.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="confirm-reset-text">Confirmation</Label>
              <Input
                id="confirm-reset-text"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder="reset my vault"
                autoComplete="off"
                spellCheck={false}
              />
            </div>
            <Button
              variant="destructive"
              className="w-full"
              disabled={!canReset || busy}
              onClick={() => void handleReset()}
            >
              {busy ? "Resetting..." : "Reset vault"}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
