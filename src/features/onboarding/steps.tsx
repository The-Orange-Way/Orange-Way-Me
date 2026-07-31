import { StepShell } from "./onboarding-flow";
import type { OnboardingStep, OnboardingStepProps } from "./onboarding-flow";

// NOTE(DL-0429): copy below is structural placeholder pending the locked UX
// spec. The step order, ids, and component boundaries are the real contract;
// final wording is dropped in once the spec lands.

function StepWelcome(props: OnboardingStepProps) {
  return (
    <StepShell {...props} title="Welcome to Orange Way." nextLabel="Get started">
      <p>The family money app where the tracker cannot read your books.</p>
    </StepShell>
  );
}

function StepAudience(props: OnboardingStepProps) {
  return (
    <StepShell {...props} title="Who are you setting this up for?">
      <p>Just me, my partner and me, or the whole household.</p>
    </StepShell>
  );
}

function StepKeys(props: OnboardingStepProps) {
  return (
    <StepShell {...props} title="Your keys, your ledger.">
      <p>
        Orange Way never sees your keys or your plaintext. Everything sensitive is
        encrypted on your device before it leaves.
      </p>
    </StepShell>
  );
}

function StepHousehold(props: OnboardingStepProps) {
  return (
    <StepShell {...props} title="Name your household.">
      <p>This is the private label for your shared books. You can change it later.</p>
    </StepShell>
  );
}

export const ONBOARDING_STEPS: OnboardingStep[] = [
  { id: "welcome", title: "Welcome", Component: StepWelcome },
  { id: "audience", title: "Audience", Component: StepAudience },
  { id: "keys", title: "Keys", Component: StepKeys },
  { id: "household", title: "Household", Component: StepHousehold },
  // Steps 5-7 append here from feat/onboarding-steps-5-7.
];
