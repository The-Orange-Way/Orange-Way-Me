/**
 * AccountsSummary — assets / liabilities / net, expandable per group.
 */
import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useAccounts } from "@/hooks/useAccounts";
import { useDashboardPrefs } from "@/hooks/useDashboardPrefs";
import { accountsSummary } from "@/lib/dashboard-math";
import { convert } from "@/lib/fx-rates";
import { useLocaleFormat, formatCurrencyLocale } from "@/lib/locale";
import type { NumberFormatPref } from "@/hooks/useDashboardPrefs";
import { Skeleton } from "@/components/ui/skeleton";
import type { Account } from "@/lib/connectors";

export function AccountsSummary() {
  const { prefs } = useDashboardPrefs();
  const fmt = useLocaleFormat();
  const { accounts, loading } = useAccounts();
  const [open, setOpen] = useState<{ assets: boolean; liabilities: boolean }>({
    assets: true,
    liabilities: false,
  });

  const summary = useMemo(
    () => accountsSummary(accounts, prefs.primaryCurrency),
    [accounts, prefs.primaryCurrency],
  );

  if (loading) {
    return (
      <Card className="h-full">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">Accounts</CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-32 w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="h-full">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">Accounts</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <Group
          label="Assets"
          total={summary.assets}
          accounts={summary.assetAccounts}
          currency={prefs.primaryCurrency}
          numberPref={prefs.numberFormat}
          open={open.assets}
          onToggle={() => setOpen((p) => ({ ...p, assets: !p.assets }))}
          totalClass="text-emerald-600 dark:text-emerald-500"
        />
        <Group
          label="Liabilities"
          total={summary.liabilities}
          accounts={summary.liabilityAccounts}
          currency={prefs.primaryCurrency}
          numberPref={prefs.numberFormat}
          open={open.liabilities}
          onToggle={() => setOpen((p) => ({ ...p, liabilities: !p.liabilities }))}
          totalClass="text-destructive"
          showAsNegative
        />
        <div className="flex items-center justify-between border-t border-border pt-3">
          <span className="text-sm font-semibold">Net</span>
          <span className="font-mono text-base font-semibold tabular-nums">
            {fmt.formatCurrency(summary.net, prefs.primaryCurrency)}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

function Group({
  label,
  total,
  accounts,
  currency,
  numberPref,
  open,
  onToggle,
  totalClass,
  showAsNegative,
}: {
  label: string;
  total: number;
  accounts: Account[];
  currency: string;
  numberPref: NumberFormatPref;
  open: boolean;
  onToggle: () => void;
  totalClass: string;
  showAsNegative?: boolean;
}) {
  return (
    <div>
      <button
        onClick={onToggle}
        className="flex w-full items-center justify-between rounded-md py-1 text-left transition-colors hover:bg-muted/30"
      >
        <span className="inline-flex items-center gap-1 text-sm font-medium">
          {open ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )}
          {label}
        </span>
        <span className={`font-mono text-sm font-semibold tabular-nums ${totalClass}`}>
          {showAsNegative && total > 0 ? "−" : ""}
          {formatCurrencyLocale(total, currency, numberPref)}
        </span>
      </button>
      {open && (
        <div className="mt-1 space-y-1 pl-5">
          {accounts.length === 0 ? (
            <div className="py-1 text-xs text-muted-foreground">No accounts</div>
          ) : (
            accounts.map((a) => {
              const inPrimary = convert(Number(a.balance) || 0, a.currency, currency);
              return (
                <Link
                  key={a.id}
                  to="/accounts/$id"
                  params={{ id: a.id }}
                  className="flex items-center justify-between rounded-md px-2 py-1 text-xs transition-colors hover:bg-muted/40"
                >
                  <span className="truncate text-foreground/80">{a.name}</span>
                  <span className="font-mono tabular-nums text-foreground/70">
                    {formatCurrencyLocale(Math.abs(inPrimary), currency, numberPref)}
                  </span>
                </Link>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
