/**
 * DashboardPage — Monarch-grade financial home page.
 * Responsive grid: 12 cols on desktop, single column on mobile.
 */
import { useEffect, useMemo, useRef } from "react";
import { NetWorthCard } from "./NetWorthCard";
import { WeeklyRecapCard } from "./WeeklyRecapCard";
import { ThisMonthSummary } from "./ThisMonthSummary";
import { CashFlowChart } from "./CashFlowChart";
import { AccountsSummary } from "./AccountsSummary";
import { GoalsProgressWidget } from "./GoalsProgressWidget";
import { RecentTransactions } from "./RecentTransactions";
import { UpcomingBills } from "./UpcomingBills";
import { FlowOfFundsChart } from "./FlowOfFundsChart";
import { DashboardCurrencyToggle } from "./DashboardCurrencyToggle";
import { CurrencySetupBanner } from "./CurrencySetupBanner";
import { useAuth } from "@/context/AuthContext";
import { useTransactions } from "@/hooks/useTransactions";
import { useCategories } from "@/hooks/useCategories";
import { useDashboardPrefs } from "@/hooks/useDashboardPrefs";
import { useHousehold } from "@/hooks/useHousehold";
import { monthRange } from "@/lib/date-ranges";
import { useDashboardTour } from "@/features/tour/useDashboardTour";
import { DashboardCoachmarks } from "@/features/tour/DashboardCoachmarks";

/** localStorage flag: have we ever seeded this device's prefs from the
 *  household defaults? Set once per user so a manual chip override stays
 *  intact across reloads. */
function seededKey(userId: string | undefined): string {
  return `orangeway.prefsSeededFromHousehold.${userId ?? "anon"}`;
}

export function DashboardPage() {
  const { user } = useAuth();
  const { prefs, update: updatePrefs } = useDashboardPrefs();
  const { household } = useHousehold();
  const { categories } = useCategories();
  const seedAppliedRef = useRef(false);
  const { showTour, dismiss: dismissTour } = useDashboardTour();

  // Seed per-device prefs from household defaults on first dashboard load
  // for this user. Runs once — after that, the user's chip choice wins.
  useEffect(() => {
    if (seedAppliedRef.current) return;
    if (!household || !user) return;
    if (typeof window === "undefined") return;
    if (window.localStorage.getItem(seededKey(user.id)) === "1") {
      seedAppliedRef.current = true;
      return;
    }
    updatePrefs({
      primaryCurrency: household.primary_currency,
      btcDisplayMode: household.btc_display_mode,
    });
    window.localStorage.setItem(seededKey(user.id), "1");
    seedAppliedRef.current = true;
  }, [household, user, updatePrefs]);
  const currentRange = useMemo(() => monthRange(new Date()), []);
  const { items: currentMonthTxns } = useTransactions({
    startDate: currentRange.start,
    endDate: currentRange.end,
  });
  const greeting = useMemo(() => {
    const hr = new Date().getHours();
    if (hr < 12) return "Good morning";
    if (hr < 18) return "Good afternoon";
    return "Good evening";
  }, []);
  const firstName = user?.email?.split("@")[0]?.split(".")[0] ?? "there";

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">
            {greeting}, <span className="capitalize">{firstName}</span>.
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Here's where your money stands today.
          </p>
        </div>
        <DashboardCurrencyToggle />
      </div>

      <CurrencySetupBanner />

      <WeeklyRecapCard />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Row 1: Net worth (wide) + This month */}
        <div data-tour="net-worth" className="lg:col-span-2">
          <NetWorthCard />
        </div>
        <div>
          <ThisMonthSummary />
        </div>

        {/* Row 2: Cash flow + Accounts + Goals */}
        <div>
          <CashFlowChart />
        </div>
        <div data-tour="accounts">
          <AccountsSummary />
        </div>
        <div>
          <GoalsProgressWidget />
        </div>

        {/* Row 3: Flow of funds (full width) */}
        <div className="lg:col-span-3">
          <FlowOfFundsChart
            transactions={currentMonthTxns}
            categories={categories}
            primaryCurrency={prefs.primaryCurrency}
          />
        </div>

        {/* Row 4: Recent transactions (wide) + Upcoming bills */}
        <div className="lg:col-span-2">
          <RecentTransactions />
        </div>
        <div data-tour="upcoming-bills">
          <UpcomingBills />
        </div>
      </div>

      {showTour && <DashboardCoachmarks onDismiss={dismissTour} />}
    </div>
  );
}
