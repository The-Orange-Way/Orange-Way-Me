import { createFileRoute } from "@tanstack/react-router";
import { AppGate } from "@/components/app/AppGate";
import { TransactionsPage } from "@/components/transactions/TransactionsPage";

export const Route = createFileRoute("/transactions")({
  head: () => ({
    meta: [{ title: "Transactions | Orange Way" }],
  }),
  validateSearch: (search: Record<string, unknown>) => ({
    wallet: typeof search.wallet === "string" ? search.wallet : undefined,
  }),
  component: () => (
    <AppGate>
      <TransactionsPage />
    </AppGate>
  ),
});
