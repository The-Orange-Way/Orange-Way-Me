import { createFileRoute } from "@tanstack/react-router";
import { AppGate } from "@/components/app/AppGate";
import { CategoriesPage } from "@/components/settings/CategoriesPage";

export const Route = createFileRoute("/settings/categories")({
  component: () => (
    <AppGate>
      <CategoriesPage />
    </AppGate>
  ),
});
