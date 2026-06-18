import { createFileRoute } from "@tanstack/react-router";
import { AppGate } from "@/components/app/AppGate";
import HouseholdSecurity from "@/pages/settings/HouseholdSecurity";
import { ErrorBoundary } from "@/components/error/ErrorBoundary";
import { HouseholdSectionErrorFallback } from "@/components/error/RootErrorFallback";
import { logBoundaryError } from "@/components/error/logError";

// `/settings/household-security` hosts the rekey wizard and HSK rotation
// flows — the riskiest decrypted-state surface in the app. A scoped
// boundary here keeps a wizard throw from blanking the whole UI mid-flow.
export const Route = createFileRoute("/settings/household-security")({
  component: () => (
    <AppGate>
      <ErrorBoundary
        fallback={<HouseholdSectionErrorFallback />}
        onError={(error) => logBoundaryError(error, "settings.household-security")}
      >
        <HouseholdSecurity />
      </ErrorBoundary>
    </AppGate>
  ),
  errorComponent: ({ error }) => {
    logBoundaryError(error, "settings.household-security.route");
    return <HouseholdSectionErrorFallback />;
  },
});
