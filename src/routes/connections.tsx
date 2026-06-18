import { createFileRoute } from "@tanstack/react-router";
import { AppGate } from "@/components/app/AppGate";
import { ConnectionsPage } from "@/components/connections/ConnectionsPage";

export const Route = createFileRoute("/connections")({
  component: () => (
    <AppGate>
      <ConnectionsPage />
    </AppGate>
  ),
});
