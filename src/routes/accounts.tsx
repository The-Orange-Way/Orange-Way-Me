import { createFileRoute } from "@tanstack/react-router";
import { AppGate } from "@/components/app/AppGate";
import { AccountsPage } from "@/components/accounts/AccountsPage";

export const Route = createFileRoute("/accounts")({
  head: () => ({
    meta: [{ title: "Accounts | Orange Way" }],
  }),
  component: () => (
    <AppGate>
      <AccountsPage />
    </AppGate>
  ),
});
