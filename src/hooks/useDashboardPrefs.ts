/**
 * useDashboardPrefs — local-only user preferences for dashboard display.
 *
 * Stored in localStorage keyed by user id. No PII; just display knobs +
 * dismissed recurring bill keys (which are derived from blind-index hashes,
 * already opaque — but we keep them client-side regardless).
 */
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import type { SupportedCurrency } from "@/lib/fx-rates";

export type NetWorthRange = "1M" | "3M" | "6M" | "1Y" | "ALL";
export type NumberFormatPref = "us" | "eu";
export type DateFormatPref = "us" | "eu" | "iso";
export type BtcDisplayMode = "sats" | "btc" | "btc_easy" | "primary";

export interface DashboardPrefs {
  primaryCurrency: SupportedCurrency;
  netWorthRange: NetWorthRange;
  btcDisplayMode: BtcDisplayMode;
  numberFormat: NumberFormatPref;
  dateFormat: DateFormatPref;
  /** Minutes of inactivity before the vault auto-locks. 0 = disabled. */
  autoLockMinutes: number;
  dismissedRecurring: string[];
}

const DEFAULTS: DashboardPrefs = {
  primaryCurrency: "USD",
  netWorthRange: "6M",
  btcDisplayMode: "btc",
  numberFormat: "us",
  dateFormat: "us",
  // 15-minute idle auto-lock. Prior default was 0 (off) which is too lax for
  // a Bitcoin-finance app: if a user steps away with the vault unlocked,
  // anyone at the device sees decrypted balances and can authorize bank
  // syncs. Users can dial it back to 0 in Settings if they want.
  autoLockMinutes: 15,
  dismissedRecurring: [],
};

function storageKey(userId: string | undefined): string {
  return `bitbooks.prefs.${userId ?? "anon"}`;
}

function read(userId: string | undefined): DashboardPrefs {
  if (typeof window === "undefined") return DEFAULTS;
  try {
    const raw = window.localStorage.getItem(storageKey(userId));
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<DashboardPrefs>;
    return { ...DEFAULTS, ...parsed };
  } catch {
    return DEFAULTS;
  }
}

function write(userId: string | undefined, prefs: DashboardPrefs): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey(userId), JSON.stringify(prefs));
  } catch {
    // ignore quota / private mode failures
  }
}

// Same-tab pub/sub so every useDashboardPrefs() instance re-reads when ANY
// of them calls update(). Without this, the dashboard toggle and the cards
// (which each call useDashboardPrefs separately) hold independent state
// copies — clicking USD on the toggle updates the toggle but the cards
// stay rendered in the old currency. The `storage` event only fires across
// tabs/windows, so we use a custom DOM event to sync within this tab.
const PREFS_UPDATED_EVENT = "ow:dashboard-prefs-updated";

function notifyUpdate(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(PREFS_UPDATED_EVENT));
}

export function useDashboardPrefs() {
  const { user } = useAuth();
  const [prefs, setPrefs] = useState<DashboardPrefs>(() => read(user?.id));

  useEffect(() => {
    setPrefs(read(user?.id));
  }, [user?.id]);

  // Re-read whenever any other instance writes. Same-tab sync.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onLocal = () => setPrefs(read(user?.id));
    const onStorage = (e: StorageEvent) => {
      if (e.key === storageKey(user?.id)) setPrefs(read(user?.id));
    };
    window.addEventListener(PREFS_UPDATED_EVENT, onLocal);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(PREFS_UPDATED_EVENT, onLocal);
      window.removeEventListener("storage", onStorage);
    };
  }, [user?.id]);

  const update = useCallback(
    (patch: Partial<DashboardPrefs>) => {
      setPrefs((prev) => {
        const next = { ...prev, ...patch };
        write(user?.id, next);
        return next;
      });
      notifyUpdate();
    },
    [user?.id],
  );

  const dismissRecurring = useCallback(
    (key: string) => {
      setPrefs((prev) => {
        if (prev.dismissedRecurring.includes(key)) return prev;
        const next = { ...prev, dismissedRecurring: [...prev.dismissedRecurring, key] };
        write(user?.id, next);
        return next;
      });
      notifyUpdate();
    },
    [user?.id],
  );

  const restoreRecurring = useCallback(
    (key: string) => {
      setPrefs((prev) => {
        const next = {
          ...prev,
          dismissedRecurring: prev.dismissedRecurring.filter((k) => k !== key),
        };
        write(user?.id, next);
        return next;
      });
      notifyUpdate();
    },
    [user?.id],
  );

  return { prefs, update, dismissRecurring, restoreRecurring };
}
