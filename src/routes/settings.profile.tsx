import { createFileRoute } from "@tanstack/react-router";
import { AppGate } from "@/components/app/AppGate";
import { ProfilePage } from "@/components/settings/ProfilePage";

export const Route = createFileRoute("/settings/profile")({
  component: () => (
    <AppGate>
      <ProfilePage />
    </AppGate>
  ),
});
