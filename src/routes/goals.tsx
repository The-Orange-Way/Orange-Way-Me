import { createFileRoute } from "@tanstack/react-router";
import { AppGate } from "@/components/app/AppGate";
import { GoalsPage } from "@/components/goals/GoalsPage";

export const Route = createFileRoute("/goals")({
  head: () => ({
    meta: [{ title: "Goals | Orange Way" }],
  }),
  component: () => (
    <AppGate>
      <GoalsPage />
    </AppGate>
  ),
});
