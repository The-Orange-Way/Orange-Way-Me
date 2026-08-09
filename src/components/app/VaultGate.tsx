import { useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { useVault } from "@/context/VaultContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toastError } from "@/lib/friendly-error";
import { ShieldCheck, KeyRound } from "lucide-react";
import { RecoveryDialog } from "./RecoveryDialog";
import { CreateVaultFlow } from "./CreateVaultFlow";

export function VaultGate() {
  const { hasVault, vaultCheckError } = useVault();
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-md">
        <div className="mb-8 flex flex-col items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <h1 className="text-xl font-semibold tracking-tight">
            {vaultCheckError
              ? "Couldn't reach your vault"
              : hasVault
                ? "Unlock your vault"
                : "Set up your vault"}
          </h1>
        </div>
        {vaultCheckError ? <VaultCheckError /> : hasVault ? <UnlockForm /> : <CreateVaultFlow />}
      </div>
    </div>
  );
}

// Shown when we could not determine whether a vault exists. We deliberately
// do NOT offer CreateVaultFlow here: a false "no vault" is what lets a
// returning user insert a duplicate vault_metadata row, so blocking the create
// path is the fail-safe direction on this ZKA surface. A full reload re-runs
// the existence check and exposes no key material.
function VaultCheckError() {
  return (
    <Card className="shadow-card">
      <CardHeader className="pb-4">
        <CardTitle className="text-lg">We couldn't verify your vault</CardTitle>
        <CardDescription>
          We couldn't confirm whether you already have a vault, so we won't risk creating a second
          one. Check your connection and try again.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button className="w-full" onClick={() => window.location.reload()}>
          Try again
        </Button>
      </CardContent>
    </Card>
  );
}

// e2e-anchor: tests/e2e/auth.setup.ts unlocks the vault via the
// #v-pw input and the "Unlock" button. tests/e2e/authenticated-
// routes.spec.ts asserts that #v-pw is NOT visible on every
// authenticated route as the canonical "auth state still holds"
// check. Renaming the id or the button text breaks both; update the
// specs in the same change.
function UnlockForm() {
  const { unlock } = useVault();
  const { signOut } = useAuth();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [recoveryOpen, setRecoveryOpen] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await unlock(password);
    } catch (err) {
      toastError(err);
    }
    setBusy(false);
  };

  return (
    <Card className="shadow-card">
      <CardHeader className="pb-4">
        <CardTitle className="text-lg">Vault password</CardTitle>
        <CardDescription>This password decrypts your data. We never see it.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="v-pw">Vault password</Label>
            <Input
              id="v-pw"
              type="password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          <Button type="submit" className="w-full" disabled={busy}>
            <KeyRound className="mr-2 h-4 w-4" />
            {busy ? "Unlocking…" : "Unlock"}
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            Forgot vault password?{" "}
            <button
              type="button"
              className="text-foreground underline-offset-4 hover:underline"
              onClick={() => setRecoveryOpen(true)}
            >
              Use recovery kit
            </button>
          </p>
          <button
            type="button"
            onClick={() => signOut()}
            className="w-full text-center text-xs text-muted-foreground hover:text-foreground"
          >
            Sign out instead
          </button>
        </form>
      </CardContent>
      <RecoveryDialog open={recoveryOpen} onOpenChange={setRecoveryOpen} />
    </Card>
  );
}
