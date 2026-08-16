import { createFileRoute } from "@tanstack/react-router";
import { AppGate } from "@/components/app/AppGate";
import { CashFlowPage } from "@/components/cashflow/CashFlowPage";

export const Route = createFileRoute("/cash-flow")({
  head: () => ({
    meta: [{ title: "Cash Flow | Orange Way" }],
  }),
  component: () => (
    <AppGate>
      <CashFlowPage />
    </AppGate>
  ),
});
