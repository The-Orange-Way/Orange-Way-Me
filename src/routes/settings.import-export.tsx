import { createFileRoute } from "@tanstack/react-router";
import { AppGate } from "@/components/app/AppGate";
import { ImportExportPage } from "@/components/settings/ImportExportPage";

export const Route = createFileRoute("/settings/import-export")({
  component: () => (
    <AppGate>
      <ImportExportPage />
    </AppGate>
  ),
});
