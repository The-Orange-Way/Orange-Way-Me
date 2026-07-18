import { createFileRoute } from "@tanstack/react-router";
import { AppGate } from "@/components/app/AppGate";
import { AdminMetricsPage } from "@/components/admin/AdminMetricsPage";

export const Route = createFileRoute("/admin")({
  component: () => (
    <AppGate>
      <AdminMetricsPage />
    </AppGate>
  ),
});
