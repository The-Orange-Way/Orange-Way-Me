import { createFileRoute } from "@tanstack/react-router";
import { AppGate } from "@/components/app/AppGate";
import { PreferencesPage } from "@/components/settings/PreferencesPage";

export const Route = createFileRoute("/settings/preferences")({
  component: () => (
    <AppGate>
      <PreferencesPage />
    </AppGate>
  ),
});
