/**
 * GoalCard — list-view tile for a single goal.
 */
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import type { Goal } from "@/hooks/useGoals";
import {
  computeProgress,
  projectCompletionDate,
  averageMonthlyContribution,
} from "@/lib/goals-math";
import type { Account } from "@/lib/connectors";
import type { DecryptedTxn } from "@/hooks/useTransactions";
import { PiggyBank, Banknote, Calendar, TrendingUp } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { useLocaleFormat } from "@/lib/locale";
import { useDashboardPrefs } from "@/hooks/useDashboardPrefs";

// fmtUSD resolved via useLocaleFormat + useDashboardPrefs at runtime
function fmtMonths(d: number | null): string | null {
  if (d == null) return null;
  if (d < 0) return `Past due by ${-d} day${-d === 1 ? "" : "s"}`;
  if (d < 31) return `${d} day${d === 1 ? "" : "s"} to go`;
  const months = Math.round(d / 30);
  return `${months} month${months === 1 ? "" : "s"} to go`;
}

interface Props {
  goal: Goal;
  accounts: Account[];
  txns: DecryptedTxn[];
}

export function GoalCard({ goal, accounts, txns }: Props) {
  const { prefs } = useDashboardPrefs();
  const fmt = useLocaleFormat();
  const fmtUSD = (n: number) => fmt.formatCurrency(n, prefs.primaryCurrency);
  const prog = computeProgress(goal, accounts);
  const monthly = averageMonthlyContribution(goal, txns);
  const projDate = projectCompletionDate(goal, prog.current, monthly);

  const Icon = goal.type === "save_up" ? PiggyBank : Banknote;
  const colorClass = goal.type === "save_up" ? "text-emerald-500" : "text-amber-500";
  const bgClass = goal.type === "save_up" ? "bg-emerald-500/10" : "bg-amber-500/10";

  const countdown = fmtMonths(prog.daysToTarget);

  return (
    <Link to="/goals/$id" params={{ id: goal.id }}>
      <Card className="group transition-all hover:shadow-md hover:-translate-y-0.5 cursor-pointer h-full">
        <CardContent className="p-5 space-y-4">
          <div className="flex items-start gap-3">
            <div
              className={cn(
                "h-10 w-10 rounded-lg flex items-center justify-center shrink-0",
                bgClass,
              )}
            >
              <Icon className={cn("h-5 w-5", colorClass)} />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="font-semibold truncate">{goal.name}</h3>
              <p className="text-xs text-muted-foreground">
                {goal.type === "save_up" ? "Saving" : "Paying down"}
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-baseline justify-between font-mono tabular-nums text-sm">
              <span className="font-semibold text-base">{fmtUSD(prog.current)}</span>
              <span className="text-muted-foreground">of {fmtUSD(prog.target)}</span>
            </div>
            <Progress value={prog.pct * 100} className="h-2" />
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">
                {goal.type === "save_up"
                  ? `${fmtUSD(prog.remaining)} to go`
                  : `${fmtUSD(prog.remaining)} remaining`}
              </span>
              <span className="font-medium tabular-nums">{Math.round(prog.pct * 100)}%</span>
            </div>
          </div>

          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {countdown && (
              <span
                className={cn(
                  "inline-flex items-center gap-1",
                  prog.isOverdue && "text-destructive font-medium",
                )}
              >
                <Calendar className="h-3 w-3" />
                {countdown}
              </span>
            )}
            {projDate && monthly > 0 && (
              <span className="inline-flex items-center gap-1">
                <TrendingUp className="h-3 w-3" />
                On pace for {fmt.formatDate(projDate, { month: "short", year: "numeric" })}
              </span>
            )}
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
