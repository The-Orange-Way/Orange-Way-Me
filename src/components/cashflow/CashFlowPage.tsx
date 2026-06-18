/**
 * CashFlowPage — Monarch-style monthly cash-flow view.
 *
 * - 6-month bars + net line chart at the top (reuses the dashboard's
 *   existing CashFlowChart).
 * - Current month summary card: Income / Expenses / Savings.
 * - MonthNavigator lets the user step through months.
 */
import { useMemo, useState } from "react";
import { ArrowDownCircle, ArrowUpCircle, PiggyBank } from "lucide-react";
import { useTransactions, type DecryptedTxn } from "@/hooks/useTransactions";
import { useCategories } from "@/hooks/useCategories";
import { monthRange, type DateRange } from "@/lib/date-ranges";
import { MonthNavigator } from "@/components/transactions/MonthNavigator";
import { CashFlowChart } from "@/components/dashboard/CashFlowChart";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

function formatUSD(n: number): string {
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  return `${sign}$${abs.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function CashFlowPage() {
  const [anchor, setAnchor] = useState(new Date());
  const [range, setRange] = useState<DateRange>(monthRange(new Date()));

  const { totals, items } = useTransactions({ startDate: range.start, endDate: range.end });
  const { categories } = useCategories();
  const monthLabel = useMemo(
    () => anchor.toLocaleDateString(undefined, { month: "long", year: "numeric" }),
    [anchor],
  );

  const income = totals.inflow;
  const expenses = Math.abs(totals.outflow);
  const savings = income - expenses;
  const savingsRate = income > 0 ? Math.round((savings / income) * 100) : null;

  return (
    <div className="space-y-6 px-4 py-4 sm:px-6 sm:py-6">
      <header className="space-y-3">
        <h1 className="text-2xl font-bold tracking-tight">Cash flow</h1>
        <p className="text-sm text-muted-foreground">
          What came in, what went out, and what stayed.
        </p>
        <MonthNavigator
          anchor={anchor}
          range={range}
          onChange={(a, r) => {
            setAnchor(a);
            setRange(r);
          }}
        />
      </header>

      {/* 6-month trend chart. Already mobile-friendly via ResponsiveContainer. */}
      <CashFlowChart />

      {/* Current month summary */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          {monthLabel}
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <SummaryRow
            icon={<ArrowDownCircle className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />}
            label="Income"
            value={formatUSD(income)}
            tone="positive"
          />
          <SummaryRow
            icon={<ArrowUpCircle className="h-5 w-5 text-destructive" />}
            label="Expenses"
            value={formatUSD(expenses)}
            tone="negative"
          />
          <SummaryRow
            icon={<PiggyBank className="h-5 w-5 text-primary" />}
            label="Savings"
            value={formatUSD(savings)}
            sub={savingsRate !== null ? `${savingsRate}% of income` : undefined}
            tone={savings >= 0 ? "positive" : "negative"}
          />
        </div>
      </section>

      {/* Breakdown tabs — Monarch shows Category / Group / Merchant. We
          start with Category and Merchant; Group is a future addition once
          we surface category groups in the UI. */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Where it went
        </h2>
        <Tabs defaultValue="category">
          <TabsList>
            <TabsTrigger value="category">Category</TabsTrigger>
            <TabsTrigger value="merchant">Merchant</TabsTrigger>
          </TabsList>
          <TabsContent value="category" className="mt-3">
            <BreakdownList rows={buildCategoryBreakdown(items, categories)} />
          </TabsContent>
          <TabsContent value="merchant" className="mt-3">
            <BreakdownList rows={buildMerchantBreakdown(items)} />
          </TabsContent>
        </Tabs>
      </section>
    </div>
  );
}

interface BreakdownRow {
  key: string;
  label: string;
  amount: number;
  count: number;
  color?: string | null;
}

function buildCategoryBreakdown(
  items: DecryptedTxn[],
  categories: Array<{ id: string; name: string; color: string | null }>,
): BreakdownRow[] {
  const catMap = new Map(categories.map((c) => [c.id, c]));
  const totals = new Map<string, BreakdownRow>();
  for (const t of items) {
    const n = Number(t.amount);
    if (!Number.isFinite(n) || n >= 0) continue; // expenses only
    const cat = t.category_id ? catMap.get(t.category_id) : null;
    const key = cat?.id ?? "__uncat";
    const label = cat?.name ?? "Uncategorized";
    const color = cat?.color ?? null;
    const cur = totals.get(key);
    if (cur) {
      cur.amount += Math.abs(n);
      cur.count += 1;
    } else {
      totals.set(key, { key, label, amount: Math.abs(n), count: 1, color });
    }
  }
  return Array.from(totals.values()).sort((a, b) => b.amount - a.amount);
}

function buildMerchantBreakdown(items: DecryptedTxn[]): BreakdownRow[] {
  const totals = new Map<string, BreakdownRow>();
  for (const t of items) {
    const n = Number(t.amount);
    if (!Number.isFinite(n) || n >= 0) continue;
    const label = (t.merchant ?? t.description ?? "").trim() || "(no description)";
    const key = label.toLowerCase();
    const cur = totals.get(key);
    if (cur) {
      cur.amount += Math.abs(n);
      cur.count += 1;
    } else {
      totals.set(key, { key, label, amount: Math.abs(n), count: 1, color: null });
    }
  }
  return Array.from(totals.values()).sort((a, b) => b.amount - a.amount);
}

function BreakdownList({ rows }: { rows: BreakdownRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
        No expenses to break down.
      </div>
    );
  }
  const max = Math.max(...rows.map((r) => r.amount));
  return (
    <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
      {rows.map((r) => {
        const pct = max > 0 ? Math.round((r.amount / max) * 100) : 0;
        return (
          <li key={r.key} className="space-y-1.5 px-3 py-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-2 truncate text-sm font-medium">
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ background: r.color ?? "#94a3b8" }}
                  aria-hidden="true"
                />
                <span className="truncate">{r.label}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  · {r.count} {r.count === 1 ? "txn" : "txns"}
                </span>
              </span>
              <span className="shrink-0 font-mono text-sm font-semibold tabular-nums">
                {formatUSD(r.amount)}
              </span>
            </div>
            <div className="h-1 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${pct}%`,
                  background: r.color ?? "var(--primary, #f97316)",
                }}
                aria-hidden="true"
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function SummaryRow({
  icon,
  label,
  value,
  sub,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  tone: "positive" | "negative";
}) {
  return (
    <Card>
      <CardContent className="flex items-center justify-between gap-3 p-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="shrink-0">{icon}</div>
          <div className="min-w-0">
            <div className="text-sm font-medium text-foreground">{label}</div>
            {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
          </div>
        </div>
        <div
          className={cn(
            "font-mono text-base font-semibold tabular-nums",
            tone === "positive" ? "text-emerald-600 dark:text-emerald-400" : "text-destructive",
          )}
        >
          {value}
        </div>
      </CardContent>
    </Card>
  );
}
