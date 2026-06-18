import { createFileRoute } from "@tanstack/react-router";
import { AppGate } from "@/components/app/AppGate";
import { AccountDetailPage } from "@/components/accounts/AccountDetailPage";

export const Route = createFileRoute("/accounts/$id")({
  component: () => (
    <AppGate>
      <AccountDetailPage />
    </AppGate>
  ),
});
