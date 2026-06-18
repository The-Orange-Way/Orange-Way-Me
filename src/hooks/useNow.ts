import { useEffect, useState } from "react";

/**
 * useNow — return the current epoch ms, refreshed on an interval.
 *
 * Use this anywhere you'd otherwise call `Date.now()` during render to
 * compute a relative-time label ("expires in 5m", "synced 2h ago",
 * "<24h ago"). Calling `Date.now()` inline during render is impure and
 * trips `react-hooks/purity`; it also doesn't refresh — once the
 * component renders, the displayed label is frozen until something else
 * triggers a re-render.
 *
 * The hook holds the timestamp in state and ticks via `setInterval` so
 * relative labels stay live without each consumer wiring their own
 * timer. Default cadence is 60s, which is right for "5m ago" / "1h
 * left" copy. Pass a smaller interval (e.g. 1000) for second-precision
 * countdowns, but mind battery on always-on tabs.
 *
 * Lazy initialiser keeps the initial `Date.now()` out of the render-
 * time impure-call bucket. The setInterval lives inside `useEffect`,
 * so it never runs during SSR.
 */
export function useNow(intervalMs: number = 60_000): number {
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}
