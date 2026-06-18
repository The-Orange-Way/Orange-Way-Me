/**
 * Payoff plan widget — orders all active pay_down goals by avalanche or snowball,
 * with a toggle to switch. Displays APR, balance, min payment.
 */
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { orderPayDown } from "@/lib/goals-math";
import type { Goal } from "@/hooks/useGoals";
import type { Account } from "@/lib/connectors";
import { Link } from "@tanstack/react-router";
import { useLocaleFormat } from "@/lib/locale";
import { useDashboardPrefs } from "@/hooks/useDashboardPrefs";

interface Props {
  goals: Goal[];
  accounts: Account[];
}

export function PayoffPlanWidget({ goals, accounts }: Props) {
  const [strategy, setStrategy] = useState<"avalanche" | "snowball">("avalanche");
  const { prefs } = useDashboardPrefs();
  const fmt = useLocaleFormat();
  const fmtUSD = (n: number) => fmt.formatCurrency(n, prefs.primaryCurrency);
  const ordered = orderPayDown(goals, accounts, strategy);
  if (ordered.length < 2) return null;

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">Payoff plan</CardTitle>
        <Tabs value={strategy} onValueChange={(v) => setStrategy(v as "avalanche" | "snowball")}>
          <TabsList className="h-8">
            <TabsTrigger value="avalanche" className="text-xs h-6">
              Avalanche
            </TabsTrigger>
            <TabsTrigger value="snowball" className="text-xs h-6">
              Snowball
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </CardHeader>
      <CardContent>
        <ol className="space-y-2">
          {ordered.map((g, i) => {
            const linked = accounts.filter((a) => g.linked_account_ids.includes(a.id));
            const debt = linked.reduce((sum, a) => sum + Math.abs(Number(a.balance) || 0), 0);
            const apr = Number(g.interest_rate ?? "0") || 0;
            const min = Number(g.minimum_payment ?? "0") || 0;
            return (
              <li key={g.id}>
                <Link
                  to="/goals/$id"
                  params={{ id: g.id }}
                  className="flex items-center gap-3 rounded-lg border border-border p-3 hover:bg-muted/40 transition-colors"
                >
                  <div className="h-7 w-7 shrink-0 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-semibold">
                    {i + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{g.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {apr.toFixed(2)}% APR
                      {min > 0 && ` · min ${fmtUSD(min)}/mo`}
                    </div>
                  </div>
                  <div className="font-mono tabular-nums text-sm font-semibold">{fmtUSD(debt)}</div>
                </Link>
              </li>
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
}
