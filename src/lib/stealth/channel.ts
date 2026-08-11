/**
 * Stealth Sync, guarded postMessage transport.
 *
 * Orange Way launches the OR Connect widget in a popup and talks to it over
 * postMessage only. That channel is the entire trust boundary: the widget's
 * origin server cannot see what flows over it, but any frame loaded on this
 * page can post to `window`. So every inbound event is proven before a single
 * field is read, and every outbound post names the exact widget origin so it
 * can never be delivered to another frame.
 *
 * This module is transport only. It carries no key material, no HKDF, no vault
 * access, and no proxy dispatch. It validates inbound events, routes the valid
 * ones to a handler, and sends the two outbound message types. The proxy
 * dispatcher for the four fn slugs is a separate module.
 */

import {
  STEALTH_MESSAGE,
  STEALTH_PROTOCOL_VERSION,
  type StealthMessageType,
} from './protocol';

/** Types the widget sends to the platform. Anything else inbound is dropped. */
const INBOUND_TYPES: ReadonlySet<string> = new Set<StealthMessageType>([
  STEALTH_MESSAGE.READY,
  STEALTH_MESSAGE.PROGRESS,
  STEALTH_MESSAGE.PROXY_REQUEST,
  STEALTH_MESSAGE.ADD_COMPLETE,
  STEALTH_MESSAGE.SYNC_COMPLETE,
  STEALTH_MESSAGE.LIST_RESULT,
  STEALTH_MESSAGE.DELETE_COMPLETE,
  STEALTH_MESSAGE.ERROR,
]);

/** A validated inbound message. Fields beyond these are passed through untouched. */
export interface StealthInboundMessage {
  type: StealthMessageType;
  version: typeof STEALTH_PROTOCOL_VERSION;
  request_id?: string;
  [key: string]: unknown;
}

export type StealthInboundHandler = (message: StealthInboundMessage) => void;

/**
 * The allowed widget origin, read once from config. A build with no value here
 * makes the transport throw at construction rather than run permissively.
 */
const CONFIGURED_ORIGIN = import.meta.env.VITE_OR_ALLOWED_ORIGIN as
  | string
  | undefined;

export class StealthChannel {
  private readonly allowedOrigin: string;
  private popup: Window | null = null;
  private handler: StealthInboundHandler | null = null;
  private listening = false;
  private readonly inFlight = new Set<string>();

  constructor(allowedOrigin: string | undefined = CONFIGURED_ORIGIN) {
    if (!allowedOrigin) {
      throw new Error(
        'Stealth transport requires VITE_OR_ALLOWED_ORIGIN. Refusing to start without an exact allowed origin.',
      );
    }
    this.allowedOrigin = allowedOrigin;
  }

  /** Begin listening for messages from `popup`, routing valid ones to `handler`. */
  start(popup: Window, handler: StealthInboundHandler): void {
    if (this.listening) return;
    this.popup = popup;
    this.handler = handler;
    window.addEventListener('message', this.onMessage);
    this.listening = true;
  }

  /** Stop listening and drop all state, so the transport never outlives the popup. */
  stop(): void {
    if (!this.listening) return;
    window.removeEventListener('message', this.onMessage);
    this.listening = false;
    this.popup = null;
    this.handler = null;
    this.inFlight.clear();
  }

  /** Send OR_STEALTH_INIT to the widget. The caller owns the payload; this adds no keys. */
  sendInit(payload: Record<string, unknown>): void {
    this.post({
      type: STEALTH_MESSAGE.INIT,
      version: STEALTH_PROTOCOL_VERSION,
      ...payload,
    });
  }

  /**
   * Answer a proxy request. Only ever sends for a request_id currently held.
   * An id we are not holding is dropped and never answered.
   */
  respondToProxy(requestId: string, payload: Record<string, unknown>): void {
    if (!this.inFlight.has(requestId)) return;
    this.inFlight.delete(requestId);
    this.post({
      type: STEALTH_MESSAGE.PROXY_RESPONSE,
      version: STEALTH_PROTOCOL_VERSION,
      request_id: requestId,
      ...payload,
    });
  }

  private post(message: Record<string, unknown>): void {
    if (this.popup === null) return;
    // Exact origin, never '*', not even in a test.
    this.popup.postMessage(message, this.allowedOrigin);
  }

  private readonly onMessage = (event: MessageEvent): void => {
    // 1. Origin, exact, before anything else in the event is read.
    if (event.origin !== this.allowedOrigin) return;
    // 2. Source must be the popup we opened. Origin alone is not enough.
    if (this.popup === null || event.source !== this.popup) return;

    const data = event.data;
    if (data === null || typeof data !== 'object') return;

    // 3. Version, exact, never coerced.
    if ((data as { version?: unknown }).version !== STEALTH_PROTOCOL_VERSION) {
      return;
    }

    // 4. Type must be a known inbound type. Unknown is dropped, not thrown.
    const type = (data as { type?: unknown }).type;
    if (typeof type !== 'string' || !INBOUND_TYPES.has(type)) return;

    // 5. Record the id of a proxy request so a later response can be matched.
    if (type === STEALTH_MESSAGE.PROXY_REQUEST) {
      const requestId = (data as { request_id?: unknown }).request_id;
      if (typeof requestId !== 'string') return;
      this.inFlight.add(requestId);
    }

    this.handler?.(data as StealthInboundMessage);
  };
}
