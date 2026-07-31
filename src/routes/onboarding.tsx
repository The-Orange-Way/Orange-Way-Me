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
        void navigate({ to: "/auth" });
      }}
    />
  );
}
