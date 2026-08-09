import { useEffect, useState } from "react";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { OnboardingFlow, ONBOARDING_V2_ENABLED } from "@/features/onboarding/onboarding-flow";
import { ONBOARDING_STEPS } from "@/features/onboarding/steps";
import { useVault } from "@/context/VaultContext";

export const Route = createFileRoute("/onboarding")({
  beforeLoad: () => {
    if (!ONBOARDING_V2_ENABLED) {
      throw redirect({ to: "/auth" });
    }
  },
  component: OnboardingRoute,
});

// A reload mid-flow keeps the Supabase session but drops the in-memory wizard
// state, so the flow restarts at step 1 while the person is still signed in.
// If they already created a vault on the first pass, walking forward runs
// createVault a second time and hits the vault_metadata unique constraint. We
// settle that here, not by making createVault idempotent: a returning user who
// already has a vault has finished onboarding, so send them to the dashboard.
//
// The decision is snapshotted once, after the vault check settles. It must not
// react to later hasVault changes: finalizeVaultSetup() flips hasVault to true
// at the success step of a genuine new flow, and reacting to that would eject
// the user from the "You're all set" screen they just earned.
function OnboardingRoute() {
  const navigate = useNavigate();
  const { hasVault, loading } = useVault();
  const [decision, setDecision] = useState<"pending" | "resume" | "redirect">("pending");

  // Auth hydration fires checkVault(true) which cycles loading true->false.
  // Reset the snapshot so the settled post-auth result wins over the pre-auth
  // null-user pass. finalizeVaultSetup() never cycles loading, so a genuine
  // new-vault flow in progress is not affected by this reset.
  useEffect(() => {
    if (loading) setDecision("pending");
  }, [loading]);

  useEffect(() => {
    if (loading || decision !== "pending") return;
    setDecision(hasVault ? "redirect" : "resume");
  }, [loading, hasVault, decision]);

  useEffect(() => {
    if (decision === "redirect") {
      void navigate({ to: "/dashboard", replace: true });
    }
  }, [decision, navigate]);

  if (decision === "pending") {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted-foreground">
        Loading...
      </div>
    );
  }

  if (decision === "redirect") {
    return null;
  }

  return (
    <OnboardingFlow
      steps={ONBOARDING_STEPS}
      onComplete={() => {
        // The dashboard, not /auth. Finishing the flow leaves a signed-in
        // session and an unlocked vault, so sending people to a sign-in page
        // asked them to log into the account they had just finished creating.
        void navigate({ to: "/dashboard" });
      }}
    />
  );
}
