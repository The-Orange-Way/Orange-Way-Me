/**
 * PreferencesPage — dashboard-related user knobs (currency, default range,
 * crypto display). Stored locally per user.
 */
import { Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import {
  useDashboardPrefs,
  type BtcDisplayMode,
  type DateFormatPref,
  type NetWorthRange,
  type NumberFormatPref,
} from "@/hooks/useDashboardPrefs";
import { SUPPORTED_CURRENCIES, type SupportedCurrency } from "@/lib/fx-rates";

export function PreferencesPage() {
  const { prefs, update } = useDashboardPrefs();

  return (
    <div className="space-y-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="-ml-3">
          <Link to="/settings">
            <ArrowLeft className="mr-1 h-4 w-4" />
            Settings
          </Link>
        </Button>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Preferences</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Display options for the dashboard. Stored on this device only.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Dashboard</CardTitle>
          <CardDescription>Choose how totals are displayed across all dashboards.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label>Primary currency</Label>
            <Select
              value={prefs.primaryCurrency}
              onValueChange={(v) => update({ primaryCurrency: v as SupportedCurrency })}
            >
              <SelectTrigger className="max-w-[200px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SUPPORTED_CURRENCIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Multi-currency totals are converted with static rates for now.
            </p>
          </div>

          <div className="space-y-2">
            <Label>Default net worth range</Label>
            <Select
              value={prefs.netWorthRange}
              onValueChange={(v) => update({ netWorthRange: v as NetWorthRange })}
            >
              <SelectTrigger className="max-w-[200px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1M">1 month</SelectItem>
                <SelectItem value="3M">3 months</SelectItem>
                <SelectItem value="6M">6 months</SelectItem>
                <SelectItem value="1Y">1 year</SelectItem>
                <SelectItem value="ALL">All time</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Bitcoin display</Label>
            <Select
              value={prefs.btcDisplayMode}
              onValueChange={(v) => update({ btcDisplayMode: v as BtcDisplayMode })}
            >
              <SelectTrigger className="max-w-[260px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="btc">0.05000000 BTC</SelectItem>
                <SelectItem value="btc_easy">0.00 050 000 BTC</SelectItem>
                <SelectItem value="sats">1,500,000 sats</SelectItem>
                <SelectItem value="primary">₿ 1,500,000</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              How Bitcoin amounts appear throughout the app.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Security</CardTitle>
          <CardDescription>
            How long Orange Way stays unlocked before it auto-locks itself.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Auto-lock after</Label>
            <Select
              value={String(prefs.autoLockMinutes)}
              onValueChange={(v) => update({ autoLockMinutes: Number(v) })}
            >
              <SelectTrigger className="max-w-[240px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="0">Never (not recommended)</SelectItem>
                <SelectItem value="1">1 minute</SelectItem>
                <SelectItem value="5">5 minutes</SelectItem>
                <SelectItem value="15">15 minutes</SelectItem>
                <SelectItem value="30">30 minutes</SelectItem>
                <SelectItem value="60">1 hour</SelectItem>
                <SelectItem value="240">4 hours</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              When idle, your vault re-locks and the password is needed again. Default is 15 minutes
              — short enough that walking away from a shared device stays safe.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Numbers &amp; dates</CardTitle>
          <CardDescription>Regional formatting used across the app.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label>Number format</Label>
            <Select
              value={prefs.numberFormat}
              onValueChange={(v) => update({ numberFormat: v as NumberFormatPref })}
            >
              <SelectTrigger className="max-w-[240px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="us">US · 1,234.56</SelectItem>
                <SelectItem value="eu">EU · 1.234,56</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Date format</Label>
            <Select
              value={prefs.dateFormat}
              onValueChange={(v) => update({ dateFormat: v as DateFormatPref })}
            >
              <SelectTrigger className="max-w-[240px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="us">US · MM/DD/YYYY</SelectItem>
                <SelectItem value="eu">EU · DD/MM/YYYY</SelectItem>
                <SelectItem value="iso">ISO · YYYY-MM-DD</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
