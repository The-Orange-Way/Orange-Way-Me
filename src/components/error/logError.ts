import posthog from "posthog-js";
import { captureException as sentryCapture } from "@/lib/observability/sentry";

// Centralized error logger for boundary onError handlers. Logs ONLY the
// error object — never React props/state, never component snapshots — to
// keep decrypted customer data out of console + PostHog + Sentry (ZKA
// invariant). All captures are best-effort; a logger failure must never
// throw and re-trigger the boundary.
export function logBoundaryError(error: Error, source: string): void {
  console.error(`[orangeway:${source}] render error`, error);
  try {
    posthog.captureException?.(error, { source });
  } catch {
    // PostHog not initialized (SSR / test) — swallow.
  }
  try {
    sentryCapture(error, { tags: { source } });
  } catch {
    // Sentry not initialized (VITE_SENTRY_DSN unset) — swallow. console.error
    // above remains the primary signal in that case.
  }
}
