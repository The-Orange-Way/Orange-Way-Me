import { createFileRoute } from "@tanstack/react-router";
import { AppGate } from "@/components/app/AppGate";
import { AboutPage } from "@/components/settings/AboutPage";

export const Route = createFileRoute("/settings/about")({
  component: () => (
    <AppGate>
      <AboutPage />
    </AppGate>
  ),
});
