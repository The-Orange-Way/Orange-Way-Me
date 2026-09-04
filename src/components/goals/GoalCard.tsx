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
import { UNTRACKABLE_COPY } from "@/lib/goal-untrackable-copy";
import type { Account } from "@/lib/connectors";
import type { DecryptedTxn } from "@/hooks/useTransactions";
import { PiggyBank, Banknote, Calendar, TrendingUp, AlertCircle } from "lucide-react";
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
  /** Names of other active goals that share a backing account with this one. */
  sharedWith?: string[];
}

export function GoalCard({ goal, accounts, txns, sharedWith = [] }: Props) {
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

          {prog.untrackableReason ? (
            /*
             * DL-1425. Showing a 0% bar here would be a claim we cannot support:
             * it reads as "you have saved nothing", when the truth is "we have
             * nothing to measure". Say which, and say what would fix it.
             */
            <div className="space-y-2">
              <div className="flex items-baseline justify-between font-mono tabular-nums text-sm">
                <span className="text-muted-foreground text-base">Not tracking yet</span>
                {/*
                 * Only shown when there is a target to show. Printing
                 * "target $0" for a goal that has none states a figure the
                 * goal does not carry, which is the same unsupported claim
                 * as the bar itself.
                 */}
                {prog.untrackableReason !== "no_target_set" && (
                  <span className="text-muted-foreground">target {fmtUSD(prog.target)}</span>
                )}
              </div>
              <div className="flex items-start gap-1.5 rounded-md bg-muted/60 px-2 py-1.5 text-xs text-muted-foreground">
                <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
                <span>{UNTRACKABLE_COPY[prog.untrackableReason]}</span>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-baseline justify-between font-mono tabular-nums text-sm">
                {/* Display only: never show more banked than this goal's own
                    target asks for, even when the backing account also funds
                    another goal and really does hold more (OWM-T0674). */}
                <span className="font-semibold text-base">
                  {fmtUSD(Math.min(prog.current, prog.target))}
                </span>
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
              {sharedWith.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  Shared with {sharedWith.join(", ")}
                </p>
              )}
            </div>
          )}

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
