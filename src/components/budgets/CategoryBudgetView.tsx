/**
 * CategoryBudgetView — table grouped by top-level parent category, with
 * inline-editable budget cells, rollover toggles, and live spend.
 */
import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { DecryptedCategory, CategoryTreeNode } from "@/hooks/useCategories";
import type { DecryptedTxn } from "@/hooks/useTransactions";
import type { CategoryBudgetData, BudgetRecord } from "@/hooks/useBudgets";
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

interface RolloverInfo {
  carry: number; // positive or negative dollars from previous month
}

export function CategoryBudgetView({
  data,
  categories,
  tree,
  transactions,
  previousBudget,
  previousTransactions,
  onChange,
}: {
  data: CategoryBudgetData;
  categories: DecryptedCategory[];
  tree: CategoryTreeNode[];
  transactions: DecryptedTxn[];
  previousBudget: BudgetRecord | null;
  previousTransactions: DecryptedTxn[];
  onChange: (next: CategoryBudgetData) => Promise<void> | void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftValue, setDraftValue] = useState("");
  const { prefs } = useDashboardPrefs();
  const loc = numberLocale(prefs.numberFormat);
  const fmtMoney = (n: number) => fmtMoneyRaw(n, loc);
  const fmtMoneyPrecise = (n: number) => fmtMoneyPreciseRaw(n, loc);

  const spentMap = useMemo(() => spentByCategory(transactions), [transactions]);
  const income = useMemo(() => totalIncome(transactions), [transactions]);

  // Compute previous-month rollover carry per category.
  const prevSpentMap = useMemo(() => spentByCategory(previousTransactions), [previousTransactions]);
  const rolloverMap = useMemo<Record<string, RolloverInfo>>(() => {
    const out: Record<string, RolloverInfo> = {};
    if (!previousBudget || previousBudget.mode !== "category" || !data.categories) return out;
    const prevData = previousBudget.data as CategoryBudgetData;
    for (const [catId, cfg] of Object.entries(data.categories)) {
      if (!cfg.rollover) continue;
      const prevTarget = prevData.categories?.[catId]?.target ?? 0;
      const prevSpent = prevSpentMap[catId] ?? 0;
      out[catId] = { carry: prevTarget - prevSpent };
    }
    return out;
  }, [data.categories, previousBudget, prevSpentMap]);

  const expenseTree = useMemo(
    () => tree.filter((n) => n.type !== "income" && n.type !== "transfer"),
    [tree],
  );

  // Total assigned (sum of all targets, only top-level + leaf entries that have config)
  const totalAssigned = useMemo(
    () => Object.values(data.categories).reduce((acc, c) => acc + (c.target || 0), 0),
    [data.categories],
  );

  const startEdit = (catId: string, current: number) => {
    setEditingId(catId);
    setDraftValue(String(current));
  };
  const commitEdit = async () => {
    if (!editingId) return;
    const value = Math.max(0, Number(draftValue) || 0);
    const existing = data.categories[editingId] ?? { target: 0, rollover: false };
    await onChange({
      ...data,
      categories: {
        ...data.categories,
        [editingId]: { ...existing, target: value },
      },
    });
    setEditingId(null);
  };

  const toggleRollover = async (catId: string) => {
    const existing = data.categories[catId] ?? { target: 0, rollover: false };
    await onChange({
      ...data,
      categories: {
        ...data.categories,
        [catId]: { ...existing, rollover: !existing.rollover },
      },
    });
  };

  const setIncomeTarget = async (value: number) => {
    await onChange({ ...data, incomeTarget: Math.max(0, value) });
  };

  const toggleZeroBased = async () => {
    await onChange({ ...data, zeroBased: !data.zeroBased });
  };

  const renderRow = (cat: DecryptedCategory, depth: number) => {
    const cfg = data.categories[cat.id] ?? { target: 0, rollover: false };
    const spent = spentMap[cat.id] ?? 0;
    const carry = rolloverMap[cat.id]?.carry ?? 0;
    const effectiveTarget = cfg.target + (cfg.rollover ? carry : 0);
    const remaining = effectiveTarget - spent;
    const pct = effectiveTarget > 0 ? spent / effectiveTarget : spent > 0 ? 1.5 : 0;
    const tier = progressTier(pct);
    const tc = tierClasses(tier);

    return (
      <tr
        key={cat.id}
        className={cn(
          "border-b border-border/60 transition-colors",
          tier === "over" && "bg-destructive/5",
        )}
      >
        <td className="py-2.5 pl-3" style={{ paddingLeft: 12 + depth * 16 }}>
          <div className="flex items-center gap-2">
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ background: cat.color ?? "#94a3b8" }}
            />
            <span className="text-sm">{cat.name}</span>
          </div>
        </td>
        <td className="py-2.5 text-right">
          {editingId === cat.id ? (
            <Input
              type="number"
              autoFocus
              value={draftValue}
              onChange={(e) => setDraftValue(e.target.value)}
              onBlur={commitEdit}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitEdit();
                if (e.key === "Escape") setEditingId(null);
              }}
              className="ml-auto h-7 w-24 text-right font-mono tabular-nums"
            />
          ) : (
            <button
              type="button"
              onClick={() => startEdit(cat.id, cfg.target)}
              className="font-mono text-sm tabular-nums hover:text-primary"
            >
              {fmtMoney(cfg.target)}
            </button>
          )}
          {cfg.rollover && carry !== 0 && (
            <div
              className={cn(
                "mt-0.5 text-[10px] font-mono tabular-nums",
                carry < 0 ? "text-destructive" : "text-muted-foreground",
              )}
            >
              {carry >= 0 ? "+" : "−"}
              {fmtMoney(Math.abs(carry))} from last month
            </div>
          )}
        </td>
        <td className={cn("py-2.5 text-right font-mono text-sm tabular-nums", tc.text)}>
          {fmtMoneyPrecise(spent)}
        </td>
        <td
          className={cn(
            "py-2.5 pr-3 text-right font-mono text-sm tabular-nums",
            remaining < 0 ? "text-destructive" : "text-foreground",
          )}
        >
          {remaining < 0 ? `-${fmtMoney(-remaining)}` : fmtMoney(remaining)}
        </td>
        <td className="py-2.5 pr-3 text-right">
          <Switch
            checked={cfg.rollover}
            onCheckedChange={() => toggleRollover(cat.id)}
            aria-label="Rollover"
          />
        </td>
      </tr>
    );
  };

  const renderGroup = (root: CategoryTreeNode) => {
    const allInGroup = [root, ...flatten(root.children)];
    const groupBudget = allInGroup.reduce(
      (acc, c) => acc + (data.categories[c.id]?.target ?? 0),
      0,
    );
    const groupSpent = allInGroup.reduce((acc, c) => acc + (spentMap[c.id] ?? 0), 0);
    const groupRemaining = groupBudget - groupSpent;

    return (
      <tbody key={root.id} className="border-b-2 border-border">
        <tr className="bg-muted/30">
          <td className="py-2.5 pl-3 text-sm font-semibold">{root.name}</td>
          <td className="py-2.5 text-right font-mono text-sm font-semibold tabular-nums">
            {fmtMoney(groupBudget)}
          </td>
          <td className="py-2.5 text-right font-mono text-sm font-semibold tabular-nums">
            {fmtMoneyPrecise(groupSpent)}
          </td>
          <td
            className={cn(
              "py-2.5 pr-3 text-right font-mono text-sm font-semibold tabular-nums",
              groupRemaining < 0 ? "text-destructive" : "",
            )}
          >
            {groupRemaining < 0 ? `-${fmtMoney(-groupRemaining)}` : fmtMoney(groupRemaining)}
          </td>
          <td />
        </tr>
        {renderRow(root, 0)}
        {flatten(root.children).map((c) => renderRow(c, 1))}
      </tbody>
    );
  };

  const grandBudget = totalAssigned;
  const grandSpent = Object.values(spentMap).reduce((a, b) => a + b, 0);
  const grandRemaining = grandBudget - grandSpent;
  const zeroBasedDelta = data.incomeTarget - totalAssigned;

  return (
    <div className="space-y-4">
      {/* Income + zero-based control */}
      <Card className="rounded-xl shadow-sm">
        <CardContent className="flex flex-wrap items-center justify-between gap-4 p-4">
          <div className="flex items-center gap-6">
            <div>
              <div className="text-xs text-muted-foreground">Income target</div>
              <Input
                type="number"
                value={data.incomeTarget || ""}
                onChange={(e) => setIncomeTarget(Number(e.target.value))}
                className="mt-1 h-8 w-32 font-mono tabular-nums"
                placeholder="0"
              />
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Actual income</div>
              <div className="mt-1 font-mono text-lg font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                {fmtMoney(income)}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Label htmlFor="zero-based" className="text-sm">
              Zero-based budget
            </Label>
            <Switch id="zero-based" checked={data.zeroBased} onCheckedChange={toggleZeroBased} />
          </div>
        </CardContent>
      </Card>

      {data.zeroBased && Math.abs(zeroBasedDelta) > 0.01 && (
        <div
          className={cn(
            "rounded-lg border px-4 py-3 text-sm",
            zeroBasedDelta > 0
              ? "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400"
              : "border-destructive/40 bg-destructive/10 text-destructive",
          )}
        >
          {zeroBasedDelta > 0
            ? `You have ${fmtMoney(zeroBasedDelta)} unassigned.`
            : `You're ${fmtMoney(-zeroBasedDelta)} over-assigned.`}
        </div>
      )}

      <Card className="overflow-hidden rounded-xl shadow-sm">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border bg-muted/20 text-left text-xs uppercase tracking-wider text-muted-foreground">
              <th className="py-2 pl-3">Category</th>
              <th className="py-2 text-right">Budget</th>
              <th className="py-2 text-right">Spent</th>
              <th className="py-2 pr-3 text-right">Remaining</th>
              <th className="py-2 pr-3 text-right">Rollover</th>
            </tr>
          </thead>
          {expenseTree.map(renderGroup)}
          <tfoot>
            <tr className="bg-muted/40">
              <td className="py-3 pl-3 text-sm font-bold">Total</td>
              <td className="py-3 text-right font-mono text-sm font-bold tabular-nums">
                {fmtMoney(grandBudget)}
              </td>
              <td className="py-3 text-right font-mono text-sm font-bold tabular-nums">
                {fmtMoneyPrecise(grandSpent)}
              </td>
              <td
                className={cn(
                  "py-3 pr-3 text-right font-mono text-sm font-bold tabular-nums",
                  grandRemaining < 0 ? "text-destructive" : "",
                )}
              >
                {grandRemaining < 0 ? `-${fmtMoney(-grandRemaining)}` : fmtMoney(grandRemaining)}
              </td>
              <td />
            </tr>
          </tfoot>
        </table>
      </Card>
    </div>
  );
}

function flatten(nodes: CategoryTreeNode[]): CategoryTreeNode[] {
  const out: CategoryTreeNode[] = [];
  for (const n of nodes) {
    out.push(n);
    out.push(...flatten(n.children));
  }
  return out;
}
