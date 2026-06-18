import { createFileRoute } from "@tanstack/react-router";
import { AppGate } from "@/components/app/AppGate";
import { TransactionsPage } from "@/components/transactions/TransactionsPage";

export const Route = createFileRoute("/transactions")({
  validateSearch: (search: Record<string, unknown>) => ({
    wallet: typeof search.wallet === "string" ? search.wallet : undefined,
  }),
  component: () => (
    <AppGate>
      <TransactionsPage />
    </AppGate>
  ),
});
