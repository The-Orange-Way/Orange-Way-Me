/**
 * BudgetSummaryHeader — Monarch-inspired "Left to budget" banner + summary
 * row. Sits above whichever budget view (Flex / Category) is active.
 *
 * Reads:
 *   - incomeTarget from the budget data
 *   - planned total: sum of bucket targets (flex) or category targets (category)
 *   - actual spend: sum of |negative| transaction amounts for the month
 *   - actual income: sum of positive transaction amounts for the month
 *
 * Left to budget = incomeTarget − totalPlanned.
 * Positive → green pill (room to allocate). Negative → red banner (over).
 */
import { useMemo } from "react";
import { Info } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DecryptedTxn } from "@/hooks/useTransactions";
import type { BudgetData, FlexBudgetData, CategoryBudgetData } from "@/hooks/useBudgets";

function formatCurrencyShort(n: number, currency = "USD"): string {
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  try {
    return `${sign}${new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(abs)}`;
  } catch {
    return `${sign}$${abs.toFixed(0)}`;
  }
}

function totalPlanned(data: BudgetData): number {
  if (data.mode === "flex") {
    const d = data as FlexBudgetData;
    return Object.values(d.buckets).reduce((acc, b) => acc + (b.target ?? 0), 0);
  }
  const d = data as CategoryBudgetData;
  return Object.values(d.categories).reduce((acc, c) => acc + (c.target ?? 0), 0);
}

export function BudgetSummaryHeader({
  data,
  transactions,
}: {
  data: BudgetData;
  transactions: DecryptedTxn[];
}) {
  const { incomeTarget, planned, income, expenses } = useMemo(() => {
    const planned = totalPlanned(data);
    let income = 0;
    let expenses = 0;
    for (const t of transactions) {
      const n = Number(t.amount);
      if (!Number.isFinite(n)) continue;
      if (n > 0) income += n;
      else expenses += Math.abs(n);
    }
    return { incomeTarget: data.incomeTarget ?? 0, planned, income, expenses };
  }, [data, transactions]);

  const leftToBudget = (incomeTarget || 0) - planned;
  const overBudget = leftToBudget < 0;

  return (
    <div className="space-y-3">
      {/* Left-to-budget banner. Monarch shows this prominently at the top
          with a red bar when overspent; we match that pattern. */}
      <div
        className={cn(
          "flex items-center justify-between gap-3 rounded-lg px-4 py-3",
          overBudget
            ? "bg-destructive/10 text-destructive"
            : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
        )}
      >
        <div className="flex items-center gap-2 text-sm font-medium">
          <span>Left to budget</span>
          <Info className="h-3.5 w-3.5 opacity-70" aria-hidden="true" />
        </div>
        <div className="font-mono text-lg font-bold tabular-nums">
          {formatCurrencyShort(leftToBudget)}
        </div>
      </div>

      {/* Income / Expenses / Planned summary row. Three small cards on
          desktop, full-width stack on mobile. */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <SummaryCell label="Income" actual={income} target={incomeTarget} tone="positive" />
        <SummaryCell label="Expenses" actual={expenses} target={planned} tone="negative" />
        <SummaryCell
          label="Remaining"
          actual={Math.max(0, planned - expenses)}
          target={planned}
          tone={expenses > planned ? "negative" : "neutral"}
        />
      </div>
    </div>
  );
}

function SummaryCell({
  label,
  actual,
  target,
  tone,
}: {
  label: string;
  actual: number;
  target: number;
  tone: "positive" | "negative" | "neutral";
}) {
  const pct = target > 0 ? Math.min(100, Math.round((actual / target) * 100)) : 0;
  const toneClass =
    tone === "positive" ? "bg-emerald-500" : tone === "negative" ? "bg-destructive" : "bg-primary";
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        <span className="font-mono text-sm font-semibold tabular-nums">
          {formatCurrencyShort(actual)}
          {target > 0 && (
            <span className="ml-1 text-xs text-muted-foreground">
              / {formatCurrencyShort(target)}
            </span>
          )}
        </span>
      </div>
      {target > 0 && (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className={cn("h-full transition-all", toneClass)}
            style={{ width: `${pct}%` }}
            aria-hidden="true"
          />
        </div>
      )}
    </div>
  );
}
