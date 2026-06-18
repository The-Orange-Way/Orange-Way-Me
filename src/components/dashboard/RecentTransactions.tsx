/**
 * RecentTransactions — last 10 transactions with quick category lookup.
 */
import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useTransactions } from "@/hooks/useTransactions";
import { useAccounts } from "@/hooks/useAccounts";
import { useCategories } from "@/hooks/useCategories";
import { useDashboardPrefs } from "@/hooks/useDashboardPrefs";
import { convert } from "@/lib/fx-rates";
import { useLocaleFormat } from "@/lib/locale";
import { Skeleton } from "@/components/ui/skeleton";

function trailingRange(days: number) {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - days);
  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
  };
}

export function RecentTransactions() {
  const range = useMemo(() => trailingRange(45), []);
  const { items, loading } = useTransactions(range);
  const { accounts } = useAccounts();
  const { categories } = useCategories();
  const { prefs } = useDashboardPrefs();
  const fmt = useLocaleFormat();

  const acctCurrency = useMemo(() => new Map(accounts.map((a) => [a.id, a.currency])), [accounts]);
  const catName = useMemo(() => new Map(categories.map((c) => [c.id, c.name])), [categories]);

  const top = useMemo(() => items.filter((t) => !t.split_parent_id).slice(0, 10), [items]);

  return (
    <Card className="h-full">
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          Recent transactions
        </CardTitle>
        <Button asChild variant="ghost" size="sm" className="h-7 text-xs">
          <Link to="/transactions" search={{ wallet: undefined }}>
            View all
          </Link>
        </Button>
      </CardHeader>
      <CardContent className="px-3">
        {loading ? (
          <div className="space-y-2 px-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : top.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-muted-foreground">
            No recent transactions.
          </p>
        ) : (
          <div className="divide-y divide-border">
            {top.map((t) => {
              const cur = acctCurrency.get(t.account_id) ?? prefs.primaryCurrency;
              const amt = Number(t.amount) || 0;
              const inPrimary = convert(amt, cur, prefs.primaryCurrency);
              const date = fmt.formatDate(new Date(t.date + "T00:00:00"), {
                month: "short",
                day: "numeric",
              });
              return (
                <Link
                  key={t.id}
                  to="/transactions"
                  search={{ wallet: undefined }}
                  className="flex items-center gap-3 rounded-md px-2 py-2 transition-colors hover:bg-muted/30"
                >
                  <span className="w-12 shrink-0 text-xs text-muted-foreground">{date}</span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">
                      {t.merchant ?? t.description}
                    </div>
                    {t.category_id && catName.has(t.category_id) && (
                      <div className="truncate text-[11px] text-muted-foreground">
                        {catName.get(t.category_id)}
                      </div>
                    )}
                  </div>
                  <span
                    className={`shrink-0 font-mono text-sm tabular-nums ${
                      amt >= 0 ? "text-emerald-600 dark:text-emerald-500" : "text-foreground"
                    }`}
                  >
                    {amt >= 0 ? "+" : ""}
                    {fmt.formatCurrency(inPrimary, prefs.primaryCurrency, {
                      maximumFractionDigits: 2,
                    })}
                  </span>
                </Link>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
