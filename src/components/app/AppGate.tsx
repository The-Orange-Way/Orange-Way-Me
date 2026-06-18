import { useEffect, useState, type ReactNode } from "react";
import { Navigate } from "@tanstack/react-router";
import { useAuth } from "@/context/AuthContext";
import { useVault } from "@/context/VaultContext";
import { useAutoLock } from "@/hooks/useAutoLock";
import { AuthScreen } from "./AuthScreen";
import { VaultGate } from "./VaultGate";
import { AppShell } from "./AppShell";
import { Bitcoin } from "lucide-react";

function LoadingScreen({ slow }: { slow: boolean }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background px-4 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10">
        <Bitcoin className="h-6 w-6 text-primary" />
      </div>
      <div className="space-y-1.5">
        <p className="text-sm font-medium text-foreground">Opening Orange Way…</p>
        <p className="text-xs text-muted-foreground">
          {slow
            ? "This is taking longer than usual. Check your internet connection."
            : "Checking your account"}
        </p>
      </div>
      <div className="h-1 w-40 overflow-hidden rounded-full bg-muted">
        <div className="h-full w-1/3 animate-pulse rounded-full bg-primary" />
      </div>
      {slow && (
        <button
          onClick={() => window.location.reload()}
          className="mt-2 text-xs text-primary underline underline-offset-2"
        >
          Reload page
        </button>
      )}
    </div>
  );
}

export function AppGate({ children }: { children: ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const { isUnlocked, loading: vaultLoading } = useVault();
  const [slow, setSlow] = useState(false);
  useAutoLock();

  const isLoading = authLoading || vaultLoading;

  useEffect(() => {
    if (!isLoading) {
      setSlow(false);
      return;
    }
    const t = window.setTimeout(() => setSlow(true), 6000);
    return () => window.clearTimeout(t);
  }, [isLoading]);

  if (isLoading) return <LoadingScreen slow={slow} />;
  if (!user) return <AuthScreen />;
  if (!isUnlocked) return <VaultGate />;
  return <AppShell>{children}</AppShell>;
}

// Used on the marketing landing: if signed in, redirect to dashboard
export function LandingGate({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (user) return <Navigate to="/dashboard" />;
  return <>{children}</>;
}
