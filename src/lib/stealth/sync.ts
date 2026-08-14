/**
 * Stealth Sync, resuming a scan for a connection that already exists.
 *
 * A stealth connection is created by the add flow and then scanned inside the
 * OR Connect widget, in the browser, during that same session. Until this
 * module existed there was no way to scan it again: `or-sync` reads the
 * `connections` table and a stealth connection is not in it, so Sync on a
 * stealth row reached a function that could never see it. The row sat at
 * "Never synced" permanently. This opens the door that was missing.
 *
 * WHAT THE WIDGET NEEDS, and why each field is here:
 *   mode: "sync"          the widget rejects a non-add INIT without one
 *   connection_id         the widget fetches the sealed envelope by id
 *   or_stealth_key_b64    the widget unseals client-side, so it must have the
 *                         key the envelope was sealed under
 *   widget_token          the widget's own auth for the edge functions it calls
 *
 * WHY `cred_key` AND NOT THE STEALTH SUBKEY. This is the part to read twice.
 *
 * We derive a purpose-built stealth subkey (`orangerails-stealth-widget-v1`,
 * see vault.ts) and it is NOT what this sends. That is deliberate and it is
 * not a shortcut.
 *
 * An envelope can only be unsealed with the key it was sealed under. Our add
 * flow hands `cred_key` to OR in the `/connect` URL fragment, and OR's inline
 * stealth step assigns that value to `or_stealth_key_b64`. So every envelope
 * that exists today is sealed under the credentials subkey. Sending any other
 * key here produces an envelope the widget cannot open, and the failure would
 * surface as unreadable data rather than as an error.
 *
 * That also means this is not a new key-material boundary crossing: it is the
 * same key, for the same connection, that already crossed at add time.
 *
 * Moving stealth envelopes onto the dedicated subkey is tracked separately and
 * is a migration with a re-seal step, not a change to this file. Do not "fix"
 * the key here: it will silently orphan every existing connection.
 */

import { OR_CONNECT_BASE, OR_PLATFORM_SLUG } from "../or/widget";
import { launchStealthConnect } from "./launch";
import { STEALTH_MESSAGE } from "./protocol";
import type { StealthChannel, StealthInboundMessage } from "./channel";

/** The widget route that scans. Distinct from `/connect`, which is the picker. */
export const STEALTH_WIDGET_PATH = "/stealth";

/**
 * Progress as the widget reports it. Every field is optional because the
 * widget owns this shape and a missing counter must not break the UI: a
 * progress frame we cannot read is still evidence the scan is alive.
 */
export interface StealthSyncProgress {
  scanned_blocks?: number;
  total_blocks?: number;
  current_height?: number;
  found_transactions?: number;
}

export interface StealthSyncOutcome {
  /** Transactions the widget stored this run. Absent when the widget did not say. */
  storedTransactions?: number;
  /** Height the widget scanned to, written back as `last_block_scanned`. */
  lastBlockScanned?: number;
}

/**
 * Build the stealth widget URL.
 *
 * No key and no token go in the URL. Both travel over postMessage instead,
 * which keeps them out of the address bar, out of history, and out of any
 * referrer. The add flow uses the fragment because it hands off by navigation
 * and has no channel yet; here we own a channel before anything sensitive
 * moves, so there is no reason to put a key in a URL.
 */
export function buildStealthWidgetUrl(base: string = OR_CONNECT_BASE): string {
  return `${base.replace(/\/+$/, "")}${STEALTH_WIDGET_PATH}`;
}

/**
 * Build the INIT fields this module owns.
 *
 * Exported for tests: the exact payload is the contract with the widget, and a
 * silent drift in one field name is the failure mode this whole ticket was.
 * `return_callback_origin` and `protocol_version` are deliberately absent, and
 * must stay absent: launchStealthConnect and StealthChannel.sendInit apply
 * those last so a caller cannot redirect the widget's callbacks or claim a
 * protocol version we do not speak.
 */
export function buildStealthSyncInit(args: {
  connectionId: string;
  appUserId: string;
  credKeyB64: string;
  widgetToken: string;
  appSlug?: string;
}): Record<string, unknown> {
  return {
    app_slug: args.appSlug ?? OR_PLATFORM_SLUG,
    app_user_id: args.appUserId,
    mode: "sync",
    connection_id: args.connectionId,
    or_stealth_key_b64: args.credKeyB64,
    widget_token: args.widgetToken,
  };
}

export interface StealthSyncHandle {
  /** The live transport. The caller stops it when the flow ends. */
  channel: StealthChannel;
}

/**
 * Open the widget on its sync route for an existing connection.
 *
 * Resolves once INIT is on the wire, which means the scan has been asked for,
 * NOT that it finished. Completion arrives through `onComplete`, failure
 * through `onError`. A caller that treats this resolving as success would be
 * reporting a scan it never saw, which is the exact class of bug this ticket
 * is full of.
 *
 * Rejects visibly when the popup is blocked, when the widget never posts
 * READY inside the guard, or when the user closes it before it loads.
 */
export async function startStealthSync(args: {
  connectionId: string;
  appUserId: string;
  credKeyB64: string;
  widgetToken: string;
  onProgress?: (progress: StealthSyncProgress) => void;
  onComplete?: (outcome: StealthSyncOutcome) => void;
  /** Called with the widget's own message when it reports a failure. */
  onError?: (message: string) => void;
  /** Injectable for tests. */
  launch?: typeof launchStealthConnect;
  baseUrl?: string;
}): Promise<StealthSyncHandle> {
  const launch = args.launch ?? launchStealthConnect;

  const { channel } = await launch({
    url: buildStealthWidgetUrl(args.baseUrl),
    init: buildStealthSyncInit({
      connectionId: args.connectionId,
      appUserId: args.appUserId,
      credKeyB64: args.credKeyB64,
      widgetToken: args.widgetToken,
    }),
    onMessage: (message: StealthInboundMessage) => {
      switch (message.type) {
        case STEALTH_MESSAGE.PROGRESS:
          args.onProgress?.({
            scanned_blocks: numberOrUndefined(message.scanned_blocks),
            total_blocks: numberOrUndefined(message.total_blocks),
            current_height: numberOrUndefined(message.current_height),
            found_transactions: numberOrUndefined(message.found_transactions),
          });
          break;
        case STEALTH_MESSAGE.SYNC_COMPLETE:
          args.onComplete?.({
            storedTransactions: numberOrUndefined(message.stored_transactions),
            lastBlockScanned: numberOrUndefined(message.last_block_scanned),
          });
          break;
        case STEALTH_MESSAGE.ERROR:
          // The widget's own text, never a string we invent. An error we
          // cannot read still has to say something, so it says so plainly
          // rather than claiming a cause.
          args.onError?.(
            stringOrUndefined(message.message) ?? "The connect widget reported an error.",
          );
          break;
        default:
          break;
      }
    },
  });

  return { channel };
}

/**
 * Read a number off an untrusted frame, or undefined.
 *
 * The widget is another origin. A counter arriving as a string, a NaN or an
 * object is treated as absent rather than coerced, so a malformed frame shows
 * up as a missing number and never as a wrong one.
 */
function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
