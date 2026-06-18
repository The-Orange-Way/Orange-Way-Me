import { createFileRoute, redirect } from "@tanstack/react-router";

// Alias route for the Bitcoin-wallet vocabulary. Redirects to the
// canonical /accounts page (Orange Way uses "accounts" as the chart-of-
// accounts term, matching real bookkeeping conventions).
export const Route = createFileRoute("/wallets")({
  beforeLoad: () => {
    throw redirect({ to: "/accounts", replace: true });
  },
});
