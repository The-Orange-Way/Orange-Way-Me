/**
 * GoalDetailPage — single goal with progress chart, projection, amortization
 * (pay-down), and edit/pause/complete/delete actions.
 */
import { useMemo, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useAsyncAction } from "@/hooks/useAsyncAction";
import {
  ArrowLeft,
  MoreHorizontal,
  Pencil,
  CheckCircle2,
  RotateCcw,
  Trash2,
  AlertCircle,
} from "lucide-react";
import { UNTRACKABLE_COPY } from "@/lib/goal-untrackable-copy";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { useGoals, type GoalDraft } from "@/hooks/useGoals";
import { useAccounts } from "@/hooks/useAccounts";
import { useTransactions } from "@/hooks/useTransactions";
import {
  amortize,
  averageMonthlyContribution,
  balanceHistory,
  computeProgress,
  projectCompletionDate,
} from "@/lib/goals-math";
import { GoalFormDialog } from "./GoalFormDialog";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { toastError } from "@/lib/friendly-error";
import { useLocaleFormat } from "@/lib/locale";
import { unitIsExact } from "@/lib/format";
import { useDashboardPrefs } from "@/hooks/useDashboardPrefs";

function trailing12() {
  const end = new Date();
  const start = new Date();
  start.setMonth(start.getMonth() - 12);
  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
  };
}

export function GoalDetailPage({ id }: { id: string }) {
  const range = useMemo(trailing12, []);
  const navigate = useNavigate();
  const { goals, loading, updateGoal, deleteGoal } = useGoals();
  const { accounts } = useAccounts();
  const { items: txns } = useTransactions(range);
  const { prefs } = useDashboardPrefs();
  const fmt = useLocaleFormat();
  const fmtUSD = (n: number, frac = 0) =>
    fmt.formatCurrency(n, prefs.primaryCurrency, { maximumFractionDigits: frac });
  const [editOpen, setEditOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const goal = goals.find((g) => g.id === id);

  // Hooks must run unconditionally. Capture goal via a closure so the
  // delete handler stays valid across the early-return paths below.
  const [handleDelete, deleting] = useAsyncAction(async () => {
    if (!goal) return;
    try {
      await deleteGoal(goal.id);
      toast.success("Goal deleted");
      navigate({ to: "/goals" });
    } catch (err) {
      toastError(err, "Failed");
    }
  });

  if (loading) {
    return <Skeleton className="h-96 rounded-xl" />;
  }
  if (!goal) {
    return (
      <Card>
        <CardContent className="py-16 text-center space-y-4">
          <p className="text-sm text-muted-foreground">Goal not found.</p>
          <Button asChild variant="outline">
            <Link to="/goals">
              <ArrowLeft className="mr-2 h-4 w-4" /> Back to Goals
            </Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  const prog = computeProgress(goal, accounts);
  const monthly = averageMonthlyContribution(goal, txns);
  const projDate = projectCompletionDate(goal, prog.current, monthly);
  const history = balanceHistory(goal, accounts, txns);

  const linked = accounts.filter((a) => goal.linked_account_ids.includes(a.id));
  const linkedTxns = txns
    .filter((t) => goal.linked_account_ids.includes(t.account_id) && !t.split_parent_id)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 20);

  // Pay down amortization preview
  const debt =
    goal.type === "pay_down"
      ? linked.reduce((sum, a) => sum + Math.abs(Number(a.balance) || 0), 0)
      : 0;
  const apr = Number(goal.interest_rate ?? "0") || 0;
  const minPayment = Number(goal.minimum_payment ?? "0") || 0;
  const previewPayment = Math.max(minPayment, monthly > 0 ? monthly : minPayment);
  const amort = goal.type === "pay_down" ? amortize(debt, apr, previewPayment) : null;

  async function handleUpdate(draft: GoalDraft) {
    if (!goal) return;
    await updateGoal(goal.id, draft);
  }

  async function toggleComplete() {
    if (!goal) return;
    try {
      await updateGoal(goal.id, { is_completed: !goal.is_completed });
      toast.success(goal.is_completed ? "Goal reopened" : "Goal marked complete");
    } catch (err) {
      toastError(err, "Failed");
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Button asChild variant="ghost" size="sm">
          <Link to="/goals">
            <ArrowLeft className="mr-2 h-4 w-4" /> Back to Goals
          </Link>
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setEditOpen(true)}>
              <Pencil className="mr-2 h-4 w-4" /> Edit
            </DropdownMenuItem>
            <DropdownMenuItem onClick={toggleComplete}>
              {goal.is_completed ? (
                <>
                  <RotateCcw className="mr-2 h-4 w-4" /> Reopen goal
                </>
              ) : (
                <>
                  <CheckCircle2 className="mr-2 h-4 w-4" /> Mark complete
                </>
              )}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setConfirmDelete(true)} className="text-destructive">
              <Trash2 className="mr-2 h-4 w-4" /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div>
        <p className="text-xs uppercase tracking-wider text-muted-foreground">
          {goal.type === "save_up" ? "Save Up" : "Pay Down"}
        </p>
        <h1 className="text-3xl font-semibold tracking-tight mt-1">{goal.name}</h1>
      </div>

      <Card>
        <CardContent className="p-6 space-y-4">
          {/*
           * A progress bar is a claim that progress is measurable. When
           * goals-math says it is not, this page used to draw a confident zero
           * percent anyway, contradicting the "not tracking yet" the list tile
           * had just shown for the same goal. This is the screen someone opens
           * BECAUSE the list flagged it, so it is the worst place to restate
           * the number as fact (DL-1588).
           */}
          {prog.untrackableReason ? (
            <>
              <div className="flex items-baseline justify-between font-mono tabular-nums">
                <span className="text-3xl font-semibold">{fmtUSD(prog.current)}</span>
                {/*
                 * Suppressed for no_target_set only. Printing "of $0" states a
                 * target the goal does not carry, which is the same unsupported
                 * claim as the bar. The other two reasons do have a real target.
                 */}
                {prog.untrackableReason !== "no_target_set" && (
                  <span className="text-sm text-muted-foreground">of {fmtUSD(prog.target)}</span>
                )}
              </div>
              <div className="flex items-start gap-2 rounded-md bg-muted/60 px-3 py-2 text-sm text-muted-foreground">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <span>{UNTRACKABLE_COPY[prog.untrackableReason]}</span>
              </div>
            </>
          ) : (
            <>
              <div className="flex items-baseline justify-between font-mono tabular-nums">
                <span className="text-3xl font-semibold">{fmtUSD(prog.current)}</span>
                <span className="text-sm text-muted-foreground">of {fmtUSD(prog.target)}</span>
              </div>
              <Progress value={prog.pct * 100} className="h-3" />
            </>
          )}
          <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
            <div>
              <span className="text-muted-foreground">Remaining: </span>
              <span className="font-medium tabular-nums">{fmtUSD(prog.remaining)}</span>
            </div>
            {prog.daysToTarget != null && (
              <div className={prog.isOverdue ? "text-destructive font-medium" : ""}>
                <span className="text-muted-foreground">Target: </span>
                <span className="tabular-nums">
                  {fmt.formatDate(goal.target_date)} ({prog.daysToTarget} day
                  {Math.abs(prog.daysToTarget) === 1 ? "" : "s"})
                </span>
              </div>
            )}
            {monthly !== 0 && (
              <div>
                <span className="text-muted-foreground">3mo avg: </span>
                <span className="font-medium tabular-nums">
                  {fmtUSD(monthly)}/mo {goal.type === "save_up" ? "saved" : "paid"}
                </span>
              </div>
            )}
            {projDate && monthly > 0 && (
              <div>
                <span className="text-muted-foreground">On pace for: </span>
                <span className="font-medium">
                  {fmt.formatDate(projDate, { month: "long", year: "numeric" })}
                </span>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Progress over the last 12 months</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={history}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis
                  dataKey="date"
                  tickFormatter={(d) => fmt.formatDate(new Date(d), { month: "short" })}
                  className="text-xs"
                />
                <YAxis tickFormatter={(v) => fmtUSD(Number(v))} className="text-xs" width={70} />
                <Tooltip
                  formatter={((v: number) => fmtUSD(v)) as never}
                  contentStyle={{
                    background: "hsl(var(--popover))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="value"
                  stroke="hsl(var(--primary))"
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {goal.type === "pay_down" && amort && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Payoff preview</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>
              At <span className="font-mono tabular-nums">{fmtUSD(previewPayment)}/month</span> and{" "}
              {apr.toFixed(2)}% APR, this debt will be paid off in{" "}
              <span className="font-semibold">
                {amort.months} month{amort.months === 1 ? "" : "s"}
              </span>{" "}
              ({fmt.formatDate(amort.payoffDate, { month: "long", year: "numeric" })}).
            </p>
            <p className="text-muted-foreground">
              Total interest paid:{" "}
              <span className="font-mono tabular-nums">{fmtUSD(amort.totalInterest, 2)}</span>
            </p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Linked account{linked.length === 1 ? "" : "s"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {linked.length === 0 ? (
            <p className="text-sm text-muted-foreground">No accounts linked.</p>
          ) : (
            <div className="space-y-2">
              {linked.map((a) => (
                <div
                  key={a.id}
                  className="flex items-center justify-between rounded-lg border border-border p-3"
                >
                  <div>
                    <div className="font-medium">{a.name}</div>
                    <div className="text-xs text-muted-foreground capitalize">
                      {a.type.replace("_", " ")}
                    </div>
                  </div>
                  <div className="font-mono tabular-nums text-sm">
                    {fmt.formatCurrency(Number(a.balance) || 0, a.currency, {
                      maximumFractionDigits: 2,
                      unitIsExact: unitIsExact(a.format_version),
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent contributions</CardTitle>
        </CardHeader>
        <CardContent>
          {linkedTxns.length === 0 ? (
            <p className="text-sm text-muted-foreground">No recent transactions.</p>
          ) : (
            <div className="space-y-1">
              {linkedTxns.map((t) => {
                const amt = Number(t.amount);
                return (
                  <div
                    key={t.id}
                    className="flex items-center justify-between text-sm py-2 border-b border-border last:border-0"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{t.merchant ?? t.description}</div>
                      <div className="text-xs text-muted-foreground">{fmt.formatDate(t.date)}</div>
                    </div>
                    <div
                      className={`font-mono tabular-nums text-sm font-medium ${
                        amt >= 0 ? "text-emerald-600 dark:text-emerald-500" : "text-destructive"
                      }`}
                    >
                      {amt >= 0 ? "+" : ""}
                      {fmtUSD(amt, 2)}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <GoalFormDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        initial={goal}
        onSave={handleUpdate}
      />

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this goal?</AlertDialogTitle>
            <AlertDialogDescription>
              This only deletes the goal. Your linked accounts and their transactions are not
              touched.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void handleDelete();
              }}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
