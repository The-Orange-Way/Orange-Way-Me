/**
 * ThisMonthSummary — income, spending, net + delta vs last month + budget pulse.
 */
import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowDown, ArrowUp, Minus } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { useAccounts } from "@/hooks/useAccounts";
import { useTransactions } from "@/hooks/useTransactions";
import { useBudget } from "@/hooks/useBudgets";
import { useCategories } from "@/hooks/useCategories";
import { useDashboardPrefs } from "@/hooks/useDashboardPrefs";
import { thisMonthSummary } from "@/lib/dashboard-math";
import { spentByCategory } from "@/lib/budget-math";
import { useLocaleFormat } from "@/lib/locale";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";

function monthRange(d: Date) {
  const start = new Date(d.getFullYear(), d.getMonth() - 1, 1);
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
  };
}

export function ThisMonthSummary() {
  const { prefs } = useDashboardPrefs();
  const fmt = useLocaleFormat();
  const anchor = useMemo(() => new Date(), []);
  const range = useMemo(() => monthRange(anchor), [anchor]);
  const { accounts } = useAccounts();
  const { items: txns, loading } = useTransactions(range);
  const { budget } = useBudget(anchor);
  const { categories } = useCategories();

  const summary = useMemo(
    () => thisMonthSummary(accounts, txns, prefs.primaryCurrency, anchor),
    [accounts, txns, prefs.primaryCurrency, anchor],
  );

  // Filter txns to current month only for budget calc
  const thisMonthTxns = useMemo(() => {
    const ym = `${anchor.getFullYear()}-${String(anchor.getMonth() + 1).padStart(2, "0")}`;
    return txns.filter((t) => t.date.startsWith(ym));
  }, [txns, anchor]);

  const monthName = anchor.toLocaleDateString(undefined, { month: "long" });

  // Budget pulse line
  const budgetLine = useMemo(() => {
    if (!budget) return null;
    if (budget.mode === "category") {
      const data = budget.data as {
        mode: "category";
        categories: Record<string, { target: number }>;
      };
      const totalTarget = Object.values(data.categories).reduce((s, c) => s + c.target, 0);
      if (totalTarget === 0) return null;
      const totalSpent = Object.values(spentByCategory(thisMonthTxns)).reduce((s, n) => s + n, 0);
      const pct = Math.round((totalSpent / totalTarget) * 100);
      const status = pct < 80 ? "On track." : pct < 100 ? "Watch it." : "Over.";
      return `You've spent ${pct}% of ${monthName}'s budget. ${status}`;
    } else {
      const data = budget.data as {
        mode: "flex";
        buckets: Record<string, { target: number }>;
        categoryBucketMap: Record<string, string>;
      };
      const spent = spentByCategory(thisMonthTxns);
      const totals: Record<string, number> = { essentials: 0, wants: 0, savings: 0 };
      for (const c of categories) {
        const bucket = data.categoryBucketMap[c.id] ?? "essentials";
        totals[bucket] = (totals[bucket] ?? 0) + (spent[c.id] ?? 0);
      }
      const fmt = (k: string) =>
        data.buckets[k]?.target > 0
          ? `${Math.round((totals[k] / data.buckets[k].target) * 100)}%`
          : "—";
      return `Essentials ${fmt("essentials")}, Wants ${fmt("wants")}, Savings ${fmt("savings")}.`;
    }
  }, [budget, thisMonthTxns, categories, monthName]);

  return (
    <Card className="h-full">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium text-muted-foreground">{monthName}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {loading ? (
          <div className="space-y-3">
            <Skeleton className="h-6 w-32" />
            <Skeleton className="h-6 w-32" />
            <Skeleton className="h-6 w-32" />
          </div>
        ) : (
          <>
            <StatRow
              label="Income"
              value={summary.income}
              formatted={fmt.formatCurrency(summary.income, prefs.primaryCurrency, { unitIsExact: true })}
              deltaPct={summary.incomeDeltaPct}
              positiveIsGood
            />
            <StatRow
              label="Spending"
              value={summary.spending}
              formatted={fmt.formatCurrency(summary.spending, prefs.primaryCurrency, { unitIsExact: true })}
              deltaPct={summary.spendingDeltaPct}
              positiveIsGood={false}
            />
            <div className="border-t border-border pt-4">
              <div className="text-xs uppercase tracking-wider text-muted-foreground">
                Net savings
              </div>
              <div
                className={`mt-1 font-mono text-2xl font-semibold tabular-nums ${
                  summary.net >= 0 ? "text-emerald-600 dark:text-emerald-500" : "text-destructive"
                }`}
              >
                {fmt.formatCurrency(summary.net, prefs.primaryCurrency, { unitIsExact: true })}
              </div>
            </div>
            <div className="rounded-lg bg-muted/40 p-3 text-xs text-muted-foreground">
              {budgetLine ? (
                <span>{budgetLine}</span>
              ) : (
                <div className="flex items-center justify-between gap-2">
                  <span>No budget set for {monthName}.</span>
                  <Button asChild size="sm" variant="outline" className="h-7">
                    <Link to="/budgets">Set up</Link>
                  </Button>
                </div>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function StatRow({
  label,
  formatted,
  deltaPct,
  positiveIsGood,
}: {
  label: string;
  value: number;
  formatted: string;
  deltaPct: number | null;
  positiveIsGood: boolean;
}) {
  let DeltaIcon = Minus;
  let deltaClass = "text-muted-foreground";
  if (deltaPct != null && Math.abs(deltaPct) >= 0.5) {
    if (deltaPct > 0) {
      DeltaIcon = ArrowUp;
      deltaClass = positiveIsGood ? "text-emerald-600 dark:text-emerald-500" : "text-destructive";
    } else {
      DeltaIcon = ArrowDown;
      deltaClass = positiveIsGood ? "text-destructive" : "text-emerald-600 dark:text-emerald-500";
    }
  }

  return (
    <div>
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-0.5 flex items-baseline gap-2">
        <span className="font-mono text-xl font-semibold tabular-nums">{formatted}</span>
        {deltaPct != null && (
          <span className={`inline-flex items-center gap-0.5 text-xs ${deltaClass}`}>
            <DeltaIcon className="h-3 w-3" />
            {Math.abs(deltaPct).toFixed(0)}%
          </span>
        )}
      </div>
    </div>
  );
}
