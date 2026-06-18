import { createFileRoute } from "@tanstack/react-router";
import { AppGate } from "@/components/app/AppGate";
import { HouseholdPage } from "@/components/settings/HouseholdPage";
import { ErrorBoundary } from "@/components/error/ErrorBoundary";
import { HouseholdSectionErrorFallback } from "@/components/error/RootErrorFallback";
import { logBoundaryError } from "@/components/error/logError";

// `/settings/household` runs decrypted-state code (household membership
// unwrap, member listings) so a localized boundary keeps render failures
// scoped to this section instead of white-screening the whole app.
export const Route = createFileRoute("/settings/household")({
  component: () => (
    <AppGate>
      <ErrorBoundary
        fallback={<HouseholdSectionErrorFallback />}
        onError={(error) => logBoundaryError(error, "settings.household")}
      >
        <HouseholdPage />
      </ErrorBoundary>
    </AppGate>
  ),
  errorComponent: ({ error }) => {
    logBoundaryError(error, "settings.household.route");
    return <HouseholdSectionErrorFallback />;
  },
});
