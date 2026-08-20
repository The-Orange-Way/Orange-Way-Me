import { createFileRoute } from "@tanstack/react-router";
import { AppGate } from "@/components/app/AppGate";
import { BudgetsPage } from "@/components/budgets/BudgetsPage";

export const Route = createFileRoute("/budgets")({
  head: () => ({
    meta: [{ title: "Budget | Orange Way" }],
  }),
  component: () => (
    <AppGate>
      <BudgetsPage />
    </AppGate>
  ),
});
