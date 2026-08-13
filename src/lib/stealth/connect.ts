/**
 * Stealth Connect, Bitcoin source launch URL and inbound error copy.
 *
 * The Bitcoin source button opens the OR Connect stealth widget. This module
 * holds the two pure pieces the button wiring depends on: the widget URL,
 * which carries only parent_origin and never a session, token, or key
 * material, and the mapping from an untrusted widget ERROR to fixed local
 * user-facing copy. It carries no key material, no HKDF, no vault access, and
 * no UI, so it can be reviewed and unit tested on its own.
 */

import { OR_CONNECT_BASE } from "../or/widget";
import type { StealthInboundMessage } from "./channel";

/**
 * Build the stealth widget URL for the given window origin.
 *
 * OR_CONNECT_BASE already ends in /connect, so the stealth route is
 * `${OR_CONNECT_BASE}/stealth`. parent_origin is URL-encoded so an origin
 * carrying a port or a non-default scheme survives intact. The URL carries
 * nothing else: the opening handshake supplies the callback origin over
 * postMessage, and key derivation is a separate layer above the channel.
 */
export function buildStealthConnectUrl(origin: string): string {
  return `${OR_CONNECT_BASE}/stealth?parent_origin=${encodeURIComponent(origin)}`;
}

/**
 * Address gap the widget scans past the last used address before it stops.
 * 250 matches what the widget itself uses, and it is well inside the 1..1000
 * the widget accepts, so a caller never trips INVALID_GAP_LIMIT.
 */
export const STEALTH_GAP_LIMIT = 250;

/**
 * The INIT fields this slice supplies, minus the callback origin.
 *
 * The widget validates, in this order: sender origin on its allowlist,
 * return_callback_origin equal to the sender origin, protocol_version, then
 * app_slug and app_user_id as strings and mode as one of add / sync / list /
 * delete. return_callback_origin and protocol_version are owned by the
 * transport, never by this builder, so a caller cannot weaken either.
 *
 * or_stealth_key_b64 is deliberately absent. It is required for the widget to
 * proceed past validation, and deriving it is a separate, reviewed change: no
 * key leaves the vault through this path.
 */
export function buildStealthInit(args: {
  appSlug: string;
  appUserId: string;
  gapLimit?: number;
}): Record<string, unknown> {
  const init: Record<string, unknown> = {
    app_slug: args.appSlug,
    app_user_id: args.appUserId,
    mode: "add",
  };
  if (args.gapLimit !== undefined) init.gap_limit = args.gapLimit;
  return init;
}

/**
 * Fixed, local, user-facing copy for a widget ERROR, keyed by its `code`.
 *
 * `code` arrives from another origin over postMessage and is UNTRUSTED, so we
 * never surface the widget's own strings. We look the code up here and fall
 * back to one generic line for anything not listed. Adding a code here is the
 * only way a specific message ever reaches the user.
 *
 * The two codes below are the ones a person can act on, and they are the two
 * that tell us apart a rejected origin from a rejected request. Every other
 * code the widget can raise stays on the generic line, including any code it
 * adds later, which is what makes this fail safe.
 *
 * A Map, not an object literal, because the key is attacker-controlled: an
 * object literal inherits from Object.prototype, so a code equal to an
 * inherited member name (constructor, toString) would resolve to that member
 * instead of falling through, and the lookup would yield something that is
 * not a string. A Map only ever answers for keys put in it.
 */
export const STEALTH_ERROR_COPY: ReadonlyMap<string, string> = new Map([
  [
    "ORIGIN_NOT_ALLOWED",
    "This app is not yet authorised to connect Bitcoin sources. Nothing was sent. Please contact support.",
  ],
  [
    "INTERNAL",
    "The connection service could not start this session. Nothing was sent. Please try again shortly.",
  ],
]);

/** One generic line for any unrecognised or missing error code. */
export const STEALTH_ERROR_FALLBACK = "Could not connect this Bitcoin source. Please try again.";

/**
 * Map an inbound OR_STEALTH_ERROR to fixed local copy.
 *
 * The return value is plain text for a React text node: it is never HTML or
 * markdown, and it is never the widget's own string. An unknown or missing
 * code yields the generic fallback.
 */
export function stealthErrorMessage(message: StealthInboundMessage): string {
  const code = typeof message.code === "string" ? message.code : "";
  const copy = STEALTH_ERROR_COPY.get(code);
  // The type check is belt and braces on top of the Map: whatever the widget
  // sends, this function returns a string.
  return typeof copy === "string" ? copy : STEALTH_ERROR_FALLBACK;
}
