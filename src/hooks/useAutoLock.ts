/**
 * useAutoLock — locks the vault after a configurable idle period.
 * Listens for mouse/keyboard/touch events to reset the idle timer.
 * Only active when the vault is unlocked and autoLockMinutes > 0.
 */
import { useEffect, useRef } from "react";
import { useVault } from "@/context/VaultContext";
import { useDashboardPrefs } from "@/hooks/useDashboardPrefs";

const EVENTS: (keyof WindowEventMap)[] = [
  "mousemove",
  "mousedown",
  "keydown",
  "touchstart",
  "scroll",
];

export function useAutoLock() {
  const { isUnlocked, lock } = useVault();
  const { prefs } = useDashboardPrefs();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const minutes = prefs.autoLockMinutes;
    if (!isUnlocked || minutes <= 0) return;

    const ms = minutes * 60 * 1000;

    const reset = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(lock, ms);
    };

    reset();
    EVENTS.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      EVENTS.forEach((e) => window.removeEventListener(e, reset));
    };
  }, [isUnlocked, prefs.autoLockMinutes, lock]);
}
