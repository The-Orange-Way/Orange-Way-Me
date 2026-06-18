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
  const { hasVault } = useVault();
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-md">
        <div className="mb-8 flex flex-col items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <h1 className="text-xl font-semibold tracking-tight">
            {hasVault ? "Unlock your vault" : "Set up your vault"}
          </h1>
        </div>
        {hasVault ? <UnlockForm /> : <CreateVaultFlow />}
      </div>
    </div>
  );
}

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
              Use recovery code
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
