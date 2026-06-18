/**
 * UpcomingBills — client-side recurring bill detection over the last 90 days.
 * User can dismiss bills (stored in dashboard prefs).
 */
import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CalendarClock, X } from "lucide-react";
import { useTransactions } from "@/hooks/useTransactions";
import { useCategories } from "@/hooks/useCategories";
import { useDashboardPrefs } from "@/hooks/useDashboardPrefs";
import { detectRecurringBills } from "@/lib/dashboard-math";
import { convert } from "@/lib/fx-rates";
import { useLocaleFormat } from "@/lib/locale";
import { Skeleton } from "@/components/ui/skeleton";

function trailing90() {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 90);
  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
  };
}

export function UpcomingBills() {
  const range = useMemo(trailing90, []);
  const { items, loading } = useTransactions(range);
  const { categories } = useCategories();
  const { prefs, dismissRecurring, restoreRecurring } = useDashboardPrefs();
  const fmt = useLocaleFormat();

  const bills = useMemo(() => {
    const all = detectRecurringBills(items);
    return all.filter((b) => !prefs.dismissedRecurring.includes(b.key));
  }, [items, prefs.dismissedRecurring]);

  const dismissedCount = prefs.dismissedRecurring.length;
  const catName = useMemo(() => new Map(categories.map((c) => [c.id, c.name])), [categories]);

  return (
    <Card className="h-full">
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">Upcoming bills</CardTitle>
        {dismissedCount > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={() => prefs.dismissedRecurring.forEach(restoreRecurring)}
          >
            Restore {dismissedCount}
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-24 w-full" />
        ) : bills.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-6 text-center">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-muted">
              <CalendarClock className="h-4 w-4 text-muted-foreground" />
            </div>
            <p className="text-xs text-muted-foreground">No bills due in the next 14 days.</p>
          </div>
        ) : (
          <div className="space-y-1">
            {bills.map((b) => {
              // Use the merchant's most-frequent currency by checking the accounts
              // we've seen. Fall back to primary.
              const cur = prefs.primaryCurrency;
              const amount = convert(b.typicalAmount, cur, prefs.primaryCurrency);
              return (
                <div
                  key={b.key}
                  className="group flex items-center gap-3 rounded-md px-2 py-2 transition-colors hover:bg-muted/30"
                >
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-amber-500/10 text-amber-600 dark:text-amber-500">
                    <CalendarClock className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{b.merchant}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {fmt.formatDate(b.nextDate, { month: "short", day: "numeric" })}
                      {b.category_id && catName.has(b.category_id) && (
                        <> · {catName.get(b.category_id)}</>
                      )}
                    </div>
                  </div>
                  <span className="shrink-0 font-mono text-sm tabular-nums">
                    {fmt.formatCurrency(amount, prefs.primaryCurrency, {
                      maximumFractionDigits: 2,
                    })}
                  </span>
                  <button
                    onClick={() => dismissRecurring(b.key)}
                    title="Not actually recurring"
                    className="shrink-0 rounded-md p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground group-hover:opacity-100"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
