/**
 * HouseholdCurrenciesCard — Settings → Household → Currencies.
 *
 * Three controls that decide how the dashboard renders for every member
 * of the household:
 *   - Primary currency: what totals are shown in by default.
 *   - Reporting currency: used for exports / year-end statements.
 *   - Bitcoin display: how BTC amounts render across the app.
 *
 * Stored as plaintext columns on `households`. Per-user device overrides
 * still live in `useDashboardPrefs` (localStorage) so a co-admin can flip
 * their personal view via the dashboard chip without changing the
 * household-wide default.
 *
 * Pre-fills primary currency from the most-balance-weighted account
 * currency the household holds — a first-time setup nudge. The user can
 * still pick anything; we just default to the obvious answer.
 */
import { useMemo, useState } from "react";
import { Save } from "lucide-react";
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
import { toast } from "sonner";
import { toastError } from "@/lib/friendly-error";
import {
  useHousehold,
  type HouseholdBtcDisplayMode,
  type HouseholdCurrency,
} from "@/hooks/useHousehold";
import { useAccounts } from "@/hooks/useAccounts";
import { useDashboardPrefs } from "@/hooks/useDashboardPrefs";
import { SUPPORTED_CURRENCIES } from "@/lib/fx-rates";

const BTC_MODES: Array<{ value: HouseholdBtcDisplayMode; label: string }> = [
  { value: "btc", label: "0.05000000 BTC" },
  { value: "btc_easy", label: "0.00 050 000 BTC" },
  { value: "sats", label: "1,500,000 sats" },
  { value: "primary", label: "₿ 1,500,000" },
];

function dominantAccountCurrency(
  accounts: ReadonlyArray<{ currency: string; balance: number | string }>,
): HouseholdCurrency | null {
  if (accounts.length === 0) return null;
  const byCurrency: Record<string, number> = {};
  for (const a of accounts) {
    const code = (a.currency ?? "").toUpperCase();
    if (!(SUPPORTED_CURRENCIES as readonly string[]).includes(code)) continue;
    const bal = Math.abs(Number(a.balance) || 0);
    byCurrency[code] = (byCurrency[code] ?? 0) + bal;
  }
  const ranked = Object.entries(byCurrency).sort((a, b) => b[1] - a[1]);
  return (ranked[0]?.[0] as HouseholdCurrency | undefined) ?? null;
}

export function HouseholdCurrenciesCard() {
  const { household, updateCurrencyPrefs } = useHousehold();
  const { accounts } = useAccounts();
  const { update: updatePrefs } = useDashboardPrefs();

  // Form state holds only OVERRIDES (what the user has touched). Falling
  // back to the live household value avoids the setState-in-effect pattern
  // and means form state automatically tracks remote changes the user
  // hasn't yet diverged from.
  const [primaryOverride, setPrimaryOverride] = useState<HouseholdCurrency | null>(null);
  const [reportingOverride, setReportingOverride] = useState<HouseholdCurrency | null>(null);
  const [btcOverride, setBtcOverride] = useState<HouseholdBtcDisplayMode | null>(null);
  const [saving, setSaving] = useState(false);

  const suggested = useMemo(() => dominantAccountCurrency(accounts), [accounts]);
  const hasSuggestion =
    suggested !== null &&
    household !== null &&
    household.primary_currency === "USD" &&
    suggested !== "USD";

  if (!household) return null;

  const primary = primaryOverride ?? household.primary_currency;
  const reporting = reportingOverride ?? household.reporting_currency;
  const btcMode = btcOverride ?? household.btc_display_mode;

  const dirty =
    primary !== household.primary_currency ||
    reporting !== household.reporting_currency ||
    btcMode !== household.btc_display_mode;

  async function handleSave() {
    setSaving(true);
    try {
      await updateCurrencyPrefs({
        primary_currency: primary,
        reporting_currency: reporting,
        btc_display_mode: btcMode,
      });
      // Mirror to the saving user's per-device prefs so the dashboard
      // updates immediately. Other members pick up the new defaults
      // next time their app loads (see CurrencySetupBanner).
      updatePrefs({ primaryCurrency: primary, btcDisplayMode: btcMode });
      // Clear the overlay state — household values are now the source of truth.
      setPrimaryOverride(null);
      setReportingOverride(null);
      setBtcOverride(null);
      toast.success("Household currency preferences saved.");
    } catch (err) {
      toastError(err, "Couldn't save preferences.");
    } finally {
      setSaving(false);
    }
  }

  function applySuggestion() {
    if (!suggested) return;
    setPrimaryOverride(suggested);
    setReportingOverride(suggested);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Currencies</CardTitle>
        <CardDescription>
          How the dashboard and reports display money for everyone in this household. Each member
          can still flip their personal view with the dashboard chip.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {hasSuggestion ? (
          <div className="rounded-md border border-dashed bg-muted/40 px-3 py-2 text-sm">
            Your accounts are mostly in <span className="font-medium">{suggested}</span>. Set it as
            the household primary currency?{" "}
            <Button
              variant="link"
              size="sm"
              className="h-auto p-0 align-baseline"
              onClick={applySuggestion}
            >
              Use {suggested}
            </Button>
          </div>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Primary currency</Label>
            <Select
              value={primary}
              onValueChange={(v) => setPrimaryOverride(v as HouseholdCurrency)}
            >
              <SelectTrigger>
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
              What everyone sees first on the dashboard.
            </p>
          </div>

          <div className="space-y-2">
            <Label>Reporting currency</Label>
            <Select
              value={reporting}
              onValueChange={(v) => setReportingOverride(v as HouseholdCurrency)}
            >
              <SelectTrigger>
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
              Used for exports and year-end statements. Often the same as primary.
            </p>
          </div>
        </div>

        <div className="space-y-2">
          <Label>Bitcoin display</Label>
          <Select
            value={btcMode}
            onValueChange={(v) => setBtcOverride(v as HouseholdBtcDisplayMode)}
          >
            <SelectTrigger className="max-w-[260px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {BTC_MODES.map((m) => (
                <SelectItem key={m.value} value={m.value}>
                  {m.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            How Bitcoin amounts appear throughout the app.
          </p>
        </div>

        <div className="flex justify-end pt-2">
          <Button onClick={handleSave} disabled={!dirty || saving}>
            <Save className="mr-2 h-4 w-4" />
            {saving ? "Saving…" : "Save preferences"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
