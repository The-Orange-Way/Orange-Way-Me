import { createFileRoute, Outlet } from "@tanstack/react-router";

// Transparent layout, child routes render here.
// The index page lives in settings.index.tsx.
export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [{ title: "Settings | Orange Way" }],
  }),
  component: Outlet,
});
