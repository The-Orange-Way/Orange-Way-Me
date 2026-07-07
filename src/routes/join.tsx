import { createFileRoute } from "@tanstack/react-router";
import { JoinPage } from "@/components/join/JoinPage";

export const Route = createFileRoute("/join")({
  validateSearch: (search: Record<string, unknown>): { code: string } => ({
    code: typeof search.code === "string" ? search.code : "",
  }),
  component: JoinRoute,
});

function JoinRoute() {
  const { code } = Route.useSearch();
  return <JoinPage code={code} />;
}
