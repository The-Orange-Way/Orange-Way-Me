import { createFileRoute } from "@tanstack/react-router";
import { AppGate } from "@/components/app/AppGate";
import { SecurityPage } from "@/components/settings/SecurityPage";

export const Route = createFileRoute("/settings/security")({
  component: () => (
    <AppGate>
      <SecurityPage />
    </AppGate>
  ),
});
