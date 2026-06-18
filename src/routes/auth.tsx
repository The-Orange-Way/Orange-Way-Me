import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useAuth } from "@/context/AuthContext";
import { useVault } from "@/context/VaultContext";
import { AuthScreen } from "@/components/app/AuthScreen";
import { VaultGate } from "@/components/app/VaultGate";

export const Route = createFileRoute("/auth")({
  component: AuthRoute,
});

function AuthRoute() {
  const { user, loading: aLoad } = useAuth();
  const { isUnlocked, loading: vLoad } = useVault();

  if (aLoad || vLoad) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-muted border-t-primary" />
      </div>
    );
  }

  if (!user) return <AuthScreen />;
  if (!isUnlocked) return <VaultGate />;
  return <Navigate to="/dashboard" />;
}
