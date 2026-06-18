/**
 * BudgetsPage — Flex + Category modes, monthly navigation, copy-from-last,
 * mode switching with confirm. All budget data is encrypted client-side.
 */
import { useMemo, useState } from "react";
import { useAsyncAction } from "@/hooks/useAsyncAction";
import { Copy } from "lucide-react";
import { toast } from "sonner";
import { toastError } from "@/lib/friendly-error";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { Card, CardContent } from "@/components/ui/card";
import { useCategories } from "@/hooks/useCategories";
import { useTransactions } from "@/hooks/useTransactions";
import {
  useBudget,
  emptyCategoryData,
  emptyFlexData,
  suggestCategoryBucketMap,
  type BudgetData,
  type BudgetMode,
  type CategoryBudgetData,
  type FlexBudgetData,
} from "@/hooks/useBudgets";
import { monthRange, type DateRange } from "@/lib/date-ranges";
import { MonthNavigator } from "@/components/transactions/MonthNavigator";
import { FlexBudgetView } from "./FlexBudgetView";
import { CategoryBudgetView } from "./CategoryBudgetView";
import { BudgetSummaryHeader } from "./BudgetSummaryHeader";

export function BudgetsPage() {
  const [anchor, setAnchor] = useState(new Date());
  const [range, setRange] = useState<DateRange>(monthRange(new Date()));
  const [pendingMode, setPendingMode] = useState<BudgetMode | null>(null);

  const { categories, tree, seedDefaults } = useCategories();
  const { items, loading: txLoading } = useTransactions({
    startDate: range.start,
    endDate: range.end,
  });

  const prevAnchor = useMemo(
    () => new Date(anchor.getFullYear(), anchor.getMonth() - 1, 1),
    [anchor],
  );
  const prevRange = useMemo(() => monthRange(prevAnchor), [prevAnchor]);
  const { items: prevItems } = useTransactions({
    startDate: prevRange.start,
    endDate: prevRange.end,
  });

  const {
    budget,
    previousBudget,
    loading: budgetLoading,
    save,
    switchMode,
    copyFromLastMonth,
  } = useBudget(anchor);

  const monthLabel = range.label;

  // Seed default categories on first visit (mirror TransactionsPage behavior).
  useMemo(() => {
    if (categories.length === 0) void seedDefaults().catch(() => {});
  }, [categories.length, seedDefaults]);

  const handleSave = async (data: BudgetData) => {
    try {
      await save(data.mode, data);
    } catch (err) {
      toastError(err, "Failed to save budget");
    }
  };

  const handleCreateInitial = async (mode: BudgetMode) => {
    try {
      if (mode === "flex") {
        const seeded: FlexBudgetData = {
          ...emptyFlexData(),
          categoryBucketMap: suggestCategoryBucketMap(categories),
        };
        await switchMode("flex", seeded);
      } else {
        await switchMode("category", emptyCategoryData());
      }
      toast.success("Budget created");
    } catch (err) {
      toastError(err, "Failed to create budget");
    }
  };

  const [handleSwitchMode, switching] = useAsyncAction(async () => {
    if (!pendingMode) return;
    try {
      if (pendingMode === "flex") {
        const seeded: FlexBudgetData = {
          ...emptyFlexData(),
          categoryBucketMap: suggestCategoryBucketMap(categories),
        };
        await switchMode("flex", seeded);
      } else {
        await switchMode("category", emptyCategoryData());
      }
      toast.success(`Switched to ${pendingMode === "flex" ? "Flex" : "Category"} mode`);
    } catch (err) {
      toastError(err, "Mode switch failed");
    } finally {
      setPendingMode(null);
    }
  });

  const handleCopyLast = async () => {
    try {
      await copyFromLastMonth();
      toast.success("Copied last month's budget");
    } catch (err) {
      toastError(err, "Copy failed");
    }
  };

  const currentMode: BudgetMode = budget?.mode ?? "flex";

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Budgets</h1>
          <p className="text-sm text-muted-foreground">
            Plan how every dollar gets spent. {monthLabel}.
          </p>
        </div>
        {budget && (
          <Tabs
            value={currentMode}
            onValueChange={(v) => {
              if (v !== currentMode) setPendingMode(v as BudgetMode);
            }}
          >
            <TabsList>
              <TabsTrigger value="flex">Flex</TabsTrigger>
              <TabsTrigger value="category">Category</TabsTrigger>
            </TabsList>
          </Tabs>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <MonthNavigator
          anchor={anchor}
          range={range}
          onChange={(a, r) => {
            setAnchor(a);
            setRange(r);
          }}
        />
        {!budget && previousBudget && (
          <Button variant="outline" size="sm" onClick={handleCopyLast} className="ml-auto">
            <Copy className="mr-2 h-3.5 w-3.5" /> Copy from last month
          </Button>
        )}
      </div>

      {budgetLoading ? (
        <Card className="rounded-xl shadow-sm">
          <CardContent className="py-16 text-center text-sm text-muted-foreground">
            Decrypting budget…
          </CardContent>
        </Card>
      ) : !budget ? (
        <EmptyState onCreate={handleCreateInitial} />
      ) : (
        <>
          <BudgetSummaryHeader data={budget.data} transactions={items} />
          {budget.mode === "flex" ? (
            <FlexBudgetView
              data={budget.data as FlexBudgetData}
              categories={categories}
              transactions={items}
              onChange={handleSave}
            />
          ) : (
            <CategoryBudgetView
              data={budget.data as CategoryBudgetData}
              categories={categories}
              tree={tree}
              transactions={items}
              previousBudget={previousBudget}
              previousTransactions={prevItems}
              onChange={handleSave}
            />
          )}
        </>
      )}

      {txLoading && budget && (
        <p className="text-center text-xs text-muted-foreground">Refreshing transactions…</p>
      )}

      <AlertDialog open={!!pendingMode} onOpenChange={(v) => !v && setPendingMode(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Create a fresh {pendingMode === "flex" ? "Flex" : "Category"} budget for {monthLabel}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This replaces your current {monthLabel} budget. Other months are not affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void handleSwitchMode();
              }}
              disabled={switching}
            >
              {switching ? "Switching…" : "Switch mode"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function EmptyState({ onCreate }: { onCreate: (mode: BudgetMode) => void }) {
  return (
    <Card className="rounded-xl shadow-sm">
      <CardContent className="space-y-6 py-12 text-center">
        <div>
          <h2 className="text-xl font-semibold">No budget for this month yet</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Pick a style. You can switch any time.
          </p>
        </div>
        <div className="mx-auto grid max-w-2xl gap-4 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => onCreate("flex")}
            className="rounded-xl border-2 border-border p-6 text-left transition-all hover:border-primary hover:shadow-md"
          >
            <div className="text-sm font-bold">Flex</div>
            <div className="mt-2 text-xs text-muted-foreground">
              Three buckets: Essentials / Wants / Savings. Easy to maintain.
            </div>
          </button>
          <button
            type="button"
            onClick={() => onCreate("category")}
            className="rounded-xl border-2 border-border p-6 text-left transition-all hover:border-primary hover:shadow-md"
          >
            <div className="text-sm font-bold">Category</div>
            <div className="mt-2 text-xs text-muted-foreground">
              A line per category. Optional rollover. Zero-based if you want it.
            </div>
          </button>
        </div>
      </CardContent>
    </Card>
  );
}
