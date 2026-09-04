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
import { summariseGoals, sharedAccountGoalNames } from "@/lib/goals-math";
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

  const totals = useMemo(() => summariseGoals(goals, accounts), [goals, accounts]);
  const sharedWith = useMemo(() => sharedAccountGoalNames(goals), [goals]);

  async function handleCreate(draft: GoalDraft) {
    await createGoal(draft);
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Goals</h1>
          {goals.length === 0 ? (
            <p className="mt-1 text-sm text-muted-foreground">
              Track money you're saving toward something, or paying down.
            </p>
          ) : totals.active === 0 ? (
            /*
             * Goals exist but every one is complete. The old line reported
             * "$0 of $0 progress across 0 active goals (0%)" here, which reads
             * like a failure to someone who has just finished everything.
             */
            <p className="mt-1 text-sm text-muted-foreground">
              Every goal you have set is complete.
            </p>
          ) : totals.counted === 0 ? (
            /*
             * Every active goal is one we cannot measure, so there is no
             * percentage to report. Saying "0% of $0" here would be the same
             * false claim the tiles already refuse to make (DL-1603).
             */
            <p className="mt-1 text-sm text-muted-foreground">
              None of your {totals.active} active goal
              {totals.active === 1 ? "" : "s"} can be measured yet.
            </p>
          ) : (
            <p className="mt-1 text-sm text-muted-foreground">
              {/*
               * PROVISIONAL COPY (OWM-T0674): dedupes an account backing two
               * goals down to what the customer actually holds, instead of
               * summing each goal's own claim on it. Wording pending
               * orangeway/sr-copywriter sign-off, see the ticket note.
               */}
              {fmtMoney(totals.saved)} saved across{" "}
              {totals.counted < totals.active
                ? `${totals.counted} of ${totals.active} active goals`
                : `${totals.counted} active goal${totals.counted === 1 ? "" : "s"}`}
              , against {fmtMoney(totals.target)} of targets{" "}
              <span className="font-medium text-foreground tabular-nums">
                ({Math.round(totals.pct * 100)}%)
              </span>
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
                  <GoalCard
                    key={g.id}
                    goal={g}
                    accounts={accounts}
                    txns={txns}
                    sharedWith={sharedWith.get(g.id) ?? []}
                  />
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
