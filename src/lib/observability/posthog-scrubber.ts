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

// PostHog reserved auto-capture properties that carry quasi-identifiers.
// These are matched by exact key (with the leading $) and replaced with
// "[redacted]", separately from the substring-hint list above so a regular
// "ip" or "browser" inside a payload still passes through unchanged.
// Audit follow-up 2026-06-20: Law 25 / GDPR recital 75 treat IP, browser,
// and device fingerprints as identifiers when joined to a user id.
const SCRUB_RESERVED_KEYS = new Set([
  "$ip",
  "$browser",
  "$browser_version",
  "$device",
  "$device_id",
  "$device_type",
  "$os",
  "$os_version",
  "$user_agent",
]);

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

// Max recursion depth into nested objects/arrays. PostHog event
// properties are flat by convention, but a callsite could pass a
// nested shape by accident. A depth of 4 covers any realistic
// payload while preventing pathological structures from running
// the scrubber for an unbounded amount of time.
const MAX_SCRUB_DEPTH = 4;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function scrubValue(key: string, value: unknown, depth: number): unknown {
  if (key === "$current_url" || key === "$referrer" || key === "$pathname") {
    return scrubUrl(value);
  }
  if (SCRUB_RESERVED_KEYS.has(key)) {
    return "[redacted]";
  }
  if (shouldScrubKey(key)) {
    return "[redacted]";
  }
  if (typeof value === "string" && value.length > 256) {
    // Cap long strings: a 1KB string in an event property is almost
    // never a deliberate analytics signal, but it's a great way to
    // accidentally exfiltrate ciphertext or a base64-encoded key.
    return value.slice(0, 256) + "…";
  }
  if (depth >= MAX_SCRUB_DEPTH) {
    // Past the depth cap: pass primitives through, but redact any
    // further nesting so a deliberately-deep payload cannot smuggle
    // sensitive content past the scrubber.
    if (isPlainObject(value) || Array.isArray(value)) return "[redacted-deep]";
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((v) => scrubValue(key, v, depth + 1));
  }
  if (isPlainObject(value)) {
    const inner: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      inner[k] = scrubValue(k, v, depth + 1);
    }
    return inner;
  }
  return value;
}

function scrubProperties(
  props: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!props) return props;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(props)) {
    out[key] = scrubValue(key, value, 0);
  }
  return out;
}

import type { CaptureResult } from "posthog-js";

/**
 * Exported as the `before_send` argument to `posthog.init`. PostHog
 * types this as `(event: CaptureResult | null) => CaptureResult | null`.
 * We always return the event (with scrubbed properties) rather than
 * dropping; dropping silently would hide a bug where a route renders
 * sensitive data in the URL.
 */
export function scrubPostHogEvent(event: CaptureResult | null): CaptureResult | null {
  if (!event) return event;
  return {
    ...event,
    properties: scrubProperties(event.properties as Record<string, unknown> | undefined) ?? {},
  };
}
