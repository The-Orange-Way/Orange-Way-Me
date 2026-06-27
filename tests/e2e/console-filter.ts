/**
 * Shared console-error filter for e2e specs.
 *
 * Two specs need the same baseline filter (smoke + pw-screenshots). Kept
 * in one place so adding a new known-benign console pattern only needs
 * one edit.
 *
 * Each entry is a substring matched with String.includes. If a console
 * error contains any of these substrings, it is dropped from the
 * "significant errors" set asserted against `[]`.
 *
 * - "Download the React DevTools": React's dev-mode install nudge.
 * - "chrome-extension://": background noise from a contributor's
 *   browser extensions during local dev runs.
 * - "Loading chunk": transient Vite chunk-loading messages that resolve
 *   on retry; not a real error to surface.
 * - "PostHog": any explicit PostHog vendor-prefixed log.
 * - "font-size:0;color:transparent": posthog-js's `%c%d` fingerprint
 *   probe carrier. The format-substitution output some browsers
 *   surface as a console.error. No PostHog token in the rendered line.
 */
export const FILTERED_CONSOLE_SUBSTRINGS = [
  "Download the React DevTools",
  "chrome-extension://",
  "Loading chunk",
  "PostHog",
  "font-size:0;color:transparent",
] as const;

/**
 * Returns true if the message matches any baseline carve-out and should
 * be filtered out before the assertion. Specs may add their own
 * route-specific carve-outs on top.
 */
export function isFilteredConsoleMessage(message: string): boolean {
  return FILTERED_CONSOLE_SUBSTRINGS.some((s) => message.includes(s));
}
