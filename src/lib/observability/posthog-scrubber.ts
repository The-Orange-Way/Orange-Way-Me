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

import { redactValueShapes } from "./value-shapes";

/**
 * Property keys whose VALUES are scrubbed unconditionally. Match by
 * lowercase substring against the property key name.
 *
 * This is a KEY-NAME list. It cannot see a sensitive value that arrives
 * under an innocuous name; that case is handled by redactValueShapes,
 * which both this scrubber and sentry.ts import from value-shapes.ts.
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
  "or_stealth_key",
  "stealth_key",
  "key",
  "seed",
  "secret",
  "xpub",
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
  // Key-material names below. Each is a SUBSTRING hint, chosen per name
  // because none has a plausible innocuous carrier as a property key.
  //
  // "password" above does NOT cover "passphrase": neither string contains
  // the other, so the passphrase case was reaching analytics unredacted.
  "passphrase",
  // BIP39 raw entropy.
  "entropy",
  // BIP32 extended PRIVATE key. "xprv" is the real serialization prefix and
  // "xpriv" is the common informal spelling. Neither contains the other, and
  // the "xpub" hint above matches neither, so both are listed. Listing only
  // the informal spelling would leave the actual on-the-wire prefix
  // uncovered.
  "xpriv",
  "xprv",
  // KDF salt. Has to stay a substring because it arrives as "kdf_salt" and
  // "password_salt" as well as bare "salt". The only English words that
  // contain it (asphalt, basalt) are not plausible analytics property keys.
  "salt",
  // AEAD nonce. A CSP nonce also matches this hint, and redacting one in
  // analytics costs nothing. That same trade would NOT be acceptable in
  // sentry.ts, which is used to debug CSP violations.
  "nonce",
];

/**
 * Key names matched as WHOLE TOKENS, case-insensitively, rather than by
 * substring. A name belongs here when the bare substring would match
 * ordinary, harmless keys.
 *
 * "pin" is the case that forced this second mechanism to exist: it is a
 * substring of shipping, mapping, typing, grouping, pinned and spinner, so
 * as a substring hint it would blank a large set of unrelated analytics
 * properties. Tokenising the key first keeps user_pin, userPin and pin_hash
 * covered while leaving those alone.
 */
const SCRUB_VALUE_KEY_EXACT = new Set(["pin"]);

/**
 * Split a property key into lowercase word tokens, on both separator
 * characters and camelCase boundaries, so "userPin", "user_pin" and
 * "pin-hash" all yield a bare "pin" token.
 */
function keyTokens(key: string): string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((t) => t.toLowerCase());
}

// PostHog reserved auto-capture properties that carry quasi-identifiers.
// These are matched by exact key (with the leading $) and replaced with
// "[redacted]", separately from the substring-hint list above so a regular
// "ip" or "browser" inside a payload still passes through unchanged.
// Audit follow-up 2026-06-20: Law 25 / GDPR recital 75 treat IP, browser,
// and device fingerprints as identifiers when joined to a user id.
//
// $ip is handled separately (see IP_KEY below): PostHog reads it for
// server-side GeoIP, and only a literal null reliably suppresses that.
const SCRUB_RESERVED_KEYS = new Set([
  "$browser",
  "$browser_version",
  "$device",
  "$device_id",
  "$device_type",
  "$os",
  "$os_version",
  "$user_agent",
]);

// The IP property PostHog uses for server-side GeoIP enrichment. Unlike
// the fingerprint keys above, a redaction STRING does not stop GeoIP:
// PostHog only reliably skips enrichment when $ip is the literal null.
// We null it here and pair that with the $geoip_disable flag set in
// scrubPostHogEvent.
const IP_KEY = "$ip";

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
  // A key-shaped path segment or query value is not necessarily a UUID,
  // a long number, or long enough to trip BASE64ISH_RE.
  return redactValueShapes(out);
}

function shouldScrubKey(key: string): boolean {
  const k = key.toLowerCase();
  if (SCRUB_VALUE_KEY_HINTS.some((hint) => k.includes(hint))) return true;
  return keyTokens(key).some((t) => SCRUB_VALUE_KEY_EXACT.has(t));
}

// Max recursion depth into nested objects/arrays. PostHog event
// properties are flat by convention, but a callsite could pass a
// nested shape by accident. A depth of 4 covers any realistic
// payload while preventing pathological structures from running
// the scrubber for an unbounded amount of time. Exported so the
// test suite can verify against the same constant rather than a
// magic number.
export const MAX_SCRUB_DEPTH = 4;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (typeof v !== "object" || v === null) return false;
  if (Array.isArray(v)) return false;
  // Reject typed containers like Date, Map, Set, RegExp, etc. Their
  // own-property keys are usually empty, so Object.entries(v) would
  // silently turn them into {}; better to leave them untouched.
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

function scrubValue(key: string, value: unknown, depth: number): unknown {
  if (key === "$current_url" || key === "$referrer" || key === "$pathname") {
    return scrubUrl(value);
  }
  if (key === IP_KEY) {
    // Literal null, not a string: this is what makes PostHog skip
    // server-side GeoIP enrichment for the event.
    return null;
  }
  if (SCRUB_RESERVED_KEYS.has(key)) {
    return "[redacted]";
  }
  if (shouldScrubKey(key)) {
    return "[redacted]";
  }
  if (typeof value === "string") {
    // Value-shape pass first. The cap below keeps the FIRST 256
    // characters, so a long string carrying an extended key near its
    // front would otherwise be truncated and still ship the key.
    const shaped = redactValueShapes(value);
    if (shaped.length > 256) {
      // Cap long strings: a 1KB string in an event property is almost
      // never a deliberate analytics signal, but it's a great way to
      // accidentally exfiltrate ciphertext or a base64-encoded key.
      return shaped.slice(0, 256) + "…";
    }
    return shaped;
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
      // Defensive: skip dangerous key names. Object.entries already
      // excludes non-enumerable keys, so __proto__ on a literal will
      // not appear here, but a key parsed from JSON.parse could.
      if (k === "__proto__" || k === "constructor" || k === "prototype") continue;
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
 * On the normal path we return the event with scrubbed properties rather
 * than dropping it; dropping silently would hide a bug where a route
 * renders sensitive data in the URL.
 *
 * The one case where we DO drop is a scrubbing failure. See the catch
 * below: that path fails closed on purpose.
 */
export function scrubPostHogEvent(event: CaptureResult | null): CaptureResult | null {
  if (!event) return event;
  try {
    const properties =
      scrubProperties(event.properties as Record<string, unknown> | undefined) ?? {};
    // Documented, reliable switch that tells PostHog's server-side enricher
    // to skip GeoIP for this event. Nulling $ip alone can fall back to the
    // connection's socket IP; this flag closes that gap. The socket IP still
    // transiently reaches the collector on a direct browser connection by
    // construction - a first-party proxy is the only way to stop that and is
    // tracked separately.
    properties.$geoip_disable = true;
    return {
      ...event,
      properties,
    };
  } catch {
    // FAIL CLOSED. If scrubbing threw we cannot know which properties were
    // cleaned and which were not, so the event is dropped rather than sent.
    // Letting the throw propagate, or returning the original event, would
    // ship exactly the payload this scrubber exists to stop.
    return null;
  }
}
