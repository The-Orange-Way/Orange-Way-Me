import { createFileRoute } from "@tanstack/react-router";
import { AppGate } from "@/components/app/AppGate";
import { GoalDetailPage } from "@/components/goals/GoalDetailPage";

export const Route = createFileRoute("/goals/$id")({
  component: GoalRoute,
});

function GoalRoute() {
  const { id } = Route.useParams();
  return (
    <AppGate>
      <GoalDetailPage id={id} />
    </AppGate>
  );
}
