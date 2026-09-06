/**
 * NetWorthCard — big total + 30d delta + monthly trend chart with range tabs.
 */
import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip as UiTooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Line,
  ComposedChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts";
import { ArrowDown, ArrowUp, Info } from "lucide-react";
import { useAccounts } from "@/hooks/useAccounts";
import { useTransactions } from "@/hooks/useTransactions";
import { netWorthSeries, accountsSummary } from "@/lib/dashboard-math";
import { useDashboardPrefs, type NetWorthRange } from "@/hooks/useDashboardPrefs";
import { FX_DISCLAIMER } from "@/lib/fx-rates";
import { useLocaleFormat } from "@/lib/locale";
import { Skeleton } from "@/components/ui/skeleton";

const RANGE_TO_MONTHS: Record<NetWorthRange, number> = {
  "1M": 1,
  "3M": 3,
  "6M": 6,
  "1Y": 12,
  ALL: 60,
};

function trailingRange(months: number) {
  const end = new Date();
  const start = new Date();
  start.setMonth(start.getMonth() - months - 1);
  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
  };
}

export function NetWorthCard() {
  const { prefs, update } = useDashboardPrefs();
  const fmt = useLocaleFormat();
  const [range, setRange] = useState<NetWorthRange>(prefs.netWorthRange);
  const months = RANGE_TO_MONTHS[range];
  const txnRange = useMemo(() => trailingRange(months), [months]);
  const { accounts, loading: accountsLoading } = useAccounts();
  const { items: txns, loading: txnsLoading } = useTransactions(txnRange);

  const summary = useMemo(
    () => accountsSummary(accounts, prefs.primaryCurrency),
    [accounts, prefs.primaryCurrency],
  );

  const series = useMemo(
    () => netWorthSeries(accounts, txns, prefs.primaryCurrency, months),
    [accounts, txns, prefs.primaryCurrency, months],
  );

  // Delta: compare current to value ~30 days ago in the series.
  const delta = useMemo(() => {
    if (series.length < 2) return { abs: 0, pct: 0 };
    const latest = series[series.length - 1].value;
    // Find the point closest to 30 days ago
    const ref = series[Math.max(0, series.length - 2)].value;
    const abs = latest - ref;
    const pct = ref !== 0 ? (abs / Math.abs(ref)) * 100 : 0;
    return { abs, pct };
  }, [series]);

  function handleRangeChange(v: string) {
    const r = v as NetWorthRange;
    setRange(r);
    update({ netWorthRange: r });
  }

  const loading = accountsLoading || txnsLoading;
  const isUp = delta.abs >= 0;
  const multiCurrency = Object.keys(summary.rawByCurrency).length > 1;

  return (
    <Card className="h-full">
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">Net worth</CardTitle>
        <Tabs value={range} onValueChange={handleRangeChange}>
          <TabsList className="h-7">
            {(["1M", "3M", "6M", "1Y", "ALL"] as NetWorthRange[]).map((r) => (
              <TabsTrigger key={r} value={r} className="h-5 px-2 text-xs">
                {r}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <Skeleton className="h-10 w-48" />
        ) : (
          <div className="flex flex-wrap items-baseline gap-4">
            <div className="font-mono text-3xl font-semibold tabular-nums">
              {fmt.formatCurrency(summary.net, prefs.primaryCurrency, { unitIsExact: true })}
              {multiCurrency && (
                <TooltipProvider>
                  <UiTooltip>
                    <TooltipTrigger asChild>
                      <sup className="ml-1 cursor-help text-xs text-muted-foreground">*</sup>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-[260px]">
                      <p className="text-xs">{FX_DISCLAIMER}</p>
                      <p className="mt-1 text-xs font-mono">
                        Raw:{" "}
                        {Object.entries(summary.rawByCurrency)
                          .map(
                            ([cur, sum]) =>
                              `${fmt.formatCurrency(sum, cur, { maximumFractionDigits: 2 })}`,
                          )
                          .join(" · ")}
                      </p>
                    </TooltipContent>
                  </UiTooltip>
                </TooltipProvider>
              )}
            </div>
            <div
              className={`inline-flex items-center gap-1 text-sm font-medium ${
                isUp ? "text-emerald-600 dark:text-emerald-500" : "text-destructive"
              }`}
            >
              {isUp ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />}
              <span className="tabular-nums">
                {fmt.formatCurrency(Math.abs(delta.abs), prefs.primaryCurrency, { unitIsExact: true })}
              </span>
              <span className="text-xs text-muted-foreground">
                ({delta.pct >= 0 ? "+" : ""}
                {delta.pct.toFixed(1)}%)
              </span>
            </div>
          </div>
        )}

        <div className="h-48">
          {loading ? (
            <Skeleton className="h-full w-full" />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={series} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border/40" />
                <XAxis
                  dataKey="date"
                  tickFormatter={(d) =>
                    new Date(d + "T12:00:00").toLocaleDateString(undefined, { month: "short" })
                  }
                  className="text-xs"
                  tick={{ fontSize: 11 }}
                />
                <YAxis
                  tickFormatter={(v) =>
                    fmt.formatCurrency(Number(v), prefs.primaryCurrency, {
                      maximumFractionDigits: 0,
                      unitIsExact: true,
                    })
                  }
                  className="text-xs"
                  tick={{ fontSize: 11 }}
                  width={70}
                  domain={[
                    (min: number) => {
                      if (!Number.isFinite(min) || min === 0) return -1;
                      return Math.floor(min < 0 ? min * 1.03 : min * 0.97);
                    },
                    (max: number) => {
                      if (!Number.isFinite(max) || max === 0) return 1;
                      return Math.ceil(max > 0 ? max * 1.03 : max * 0.97);
                    },
                  ]}
                />
                <Tooltip
                  formatter={
                    ((v: number) =>
                      fmt.formatCurrency(v, prefs.primaryCurrency, { unitIsExact: true })) as never
                  }
                  labelFormatter={(d) =>
                    new Date(d + "T12:00:00").toLocaleDateString(undefined, {
                      month: "long",
                      year: "numeric",
                    })
                  }
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
                  stroke="#f59e0b"
                  strokeWidth={2.5}
                  dot={{ r: 3, fill: "#f59e0b" }}
                  activeDot={{ r: 5, fill: "#f59e0b" }}
                  connectNulls
                />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </div>
        {multiCurrency && (
          <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <Info className="h-3 w-3" /> {FX_DISCLAIMER}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
