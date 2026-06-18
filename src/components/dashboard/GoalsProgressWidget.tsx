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
                      {Math.round(p.pct * 100)}%
                    </span>
                  </div>
                  <Progress value={p.pct * 100} className="mt-2 h-1.5" />
                  <div className="mt-1 flex items-center justify-between text-[11px] font-mono tabular-nums text-muted-foreground">
                    <span>{fmt.formatCurrency(p.current, goalCurrency)}</span>
                    <span>of {fmt.formatCurrency(p.target, goalCurrency)}</span>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
