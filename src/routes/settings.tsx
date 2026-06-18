import { createFileRoute, Outlet } from "@tanstack/react-router";

// Transparent layout — child routes render here.
// The index page lives in settings.index.tsx.
export const Route = createFileRoute("/settings")({
  component: Outlet,
});
