/**
 * WeeklyRecapCard — Monarch-style "look at last week's change" prompt.
 * Sits at the top of the Dashboard. Tapping it routes to the Cash flow page.
 */
import { useNavigate } from "@tanstack/react-router";
import { Sparkles, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

function formatDateOrdinal(d: Date): string {
  const day = d.getDate();
  const month = d.toLocaleDateString(undefined, { month: "short" });
  const suffix =
    day % 10 === 1 && day !== 11
      ? "st"
      : day % 10 === 2 && day !== 12
        ? "nd"
        : day % 10 === 3 && day !== 13
          ? "rd"
          : "th";
  return `${month} ${day}${suffix}`;
}

export function WeeklyRecapCard() {
  const navigate = useNavigate();
  const now = new Date();
  // Week ending today, starting 6 days ago. Monarch's strip is Sunday-Saturday
  // but a rolling 7-day window reads as obvious for a single-glance recap.
  const weekStart = new Date(now);
  weekStart.setDate(weekStart.getDate() - 6);
  const range = `${formatDateOrdinal(weekStart)} – ${formatDateOrdinal(now)}`;

  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-orange-500">
        <Sparkles className="h-4 w-4" />
        Your weekly recap
      </div>
      <div className="text-xs text-muted-foreground">{range}</div>
      <p className="mt-3 text-sm text-foreground">
        See how your net worth and spending moved this week.
      </p>
      <div className="mt-3">
        <Button
          variant="default"
          size="sm"
          className="bg-orange-500 text-white hover:bg-orange-600"
          onClick={() => void navigate({ to: "/cash-flow" })}
        >
          View progress
          <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
