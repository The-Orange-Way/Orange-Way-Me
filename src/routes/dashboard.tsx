import { createFileRoute } from "@tanstack/react-router";
import { AppGate } from "@/components/app/AppGate";
import { DashboardPage } from "@/components/dashboard/DashboardPage";

export const Route = createFileRoute("/dashboard")({
  component: () => (
    <AppGate>
      <DashboardPage />
    </AppGate>
  ),
});
