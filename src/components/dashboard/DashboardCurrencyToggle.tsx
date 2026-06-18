/**
 * DashboardCurrencyToggle — chip group in the dashboard header that flips
 * `prefs.primaryCurrency` between the user's held fiat currencies and BTC.
 *
 * The options are derived from the currencies the user actually holds in
 * accounts, unioned with BTC (so a Bitcoiner with only BTC sees `BTC | USD`
 * — USD is always offered as a comparable). Dashboard math reads
 * `prefs.primaryCurrency` so all totals re-render the moment the user
 * clicks. BTC values come from live ORBI quotes via fx-rates → orbi-rates.
 */
import { useMemo } from "react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useAccounts } from "@/hooks/useAccounts";
import { useDashboardPrefs } from "@/hooks/useDashboardPrefs";
import { SUPPORTED_CURRENCIES, type SupportedCurrency } from "@/lib/fx-rates";

function isSupported(code: string): code is SupportedCurrency {
  return (SUPPORTED_CURRENCIES as readonly string[]).includes(code);
}

export function DashboardCurrencyToggle() {
  const { accounts } = useAccounts();
  const { prefs, update } = useDashboardPrefs();

  const options = useMemo<SupportedCurrency[]>(() => {
    const held = new Set<SupportedCurrency>();
    for (const a of accounts) {
      const c = (a.currency ?? "").toUpperCase();
      if (isSupported(c)) held.add(c);
    }
    // Always offer USD as a comparable fiat for Bitcoin-only families,
    // and always offer BTC so any family can see their numbers in sats.
    if (held.size === 0) held.add("USD");
    held.add("BTC");
    // Stable order: keep SUPPORTED_CURRENCIES sequence (USD, CAD, EUR, GBP, BTC, sats).
    return SUPPORTED_CURRENCIES.filter((c) => held.has(c));
  }, [accounts]);

  // Don't show a single-button toggle.
  if (options.length < 2) return null;

  function handleChange(v: string) {
    if (!v) return; // radix returns "" when the user clicks the active item
    if (isSupported(v)) update({ primaryCurrency: v });
  }

  return (
    <ToggleGroup
      type="single"
      value={prefs.primaryCurrency}
      onValueChange={handleChange}
      variant="outline"
      size="sm"
      aria-label="Display currency"
      className="rounded-full border border-border bg-muted/40 p-0.5"
    >
      {options.map((c) => (
        <ToggleGroupItem
          key={c}
          value={c}
          // Strong active state so users can see which currency they picked.
          // Inactive: muted, transparent. Active: orange pill with white text.
          className={
            "rounded-full border-0 px-3 text-xs font-semibold transition-colors " +
            "data-[state=on]:bg-orange-500 data-[state=on]:text-white data-[state=on]:shadow-sm " +
            "data-[state=off]:bg-transparent data-[state=off]:text-muted-foreground " +
            "data-[state=off]:hover:text-foreground"
          }
        >
          {c}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
