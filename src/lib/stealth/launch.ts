/**
 * Stealth Sync, launch and opening handshake.
 *
 * The transport (StealthChannel) validates and routes messages but does not
 * open the popup or drive the opening handshake. This module does exactly
 * that and nothing more: it opens the OR Connect stealth widget, waits for the
 * widget's READY, then sends OR_STEALTH_INIT carrying the one field the widget
 * needs to address its callbacks, return_callback_origin. It resolves once
 * that INIT is on the wire, handing the live channel to the caller.
 *
 * It carries NO key material, NO HKDF, and NO proxy dispatch. The INIT payload
 * here is the origin only. Key derivation and the proxy dispatcher are separate
 * modules layered on top of the channel this returns.
 *
 * Failing visibly is the whole point of the hang guard. A widget that never
 * posts READY (popup wedged, popup blank on a bad build, or the user closing
 * it before it loads) must reject the returned promise rather than leave a
 * launch spinning forever with no feedback.
 */

import { StealthChannel, type StealthInboundHandler, type StealthInboundMessage } from "./channel";
import { STEALTH_MESSAGE } from "./protocol";

/**
 * How long to wait for the widget's READY before giving up (ms). The widget
 * only has to load its own page and post one message, so this is a load-time
 * bound, not a whole-session bound: a session that gets past READY is governed
 * by the launch UI's own session timeout, not by this guard.
 */
export const STEALTH_READY_TIMEOUT_MS = 30000;

export interface StealthLaunchResult {
  /** The live transport, already past INIT. The caller attaches later handling. */
  channel: StealthChannel;
}

/**
 * Open the OR Connect stealth widget and complete the opening handshake.
 *
 * Resolves with the live channel once OR_STEALTH_INIT has been sent in
 * response to the widget's READY. Rejects, visibly, if the popup is blocked,
 * if READY never arrives within the guard, or if the popup is closed before
 * it becomes ready.
 */
export async function launchStealthConnect(args: {
  /** The widget URL to open. Built by the caller; this module adds no keys. */
  url: string;
  /** Optional handler for messages after READY (PROGRESS, completions, ERROR). */
  onMessage?: StealthInboundHandler;
  /** Injectable for tests; defaults to a fresh channel bound to the configured origin. */
  channel?: StealthChannel;
  /** Override the READY guard; defaults to STEALTH_READY_TIMEOUT_MS. */
  readyTimeoutMs?: number;
}): Promise<StealthLaunchResult> {
  const popup = window.open(args.url, "or-stealth-connect", "width=720,height=900,popup=yes");
  if (!popup) {
    throw new Error("Popup blocked, allow popups for this site to connect a wallet");
  }
  const popupRef = popup;
  const channel = args.channel ?? new StealthChannel();
  const timeoutMs = args.readyTimeoutMs ?? STEALTH_READY_TIMEOUT_MS;

  return new Promise<StealthLaunchResult>((resolve, reject) => {
    let ready = false;
    let settled = false;

    function clearTimers(): void {
      window.clearTimeout(readyGuard);
      window.clearInterval(poll);
    }

    // A failure before READY tears everything down: stop the transport so its
    // message listener does not outlive the launch, and close the popup so the
    // failure is visible rather than a silent blank window.
    function failVisibly(err: Error): void {
      if (settled) return;
      settled = true;
      clearTimers();
      try {
        channel.stop();
      } catch {
        /* never started */
      }
      try {
        popupRef.close();
      } catch {
        /* already closed */
      }
      reject(err);
    }

    const readyGuard = window.setTimeout(() => {
      failVisibly(new Error("Connect widget never became ready, no READY received"));
    }, timeoutMs);

    // A popup the user closes before READY must reject, not hang. After READY
    // the poll is cleared and the popup's lifecycle belongs to the caller.
    const poll = window.setInterval(() => {
      if (popupRef.closed && !ready && !settled) {
        failVisibly(new Error("Widget closed before it became ready"));
      }
    }, 500);

    const handler: StealthInboundHandler = (message: StealthInboundMessage) => {
      if (!ready && message.type === STEALTH_MESSAGE.READY) {
        ready = true;
        settled = true;
        clearTimers();
        // Send the one field this slice supplies: the origin the widget must
        // address its callbacks to. No keys here by design.
        channel.sendInit({ return_callback_origin: window.location.origin });
        resolve({ channel });
      }
      args.onMessage?.(message);
    };

    try {
      channel.start(popupRef, handler);
    } catch (err) {
      failVisibly(err instanceof Error ? err : new Error(String(err)));
    }
  });
}
