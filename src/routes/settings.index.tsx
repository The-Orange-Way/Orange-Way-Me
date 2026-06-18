import { createFileRoute } from "@tanstack/react-router";
import { AppGate } from "@/components/app/AppGate";
import { SettingsIndexPage } from "@/components/settings/SettingsIndexPage";

export const Route = createFileRoute("/settings/")({
  component: () => (
    <AppGate>
      <SettingsIndexPage />
    </AppGate>
  ),
});
