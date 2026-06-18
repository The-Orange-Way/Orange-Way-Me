/**
 * CashFlowChart — last 6 months, income vs spending bars + net line overlay.
 */
import { useMemo } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Bar,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  CartesianGrid,
  Legend,
} from "recharts";
import { useAccounts } from "@/hooks/useAccounts";
import { useTransactions } from "@/hooks/useTransactions";
import { useDashboardPrefs } from "@/hooks/useDashboardPrefs";
import { cashFlowByMonth } from "@/lib/dashboard-math";
import { useLocaleFormat } from "@/lib/locale";
import { Skeleton } from "@/components/ui/skeleton";

function trailing6() {
  const end = new Date();
  const start = new Date(end.getFullYear(), end.getMonth() - 6, 1);
  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
  };
}

export function CashFlowChart() {
  const { prefs } = useDashboardPrefs();
  const fmt = useLocaleFormat();
  const range = useMemo(trailing6, []);
  const { accounts } = useAccounts();
  const { items: txns, loading } = useTransactions(range);
  const navigate = useNavigate();

  const data = useMemo(
    () =>
      cashFlowByMonth(accounts, txns, prefs.primaryCurrency, 6).map((m) => ({
        ...m,
        label: new Date(m.monthKey).toLocaleDateString(undefined, { month: "short" }),
      })),
    [accounts, txns, prefs.primaryCurrency],
  );

  function handleClick(payload: { activePayload?: Array<{ payload: { monthKey: string } }> }) {
    const point = payload?.activePayload?.[0]?.payload;
    if (!point) return;
    navigate({ to: "/transactions", search: { wallet: undefined } });
    void point;
  }

  return (
    <Card className="h-full">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          Cash flow · last 6 months
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-56">
          {loading ? (
            <Skeleton className="h-full w-full" />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={data}
                margin={{ top: 5, right: 5, left: 0, bottom: 0 }}
                onClick={handleClick as never}
              >
                <CartesianGrid strokeDasharray="3 3" className="stroke-border/40" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis
                  tickFormatter={(v) =>
                    fmt.formatCurrency(Number(v), prefs.primaryCurrency, {
                      maximumFractionDigits: 0,
                    })
                  }
                  tick={{ fontSize: 11 }}
                  width={70}
                />
                <Tooltip
                  formatter={
                    ((v: number, name: string) => [
                      fmt.formatCurrency(v, prefs.primaryCurrency),
                      name,
                    ]) as never
                  }
                  contentStyle={{
                    background: "hsl(var(--popover))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="income" name="Income" fill="hsl(142 70% 45%)" radius={[4, 4, 0, 0]} />
                <Bar
                  dataKey="spending"
                  name="Spending"
                  fill="hsl(var(--destructive))"
                  radius={[4, 4, 0, 0]}
                />
                <Line
                  type="monotone"
                  dataKey="net"
                  name="Net"
                  stroke="hsl(var(--primary))"
                  strokeWidth={2}
                  dot={{ r: 3 }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
