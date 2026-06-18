import { createFileRoute } from "@tanstack/react-router";
import { AppGate } from "@/components/app/AppGate";
import { DemoDataPage } from "@/components/settings/DemoDataPage";

export const Route = createFileRoute("/settings/demo")({
  component: () => (
    <AppGate>
      <DemoDataPage />
    </AppGate>
  ),
});
