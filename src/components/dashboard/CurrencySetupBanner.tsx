/**
 * CurrencySetupBanner — one-time nudge on the dashboard.
 *
 * Shown when the household still has the default primary currency (USD)
 * but the user's accounts are mostly in a different currency. A single
 * click sets primary + reporting to the dominant account currency. The
 * banner remembers a localStorage dismissal per user so it doesn't keep
 * pestering people who don't want to bother.
 *
 * Hidden when:
 *   - no household yet (the user hasn't completed setup),
 *   - dominant account currency is USD (no mismatch),
 *   - household primary_currency was already changed away from the default,
 *   - the user dismissed the banner before.
 */
import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import { ArrowRight, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "sonner";
import { toastError } from "@/lib/friendly-error";
import { useAuth } from "@/context/AuthContext";
import { useHousehold, type HouseholdCurrency } from "@/hooks/useHousehold";
import { useAccounts } from "@/hooks/useAccounts";
import { useDashboardPrefs } from "@/hooks/useDashboardPrefs";
import { SUPPORTED_CURRENCIES } from "@/lib/fx-rates";
import { isBitcoinCurrency, normalizeBitcoinToSats, unitIsExact } from "@/lib/format";

function dismissKey(userId: string | undefined): string {
  return `orangeway.currencyBannerDismissed.${userId ?? "anon"}`;
}

/** Subscribe React to localStorage updates for the dismiss flag, scoped
 *  to the current user. Avoids the setState-in-effect pattern. */
function useDismissed(userId: string | undefined, bump: number): boolean {
  const subscribe = useCallback((cb: () => void) => {
    if (typeof window === "undefined") return () => undefined;
    window.addEventListener("storage", cb);
    return () => window.removeEventListener("storage", cb);
  }, []);
  const getSnapshot = useCallback(() => {
    if (typeof window === "undefined") return false;
    // `bump` is referenced so React re-reads after our own writes; the
    // `storage` event only fires for OTHER tabs/windows.
    void bump;
    return window.localStorage.getItem(dismissKey(userId)) === "1";
  }, [userId, bump]);
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}

function dominantCurrency(
  accounts: ReadonlyArray<{ currency: string; balance: number | string; format_version?: number }>,
): HouseholdCurrency | null {
  if (accounts.length === 0) return null;
  const totals: Record<string, number> = {};
  for (const a of accounts) {
    const code = (a.currency ?? "").toUpperCase();
    if (!(SUPPORTED_CURRENCIES as readonly string[]).includes(code)) continue;
    const n = Number(a.balance) || 0;
    const magnitude = isBitcoinCurrency(code)
      ? normalizeBitcoinToSats(n, code, { unitIsExact: unitIsExact(a.format_version) })
      : n;
    totals[code] = (totals[code] ?? 0) + Math.abs(magnitude);
  }
  const top = Object.entries(totals).sort((a, b) => b[1] - a[1])[0];
  return (top?.[0] as HouseholdCurrency | undefined) ?? null;
}

export function CurrencySetupBanner() {
  const { user } = useAuth();
  const { household, updateCurrencyPrefs } = useHousehold();
  const { accounts } = useAccounts();
  const { update: updatePrefs } = useDashboardPrefs();

  const [dismissBump, setDismissBump] = useState(0);
  const dismissed = useDismissed(user?.id, dismissBump);
  const [applying, setApplying] = useState(false);

  const suggested = useMemo(() => dominantCurrency(accounts), [accounts]);

  if (dismissed) return null;
  if (!household) return null;
  if (household.primary_currency !== "USD") return null;
  if (!suggested || suggested === "USD") return null;

  function dismiss() {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(dismissKey(user?.id), "1");
    }
    setDismissBump((n) => n + 1);
  }

  async function applySuggestion() {
    if (!suggested) return;
    setApplying(true);
    try {
      await updateCurrencyPrefs({
        primary_currency: suggested,
        reporting_currency: suggested,
      });
      updatePrefs({ primaryCurrency: suggested });
      dismiss();
      toast.success(`Household currency set to ${suggested}.`);
    } catch (err) {
      toastError(err, "Couldn't update currency.");
    } finally {
      setApplying(false);
    }
  }

  return (
    <Card className="border-orange-500/40 bg-orange-500/5">
      <CardContent className="flex flex-wrap items-center justify-between gap-3 py-3">
        <div className="text-sm">
          Your accounts are mostly in <span className="font-semibold">{suggested}</span>. Want to
          set it as your household&apos;s primary currency?
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={applySuggestion} disabled={applying}>
            Use {suggested}
            <ArrowRight className="ml-2 h-3.5 w-3.5" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={dismiss}
            aria-label="Dismiss"
            className="h-8 w-8 p-0"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
