import { createFileRoute } from "@tanstack/react-router";
import { AppGate } from "@/components/app/AppGate";
import { RulesPage } from "@/components/settings/RulesPage";

export const Route = createFileRoute("/settings/rules")({
  component: () => (
    <AppGate>
      <RulesPage />
    </AppGate>
  ),
});
