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
 * Fixed, local, user-facing copy for a widget ERROR, keyed by its `code`.
 *
 * `code` arrives from another origin over postMessage and is UNTRUSTED, so we
 * never surface the widget's own strings. We look the code up here and fall
 * back to one generic line for anything not listed. The set is intentionally
 * empty until the canonical widget error-code contract is confirmed; adding a
 * code here is the only way a specific message ever reaches the user.
 */
export const STEALTH_ERROR_COPY: Readonly<Record<string, string>> = {};

/** One generic line for any unrecognised or missing error code. */
export const STEALTH_ERROR_FALLBACK =
  "Could not connect this Bitcoin source. Please try again.";

/**
 * Map an inbound OR_STEALTH_ERROR to fixed local copy.
 *
 * The return value is plain text for a React text node: it is never HTML or
 * markdown, and it is never the widget's own string. An unknown or missing
 * code yields the generic fallback.
 */
export function stealthErrorMessage(message: StealthInboundMessage): string {
  const code = typeof message.code === "string" ? message.code : "";
  return STEALTH_ERROR_COPY[code] ?? STEALTH_ERROR_FALLBACK;
}
