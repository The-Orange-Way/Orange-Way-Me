import { createFileRoute } from "@tanstack/react-router";
import { AppGate } from "@/components/app/AppGate";
import { ConnectionsPage } from "@/components/connections/ConnectionsPage";

export const Route = createFileRoute("/connections")({
  head: () => ({
    meta: [{ title: "Connections | Orange Way" }],
  }),
  component: () => (
    <AppGate>
      <ConnectionsPage />
    </AppGate>
  ),
});
