import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { OnboardingFlow, ONBOARDING_V2_ENABLED } from "@/features/onboarding/onboarding-flow";
import { ONBOARDING_STEPS } from "@/features/onboarding/steps";

export const Route = createFileRoute("/onboarding")({
  beforeLoad: () => {
    if (!ONBOARDING_V2_ENABLED) {
      throw redirect({ to: "/auth" });
    }
  },
  component: OnboardingRoute,
});

function OnboardingRoute() {
  const navigate = useNavigate();
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
