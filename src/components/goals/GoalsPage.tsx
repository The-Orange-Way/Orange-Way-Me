/**
 * GoalsPage — list view, grouped by Save Up / Pay Down / Completed,
 * with header summary and create button.
 */
import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Plus, Target } from "lucide-react";
import { useGoals, type GoalDraft } from "@/hooks/useGoals";
import { useAccounts } from "@/hooks/useAccounts";
import { useTransactions } from "@/hooks/useTransactions";
import { computeProgress } from "@/lib/goals-math";
import { useLocaleFormat } from "@/lib/locale";
import { useDashboardPrefs } from "@/hooks/useDashboardPrefs";
import { GoalCard } from "./GoalCard";
import { PayoffPlanWidget } from "./PayoffPlanWidget";
import { GoalFormDialog } from "./GoalFormDialog";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

function trailing12MonthRange() {
  const end = new Date();
  const start = new Date();
  start.setMonth(start.getMonth() - 12);
  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
  };
}

export function GoalsPage() {
  const range = useMemo(trailing12MonthRange, []);
  const { goals, loading, createGoal } = useGoals();
  const { accounts } = useAccounts();
  const { items: txns } = useTransactions(range);
  const [openCreate, setOpenCreate] = useState(false);
  const { prefs } = useDashboardPrefs();
  const fmt = useLocaleFormat();
  const fmtMoney = (n: number) => fmt.formatCurrency(n, prefs.primaryCurrency);

  const saveUp = goals.filter((g) => g.type === "save_up" && !g.is_completed);
  const payDown = goals.filter((g) => g.type === "pay_down" && !g.is_completed);
  const completed = goals.filter((g) => g.is_completed);

  const totals = useMemo(() => {
    let saved = 0;
    let target = 0;
    for (const g of goals) {
      if (g.is_completed) continue;
      const p = computeProgress(g, accounts);
      saved += p.current;
      target += p.target;
    }
    const pct = target > 0 ? (saved / target) * 100 : 0;
    return { saved, target, pct };
  }, [goals, accounts]);

  async function handleCreate(draft: GoalDraft) {
    await createGoal(draft);
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Goals</h1>
          {goals.length > 0 ? (
            <p className="mt-1 text-sm text-muted-foreground">
              You've made {fmtMoney(totals.saved)} of {fmtMoney(totals.target)} progress across{" "}
              {goals.length - completed.length} active goal
              {goals.length - completed.length === 1 ? "" : "s"}{" "}
              <span className="font-medium text-foreground tabular-nums">
                ({Math.round(totals.pct)}%)
              </span>
            </p>
          ) : (
            <p className="mt-1 text-sm text-muted-foreground">
              Track money you're saving toward something — or paying down.
            </p>
          )}
        </div>
        <Button onClick={() => setOpenCreate(true)}>
          <Plus className="mr-2 h-4 w-4" /> New goal
        </Button>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-44 rounded-xl" />
          ))}
        </div>
      ) : goals.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center space-y-4">
            <div className="mx-auto h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
              <Target className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h3 className="font-semibold">No goals yet</h3>
              <p className="text-sm text-muted-foreground mt-1">
                Create your first goal to track savings or debt payoff.
              </p>
            </div>
            <Button onClick={() => setOpenCreate(true)}>
              <Plus className="mr-2 h-4 w-4" /> Create your first goal
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-8">
          {saveUp.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                Save Up
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {saveUp.map((g) => (
                  <GoalCard key={g.id} goal={g} accounts={accounts} txns={txns} />
                ))}
              </div>
            </section>
          )}

          {payDown.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                Pay Down
              </h2>
              <PayoffPlanWidget goals={payDown} accounts={accounts} />
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {payDown.map((g) => (
                  <GoalCard key={g.id} goal={g} accounts={accounts} txns={txns} />
                ))}
              </div>
            </section>
          )}

          {completed.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                Completed
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 opacity-70">
                {completed.map((g) => (
                  <GoalCard key={g.id} goal={g} accounts={accounts} txns={txns} />
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      <GoalFormDialog open={openCreate} onOpenChange={setOpenCreate} onSave={handleCreate} />
    </div>
  );
}
