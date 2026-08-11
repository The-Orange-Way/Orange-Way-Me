/**
 * Stealth Sync, wire protocol constants.
 *
 * Orange Way is the platform. It launches the OR Connect stealth widget in a
 * popup, hands it a key derived on our side, and proxies the widget's network
 * calls so the widget never talks to a backend directly. postMessage is the
 * only channel between this app and the widget, and the widget's origin server
 * cannot see what flows over it.
 *
 * This module holds ONLY the constants that pin that contract. It carries no
 * key material, no HKDF, no vault access, and no UI. Keeping the names in one
 * place means every transport file references one source of truth rather than
 * repeating string literals that can drift apart.
 *
 * Every value here is verified against the canonical widget contract.
 */

/** Protocol version both sides must agree on. A mismatch is rejected, not coerced. */
export const STEALTH_PROTOCOL_VERSION = 1 as const;

/**
 * Every message type on the wire.
 *
 * INIT is the only message we send that carries setup data. PROXY_RESPONSE is
 * our reply to a widget PROXY_REQUEST. The rest are inbound: READY, PROGRESS,
 * the four completion messages, plus ERROR.
 */
export const STEALTH_MESSAGE = {
  // Platform to widget.
  INIT: 'OR_STEALTH_INIT',
  PROXY_RESPONSE: 'OR_STEALTH_PROXY_RESPONSE',
  // Widget to platform.
  READY: 'OR_STEALTH_READY',
  PROGRESS: 'OR_STEALTH_PROGRESS',
  PROXY_REQUEST: 'OR_STEALTH_PROXY_REQUEST',
  // Completions (five, not four): the widget ends every flow with one of these.
  ADD_COMPLETE: 'OR_STEALTH_ADD_COMPLETE',
  SYNC_COMPLETE: 'OR_STEALTH_SYNC_COMPLETE',
  LIST_RESULT: 'OR_STEALTH_LIST_RESULT',
  DELETE_COMPLETE: 'OR_STEALTH_DELETE_COMPLETE',
  ERROR: 'OR_STEALTH_ERROR',
} as const;

export type StealthMessageType =
  (typeof STEALTH_MESSAGE)[keyof typeof STEALTH_MESSAGE];

/**
 * The complete set of edge function slugs the widget dispatches through a
 * PROXY_REQUEST. The platform makes the same-origin call for the slug and
 * returns the result in a PROXY_RESPONSE. A request naming any other slug is
 * refused, never forwarded.
 */
export const STEALTH_PROXY_FN = {
  CONNECTION_CREATE: 'or-stealth-connection-create',
  ENVELOPE_FETCH: 'or-stealth-envelope-fetch',
  TRANSACTIONS_STORE: 'or-stealth-transactions-store',
  ENVELOPE_UPDATE: 'or-stealth-envelope-update',
} as const;

export type StealthProxyFn =
  (typeof STEALTH_PROXY_FN)[keyof typeof STEALTH_PROXY_FN];

/** The allowed proxy fn slugs as a Set, for a cheap membership check on inbound requests. */
export const STEALTH_PROXY_FN_ALLOWED: ReadonlySet<StealthProxyFn> = new Set(
  Object.values(STEALTH_PROXY_FN),
);
