import type { ReactNode } from "react";
import { Link, useLocation } from "@tanstack/react-router";
import {
  LayoutDashboard,
  Wallet,
  ArrowLeftRight,
  PieChart,
  Target,
  Settings as SettingsIcon,
  Lock,
  LogOut,
  Sun,
  Moon,
  Menu,
  Zap,
  Home,
  BarChart3,
} from "lucide-react";
import { useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { useVault } from "@/context/VaultContext";
import { useTheme } from "@/context/ThemeContext";
import { useHousehold } from "@/hooks/useHousehold";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { HouseholdMaintenanceBanner } from "@/components/rekey/HouseholdMaintenanceBanner";
import { SupportSessionBanner } from "@/components/household/SupportSessionBanner";
import { FeedbackWidget } from "@/components/FeedbackWidget";
import { featureFlags } from "@/lib/feature-flags";

const NAV = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/accounts", label: "Accounts", icon: Wallet },
  { to: "/transactions", label: "Transactions", icon: ArrowLeftRight },
  { to: "/cash-flow", label: "Cash flow", icon: BarChart3 },
  { to: "/budgets", label: "Budgets", icon: PieChart },
  { to: "/connections", label: "Connections", icon: Zap },
  { to: "/goals", label: "Goals", icon: Target },
  { to: "/settings", label: "Settings", icon: SettingsIcon },
] as const;

// Bottom tab nav — mobile only. Five tabs that mirror how Monarch users
// move around a finance app. Battle tested pattern; we'll evolve from here.
const BOTTOM_TABS = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/accounts", label: "Accounts", icon: Wallet },
  { to: "/transactions", label: "Transactions", icon: ArrowLeftRight },
  { to: "/cash-flow", label: "Cash flow", icon: BarChart3 },
  { to: "/budgets", label: "Budgets", icon: PieChart },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  const { user, signOut } = useAuth();
  const { lock } = useVault();
  const { theme, toggleTheme } = useTheme();
  const { household } = useHousehold();

  const initials = (user?.email ?? "?").slice(0, 2).toUpperCase();
  const householdLabel = household?.name?.trim() ?? "";

  return (
    <div className="flex min-h-screen w-full bg-background text-foreground">
      {/* Sidebar — desktop */}
      <aside
        className={cn(
          "hidden border-r border-sidebar-border bg-sidebar transition-[width] md:flex md:flex-col",
          collapsed ? "md:w-16" : "md:w-60",
        )}
      >
        <div className="flex h-16 items-center gap-2 border-b border-sidebar-border px-4">
          <img
            src="/icon-192.png"
            alt="Orange Way"
            className="h-8 w-8 shrink-0 rounded-lg"
          />
          {!collapsed && <span className="text-sm font-semibold tracking-tight">Orange Way</span>}
        </div>
        <nav className="flex-1 space-y-1 p-2">
          {NAV.map((item) => {
            const active = location.pathname.startsWith(item.to);
            const Icon = item.icon;
            return (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  "group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {!collapsed && <span>{item.label}</span>}
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-sidebar-border p-2">
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start text-sidebar-foreground/80"
            onClick={() => setCollapsed((c) => !c)}
          >
            <Menu className="h-4 w-4" />
            {!collapsed && <span className="ml-3">Collapse</span>}
          </Button>
        </div>
      </aside>

      {/* Sidebar — mobile drawer */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-foreground/40 md:hidden"
          onClick={() => setMobileOpen(false)}
        >
          <aside
            className="absolute left-0 top-0 h-full w-64 border-r border-sidebar-border bg-sidebar p-2"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex h-14 items-center gap-2 px-3">
              <img
                src="/icon-192.png"
                alt="Orange Way"
                className="h-8 w-8 rounded-lg"
              />
              <span className="text-sm font-semibold">Orange Way</span>
            </div>
            <nav className="mt-2 space-y-1">
              {NAV.map((item) => {
                const active = location.pathname.startsWith(item.to);
                const Icon = item.icon;
                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    onClick={() => setMobileOpen(false)}
                    className={cn(
                      "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium",
                      active
                        ? "bg-sidebar-accent text-sidebar-accent-foreground"
                        : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60",
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </nav>
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Header */}
        <header className="flex h-16 items-center justify-between border-b border-border bg-background/80 px-4 backdrop-blur md:px-6">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden"
              onClick={() => setMobileOpen(true)}
            >
              <Menu className="h-5 w-5" />
            </Button>
            {householdLabel && (
              <div className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/40 px-3 py-1 text-xs font-medium text-foreground">
                <Home className="h-3 w-3 text-muted-foreground" />
                <span className="truncate max-w-[160px]">{householdLabel}</span>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" onClick={toggleTheme} aria-label="Toggle theme">
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="gap-2 px-2">
                  <Avatar className="h-7 w-7">
                    <AvatarFallback className="bg-primary/15 text-xs text-primary">
                      {initials}
                    </AvatarFallback>
                  </Avatar>
                  <span className="hidden max-w-[160px] truncate text-sm md:inline">
                    {user?.email}
                  </span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="truncate">{user?.email}</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={lock}>
                  <Lock className="mr-2 h-4 w-4" />
                  Lock vault
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => signOut()}>
                  <LogOut className="mr-2 h-4 w-4" />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        {/* Phase 4.5: banner visible to non-Owner household members
            while a household refresh is in flight. The Owner driving
            the refresh sees the wizard progress UI instead. */}
        <HouseholdMaintenanceBanner currentUserId={user?.id ?? null} />

        {/* Phase 4.4: global notice while a customer support session
            is active for the user's household. The Owner sees an
            "End now" link; everyone else just sees the notice.
            Gated behind featureFlags.phase44Public — hidden by default
            until the real ML-DSA verifier ships. */}
        {featureFlags.phase44Public && <SupportSessionBanner currentUserId={user?.id ?? null} />}

        <main className="flex-1 px-4 py-8 pb-24 md:px-8 md:py-10 md:pb-10">
          <div className="mx-auto w-full max-w-6xl">{children}</div>
        </main>

        {/* Bottom tab nav — mobile only. Fixed at the bottom of the
            viewport above the OS gesture bar. Hides on md+ where the
            sidebar handles navigation. */}
        <nav
          aria-label="Primary"
          className="fixed inset-x-0 bottom-0 z-30 flex h-16 items-stretch border-t border-border bg-background/95 backdrop-blur md:hidden"
        >
          {BOTTOM_TABS.map((tab) => {
            const active = location.pathname.startsWith(tab.to);
            const Icon = tab.icon;
            return (
              <Link
                key={tab.to}
                to={tab.to}
                className={cn(
                  "flex flex-1 flex-col items-center justify-center gap-0.5 px-1 text-[10px] font-medium transition-colors",
                  active ? "text-primary" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className={cn("h-5 w-5", active && "stroke-[2.5]")} />
                <span className="truncate leading-tight">{tab.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* Discreet feedback footer — one quiet line at the bottom of every
            authenticated page. The widget itself only renders the modal
            trigger; submissions land on https://feedback.orangeway.app under
            the orange-way project. */}
        {user?.email && import.meta.env.VITE_FEEDBACK_SUPABASE_URL && (
          <footer className="border-t border-border/40 px-4 py-3 text-center text-xs text-muted-foreground md:px-8">
            Have an idea?{" "}
            <FeedbackWidget
              feedbackSupabaseUrl={import.meta.env.VITE_FEEDBACK_SUPABASE_URL}
              feedbackAnonKey={import.meta.env.VITE_FEEDBACK_ANON_KEY}
              projectSlug="orange-way"
              sourceApp="orange-way"
              submitterEmail={user.email}
              accentColor="#fb923c"
              publicBoardUrl="https://feedback.orangeway.app"
            />
          </footer>
        )}
      </div>
    </div>
  );
}
