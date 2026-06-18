/**
 * FlexBudgetView — three big bucket cards + income card.
 * Click a card to expand the categories inside it with per-category spend
 * and a "move to bucket" select.
 */
import { useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { DecryptedCategory } from "@/hooks/useCategories";
import type { DecryptedTxn } from "@/hooks/useTransactions";
import type { FlexBucketKey, FlexBudgetData } from "@/hooks/useBudgets";
import {
  fmtMoney as fmtMoneyRaw,
  fmtMoneyPrecise as fmtMoneyPreciseRaw,
  progressTier,
  spentByCategory,
  tierClasses,
  totalIncome,
} from "@/lib/budget-math";
import { numberLocale } from "@/lib/locale";
import { useDashboardPrefs } from "@/hooks/useDashboardPrefs";

const BUCKETS: { key: FlexBucketKey; label: string; sub: string }[] = [
  { key: "essentials", label: "Essentials", sub: "Rent, food, transit, health" },
  { key: "wants", label: "Wants", sub: "Fun, shopping, travel" },
  { key: "savings", label: "Savings & debt", sub: "Future-you and Bitcoin" },
];

export function FlexBudgetView({
  data,
  categories,
  transactions,
  onChange,
}: {
  data: FlexBudgetData;
  categories: DecryptedCategory[];
  transactions: DecryptedTxn[];
  onChange: (next: FlexBudgetData) => Promise<void> | void;
}) {
  const [expanded, setExpanded] = useState<FlexBucketKey | null>(null);
  const [editing, setEditing] = useState<FlexBucketKey | "income" | null>(null);
  const [draftValue, setDraftValue] = useState("");
  const { prefs } = useDashboardPrefs();
  const loc = numberLocale(prefs.numberFormat);
  const fmtMoney = (n: number) => fmtMoneyRaw(n, loc);
  const fmtMoneyPrecise = (n: number) => fmtMoneyPreciseRaw(n, loc);

  const spentMap = useMemo(() => spentByCategory(transactions), [transactions]);
  const income = useMemo(() => totalIncome(transactions), [transactions]);

  const bucketTotals = useMemo(() => {
    const totals: Record<FlexBucketKey, number> = {
      essentials: 0,
      wants: 0,
      savings: 0,
    };
    for (const cat of categories) {
      const bucket = data.categoryBucketMap[cat.id];
      if (!bucket) continue;
      totals[bucket] += spentMap[cat.id] ?? 0;
    }
    // Uncategorized → essentials
    totals.essentials += spentMap["__uncategorized__"] ?? 0;
    return totals;
  }, [data.categoryBucketMap, categories, spentMap]);

  const startEdit = (key: FlexBucketKey | "income", current: number) => {
    setEditing(key);
    setDraftValue(String(current));
  };

  const commitEdit = async () => {
    if (!editing) return;
    const value = Math.max(0, Number(draftValue) || 0);
    if (editing === "income") {
      await onChange({ ...data, incomeTarget: value });
    } else {
      await onChange({
        ...data,
        buckets: {
          ...data.buckets,
          [editing]: { ...data.buckets[editing], target: value },
        },
      });
    }
    setEditing(null);
  };

  const moveCategory = async (catId: string, bucket: FlexBucketKey) => {
    await onChange({
      ...data,
      categoryBucketMap: { ...data.categoryBucketMap, [catId]: bucket },
    });
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-3">
        {BUCKETS.map((b) => {
          const target = data.buckets[b.key].target;
          const spent = bucketTotals[b.key];
          const pct = target > 0 ? spent / target : spent > 0 ? 1.5 : 0;
          const tier = progressTier(pct);
          const tc = tierClasses(tier);
          const barClass =
            tier === "over"
              ? "[&>div]:bg-destructive"
              : tier === "warn"
                ? "[&>div]:bg-amber-500"
                : "[&>div]:bg-emerald-600";
          const remaining = target - spent;
          const isExpanded = expanded === b.key;

          return (
            <Card
              key={b.key}
              className={cn(
                "cursor-pointer rounded-xl shadow-sm transition-all hover:shadow-md",
                isExpanded && "ring-2 ring-primary/40",
              )}
              onClick={() => setExpanded(isExpanded ? null : b.key)}
            >
              <CardContent className="space-y-3 p-5">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="text-sm font-semibold">{b.label}</div>
                    <div className="text-xs text-muted-foreground">{b.sub}</div>
                  </div>
                  <ChevronDown
                    className={cn(
                      "h-4 w-4 text-muted-foreground transition-transform",
                      isExpanded && "rotate-180",
                    )}
                  />
                </div>

                {editing === b.key ? (
                  <Input
                    type="number"
                    value={draftValue}
                    autoFocus
                    onChange={(e) => setDraftValue(e.target.value)}
                    onBlur={commitEdit}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitEdit();
                      if (e.key === "Escape") setEditing(null);
                    }}
                    onClick={(e) => e.stopPropagation()}
                    className="h-9 font-mono text-2xl tabular-nums"
                  />
                ) : (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      startEdit(b.key, target);
                    }}
                    className="block text-left font-mono text-3xl font-semibold tabular-nums tracking-tight hover:text-primary"
                  >
                    {fmtMoney(target)}
                  </button>
                )}

                <Progress value={Math.min(pct * 100, 100)} className={cn("h-2", barClass)} />

                <div className="flex items-center justify-between text-xs">
                  <span className="font-mono tabular-nums text-muted-foreground">
                    {fmtMoneyPrecise(spent)} spent
                  </span>
                  <span className={cn("font-medium", tc.text)}>
                    {remaining >= 0
                      ? `${fmtMoney(remaining)} remaining`
                      : `Over by ${fmtMoney(-remaining)}`}
                  </span>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {expanded && (
        <Card className="rounded-xl shadow-sm">
          <CardContent className="p-5">
            <div className="mb-3 text-sm font-semibold">
              Categories in {BUCKETS.find((b) => b.key === expanded)?.label}
            </div>
            <div className="space-y-1">
              {categories
                .filter((c) => c.type !== "income" && c.type !== "transfer")
                .filter((c) => (data.categoryBucketMap[c.id] ?? "essentials") === expanded)
                .sort((a, b) => (spentMap[b.id] ?? 0) - (spentMap[a.id] ?? 0))
                .map((c) => {
                  const spent = spentMap[c.id] ?? 0;
                  return (
                    <div
                      key={c.id}
                      className="flex items-center justify-between rounded-lg px-3 py-2 hover:bg-muted/50"
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className="h-2 w-2 rounded-full"
                          style={{ background: c.color ?? "#94a3b8" }}
                        />
                        <span className="text-sm">{c.name}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="font-mono text-xs tabular-nums text-muted-foreground">
                          {fmtMoneyPrecise(spent)}
                        </span>
                        <Select
                          value={data.categoryBucketMap[c.id] ?? "essentials"}
                          onValueChange={(v) => moveCategory(c.id, v as FlexBucketKey)}
                        >
                          <SelectTrigger className="h-7 w-32 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {BUCKETS.map((b) => (
                              <SelectItem key={b.key} value={b.key}>
                                {b.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  );
                })}
              {categories
                .filter((c) => c.type !== "income" && c.type !== "transfer")
                .filter((c) => (data.categoryBucketMap[c.id] ?? "essentials") === expanded)
                .length === 0 && (
                <div className="py-4 text-center text-xs text-muted-foreground">
                  No categories in this bucket yet.
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Income card */}
      <Card className="rounded-xl shadow-sm">
        <CardContent className="space-y-3 p-5">
          <div className="flex items-start justify-between">
            <div>
              <div className="text-sm font-semibold">Income</div>
              <div className="text-xs text-muted-foreground">
                Money in. Higher than target is good.
              </div>
            </div>
          </div>
          <div className="flex items-end justify-between gap-4">
            <div>
              <div className="text-xs text-muted-foreground">Target</div>
              {editing === "income" ? (
                <Input
                  type="number"
                  value={draftValue}
                  autoFocus
                  onChange={(e) => setDraftValue(e.target.value)}
                  onBlur={commitEdit}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitEdit();
                    if (e.key === "Escape") setEditing(null);
                  }}
                  className="h-9 w-40 font-mono text-2xl tabular-nums"
                />
              ) : (
                <button
                  type="button"
                  onClick={() => startEdit("income", data.incomeTarget)}
                  className="block font-mono text-2xl font-semibold tabular-nums hover:text-primary"
                >
                  {fmtMoney(data.incomeTarget)}
                </button>
              )}
            </div>
            <div className="text-right">
              <div className="text-xs text-muted-foreground">Actual</div>
              <div
                className={cn(
                  "font-mono text-2xl font-semibold tabular-nums",
                  income >= data.incomeTarget && data.incomeTarget > 0
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-foreground",
                )}
              >
                {fmtMoney(income)}
              </div>
            </div>
          </div>
          {data.incomeTarget > 0 && (
            <Progress
              value={Math.min((income / data.incomeTarget) * 100, 100)}
              className="h-2 [&>div]:bg-emerald-600"
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
