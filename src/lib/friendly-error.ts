import { toast } from "sonner";

/**
 * Show a customer-friendly error toast. Logs the raw error to the
 * console so engineers still get the unfiltered shape during dev /
 * GlitchTip triage, and toasts the humanized copy to the user.
 *
 * Use this anywhere you'd otherwise write:
 *
 *   toastError(err, "Save failed");
 *
 * — which is now most of the codebase. The wrapper makes the pattern
 * one call instead of two and ensures the console.error sidecar happens
 * uniformly. The raw error is what Sentry's beforeSend sees, so the
 * console line is the engineer-facing copy and the toast is the
 * user-facing one.
 */
export function toastError(err: unknown, fallback?: string): void {
  // Log first so the unredacted shape is visible in DevTools when the
  // toast also fires. Sentry/GlitchTip auto-captures these via the
  // global handler when consentful.
  if (err) console.error(err);
  toast.error(humanizeError(err, fallback));
}

/**
 * Translate a raw error into a customer-friendly message. The raw message
 * stays in the console for debugging; this just makes the toast readable for
 * someone who has no idea what "401" or "Failed to fetch" means.
 *
 * Returns a short sentence ending in a period.
 */
export function humanizeError(
  err: unknown,
  fallback = "Something went wrong. Please try again.",
): string {
  const raw = err instanceof Error ? err.message : String(err ?? "");
  const lower = raw.toLowerCase();

  if (!raw || raw === "null" || raw === "undefined") return fallback;

  if (
    lower.includes("not authenticated") ||
    lower.includes("not signed in") ||
    lower.includes("no session")
  ) {
    return "Your session timed out. Please sign in again.";
  }
  if (lower.includes("unauthorized") || lower.includes(" 401")) {
    return "Your session expired. Please sign in again.";
  }
  if (lower.includes("forbidden") || lower.includes(" 403")) {
    return "We can't reach this service right now. Try again in a moment.";
  }
  if (lower.includes("not found") || lower.includes(" 404")) {
    return "That item is no longer there.";
  }
  if (
    lower.includes("failed to fetch") ||
    lower.includes("networkerror") ||
    lower.includes("network request failed") ||
    lower.includes("load failed")
  ) {
    return "Connection problem. Check your internet and try again.";
  }
  if (lower.includes("vault") && (lower.includes("locked") || lower.includes("unlock"))) {
    return "Your vault is locked. Unlock it and try again.";
  }
  if (lower.includes("popup") || lower.includes("pop-up")) {
    return "The pop-up was blocked or closed. Try again and keep the window open until it finishes.";
  }
  if (
    lower.includes("rate limit") ||
    lower.includes(" 429") ||
    lower.includes("too many requests")
  ) {
    return "Too many tries in a short time. Wait a minute, then try again.";
  }
  if (lower.includes("region") || lower.includes("not permitted from this country")) {
    return "We can't reach your bank's provider right now. Try again in a moment.";
  }
  // Quiltt / OR bank-connection states the user can act on, mapped to
  // plain-English copy so a sync failure points them at the fix instead of
  // leaking the upstream state name.
  if (
    lower.includes("mfa_required") ||
    lower.includes("mfa required") ||
    lower.includes("authentication required")
  ) {
    return "Your bank wants you to verify it's really you. Try reconnecting from Connections.";
  }
  if (
    lower.includes("credentials_required") ||
    lower.includes("credentials required") ||
    lower.includes("invalid credentials") ||
    lower.includes("login expired")
  ) {
    return "Your bank login expired. Open Connections and reconnect to refresh it.";
  }
  if (lower.includes("institution_unavailable") || lower.includes("institution unavailable")) {
    return "Your bank's connection service is down right now. Try again in a few minutes.";
  }
  if (lower.includes("duplicate key") || lower.includes("unique constraint")) {
    return "Looks like that's already in your account.";
  }
  if (lower.includes("timeout") || lower.includes("timed out")) {
    return "That took longer than expected. Please try again.";
  }
  if (lower.includes("statement timeout") || lower.includes("canceling statement")) {
    return "We hit a snag on the server. Give it a moment and try again.";
  }
  // OR / Orange Way edge-function failures bubble up as "owm-or-X failed: …" or
  // "or-link-mint-token failed (500): …". Strip the function name so the
  // user sees the underlying problem ("Not signed in.") instead of an
  // edge-function URL slug they have no relationship with.
  if (/^(owm-or|or-)[\w-]+ failed\b/i.test(raw)) {
    const m = raw.match(/:\s*(.+)$/);
    if (m && m[1]) {
      const tail = m[1].trim();
      const head = tail.slice(0, 1).toUpperCase() + tail.slice(1);
      if (head.length > 140) return head.slice(0, 137) + "…";
      return head.endsWith(".") || head.endsWith("!") || head.endsWith("?") ? head : head + ".";
    }
    return "We couldn't reach a service that helps connect your bank. Try again in a moment.";
  }
  // Specific Quiltt / OR pipeline copies — surface as a sentence the user
  // can act on rather than a debug string.
  if (lower.includes("returned no widget_token")) {
    return "We couldn't open the bank link. Please try again.";
  }
  if (lower.includes("returned no accounts") || lower.includes("returned no data")) {
    return "Your bank connected, but we didn't see any accounts yet. Try the sync again in a moment.";
  }
  // Drop engineer-y prefixes the codebase sometimes throws with so the
  // tail of the message isn't paired with "Failed to create account: …".
  const stripped = raw.replace(/^(failed to (create|map|update|delete|fetch|save)[^:]*:\s*)/i, "");
  if (stripped !== raw) {
    const head = stripped.trim().slice(0, 1).toUpperCase() + stripped.trim().slice(1);
    if (head.length > 140) return head.slice(0, 137) + "…";
    return head.endsWith(".") || head.endsWith("!") || head.endsWith("?") ? head : head + ".";
  }

  // For anything else, surface a short version of the message rather than the
  // full stack-like string, capped so toasts stay readable.
  const trimmed = raw.trim();
  if (trimmed.length > 140) return trimmed.slice(0, 137) + "…";
  return trimmed.endsWith(".") || trimmed.endsWith("!") || trimmed.endsWith("?")
    ? trimmed
    : trimmed + ".";
}
