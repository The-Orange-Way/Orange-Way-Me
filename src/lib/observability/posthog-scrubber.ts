/**
 * PostHog event scrubber. Runs in posthog.init via the before_send hook
 * and trims any property that could carry decrypted financial content
 * to PostHog by accident.
 *
 * The hook fires for every event (pageview, custom capture, autocapture)
 * before the network call. Returning the event with modified properties
 * sends the trimmed version; returning null drops the event.
 *
 * Cybersec audit 2026-06-19. Companion to Sentry's beforeSend hook
 * which does the same job on the error-reporting side.
 */

/**
 * Property keys whose VALUES are scrubbed unconditionally. Match by
 * lowercase substring against the property key name.
 */
const SCRUB_VALUE_KEY_HINTS = [
  "account",
  "household",
  "transaction",
  "merchant",
  "category",
  "budget",
  "goal",
  "rule",
  "email",
  "password",
  "vault",
  "mek",
  "opk",
  "recovery",
  "verifier",
  "ciphertext",
  "plaintext",
  "balance",
  "amount",
  "memo",
  "description",
  "notes",
  "name",
  "token",
];

/**
 * UUID and slug-ish path segments that we treat as sensitive when they
 * appear in URL paths. PostHog captures both `$current_url` and
 * `$pathname` on pageviews; we rewrite both.
 */
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const LONG_NUM_RE = /\/\d{6,}(?=\/|$)/g;
const BASE64ISH_RE = /\/[A-Za-z0-9+/=_-]{16,}(?=\/|$)/g;

function scrubUrl(input: unknown): unknown {
  if (typeof input !== "string") return input;
  let out = input;
  // Drop query strings entirely. Search params can carry account IDs,
  // recovery tokens, or other one-time URL-bound state.
  const q = out.indexOf("?");
  if (q >= 0) out = out.slice(0, q) + "?[redacted]";
  // Drop URL fragments. Recovery tokens land in the fragment on the
  // reset-password route.
  const h = out.indexOf("#");
  if (h >= 0) out = out.slice(0, h) + "#[redacted]";
  // Replace UUIDs / long numeric ids / long opaque path segments.
  out = out.replace(UUID_RE, "[uuid]");
  out = out.replace(LONG_NUM_RE, "/[id]");
  out = out.replace(BASE64ISH_RE, "/[opaque]");
  return out;
}

function shouldScrubKey(key: string): boolean {
  const k = key.toLowerCase();
  return SCRUB_VALUE_KEY_HINTS.some((hint) => k.includes(hint));
}

function scrubProperties(
  props: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!props) return props;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(props)) {
    if (key === "$current_url" || key === "$referrer" || key === "$pathname") {
      out[key] = scrubUrl(value);
      continue;
    }
    if (shouldScrubKey(key)) {
      out[key] = "[redacted]";
      continue;
    }
    if (typeof value === "string" && value.length > 256) {
      // Cap long strings: a 1KB string in an event property is almost
      // never a deliberate analytics signal, but it's a great way to
      // accidentally exfiltrate ciphertext or a base64-encoded key.
      out[key] = value.slice(0, 256) + "…";
      continue;
    }
    out[key] = value;
  }
  return out;
}

/**
 * Exported as the `before_send` argument to `posthog.init`. PostHog
 * types this as `(event) => event | null`. We always return the event
 * (with scrubbed properties) rather than dropping; dropping silently
 * would hide a bug where a route renders sensitive data in the URL.
 */
export function scrubPostHogEvent<T extends { properties?: Record<string, unknown> }>(
  event: T,
): T {
  if (!event) return event;
  return { ...event, properties: scrubProperties(event.properties) };
}
