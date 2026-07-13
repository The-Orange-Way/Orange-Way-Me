import { createFileRoute } from "@tanstack/react-router";
import { AppGate } from "@/components/app/AppGate";
import { ResetVaultPage } from "@/components/settings/ResetVaultPage";

export const Route = createFileRoute("/settings/reset-vault")({
  component: () => (
    <AppGate>
      <ResetVaultPage />
    </AppGate>
  ),
});
