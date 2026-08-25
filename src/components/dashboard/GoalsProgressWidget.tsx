/**
 * GoalsProgressWidget — top 3 active goals + link to /goals.
 */
import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Target } from "lucide-react";
import { useGoals } from "@/hooks/useGoals";
import { useAccounts } from "@/hooks/useAccounts";
import { computeProgress } from "@/lib/goals-math";
import { UNTRACKABLE_SHORT } from "@/lib/goal-untrackable-copy";
import { useDashboardPrefs } from "@/hooks/useDashboardPrefs";
import { useLocaleFormat } from "@/lib/locale";
import { Skeleton } from "@/components/ui/skeleton";

export function GoalsProgressWidget() {
  const { prefs } = useDashboardPrefs();
  const fmt = useLocaleFormat();
  const { goals, loading } = useGoals();
  const { accounts } = useAccounts();

  const top = useMemo(() => {
    const active = goals.filter((g) => !g.is_completed);
    return active.slice(0, 3);
  }, [goals]);

  return (
    <Card className="h-full">
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">Goals</CardTitle>
        <Button asChild variant="ghost" size="sm" className="h-7 text-xs">
          <Link to="/goals">View all</Link>
        </Button>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-32 w-full" />
        ) : top.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-6 text-center">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10">
              <Target className="h-4 w-4 text-primary" />
            </div>
            <p className="text-xs text-muted-foreground">No active goals yet.</p>
            <Button asChild size="sm" variant="outline" className="h-7">
              <Link to="/goals">Create one</Link>
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {top.map((g) => {
              const p = computeProgress(g, accounts);
              const linkedAcct = accounts.find((a) => g.linked_account_ids.includes(a.id));
              const goalCurrency = linkedAcct?.currency ?? prefs.primaryCurrency;
              return (
                <Link
                  key={g.id}
                  to="/goals/$id"
                  params={{ id: g.id }}
                  className="block rounded-lg border border-border p-3 transition-colors hover:bg-muted/30"
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-sm font-medium">{g.name}</span>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {p.untrackableReason ? "Not tracking yet" : `${Math.round(p.pct * 100)}%`}
                    </span>
                  </div>
                  {p.untrackableReason ? (
                    /*
                     * DL-1601. Drawing the bar here would be the same claim the
                     * list tile and the detail page already refuse to make: a
                     * zero that reads as "saved nothing" when the truth is
                     * "nothing to measure". This surface is the worst of the
                     * three for it, because the dashboard is where someone sees
                     * the goal FIRST, with no tile having flagged it.
                     *
                     * No bar and no figures, for the same reason the tile
                     * suppresses "of $0": printing an amount states something
                     * the goal does not carry. The tile links to the goal,
                     * where the full explanation is.
                     */
                    <p className="mt-1.5 text-[11px] text-muted-foreground">
                      {UNTRACKABLE_SHORT[p.untrackableReason]}
                    </p>
                  ) : (
                    <>
                      <Progress value={p.pct * 100} className="mt-2 h-1.5" />
                      <div className="mt-1 flex items-center justify-between text-[11px] font-mono tabular-nums text-muted-foreground">
                        <span>{fmt.formatCurrency(p.current, goalCurrency)}</span>
                        <span>of {fmt.formatCurrency(p.target, goalCurrency)}</span>
                      </div>
                    </>
                  )}
                </Link>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
