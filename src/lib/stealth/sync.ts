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
 *
 * THE FIELD NAMES BELOW WERE WRONG, and this is worth reading before touching
 * them. The four legacy counters were written from an assumed contract and no
 * frame has ever carried them. Recorded from a real scan on deployed dev,
 * listening on the parent window for every inbound message:
 *
 *     OR_STEALTH_PROGRESS       keys: type, stage, percent, message, detail
 *     OR_STEALTH_SYNC_COMPLETE  keys: type, connection_id, sealed_transactions,
 *                                     last_block_scanned, tx_count,
 *                                     bytes_downloaded, duration_seconds,
 *                                     address_window_exhausted,
 *                                     cursor_update_failed
 *
 * Sixteen PROGRESS frames arrived in a ten-second repeat sync, and this module
 * turned every one of them into an object whose four properties were all
 * undefined. The completion path was checked against the real contract when it
 * was written and is correct; the progress path never was. The file header
 * says a silent drift in one field name is the failure mode this whole ticket
 * was, and it drifted anyway, because the unit test asserted the same invented
 * names the code read.
 *
 * The legacy counters are kept, not deleted. They cost nothing, and if the
 * widget ever does send a block count this starts reporting it with no change
 * here. What must not happen again is a name being added from a type
 * definition rather than from an observed frame.
 */
export interface StealthSyncProgress {
  /** Coarse phase, e.g. the widget's own stage identifier. Free-form. */
  stage?: string;
  /** 0 to 100 when the widget knows, absent when it does not. */
  percent?: number;
  /** The widget's own sentence. Displayed as-is; never rewritten. */
  message?: string;
  /** The widget's own second line, e.g. counts and a rate. */
  detail?: string;
  /** Legacy counters. Never observed on the wire. See the block above. */
  scanned_blocks?: number;
  total_blocks?: number;
  current_height?: number;
  found_transactions?: number;
}

export interface StealthSyncOutcome {
  /**
   * Transactions this run matched, read from the widget's `tx_count`.
   *
   * The field name is `tx_count` on the wire and nothing else: the widget's
   * SYNC_COMPLETE has no `stored_transactions`. Reading a name the widget does
   * not send yields undefined forever, which reads as "the widget did not say"
   * and quietly hides every count. Verified against the canonical contract.
   */
  txCount?: number;
  /** Height the widget scanned to, written back as `last_block_scanned`. */
  lastBlockScanned?: number;
  /**
   * The widget could not persist its cursor. The scan itself was fine, but the
   * next one rescans from the stored value. Surfaced rather than swallowed:
   * a user who sees "scan finished" and then a full rescan deserves to know
   * why.
   */
  cursorUpdateFailed?: boolean;
  /**
   * Matches landed at the edge of the derived address window, so history may
   * be incomplete. The widget says so in its own UI; we carry it too because
   * the popup closes and this app is what the user is left looking at.
   */
  addressWindowExhausted?: boolean;
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

/** What the connection row should show while a stealth scan is running. */
export interface StealthProgressLine {
  /** One short sentence. Always present, so the row is never blank. */
  headline: string;
  /** The widget's second line, when it sent one. */
  detail?: string;
  /** 0 to 100 for a bar, or undefined for an indeterminate spinner. */
  percent?: number;
}

/**
 * Turn a progress frame into the line the connection row shows.
 *
 * Pure and exported so both the "widget told us something" and the "widget has
 * told us nothing yet" branches are testable without a browser.
 *
 * WHY THIS EXISTS AT ALL. The row used to render the single word "Syncing" for
 * the entire scan. A first sync downloads tens of thousands of filter files and
 * takes minutes; every later one takes seconds. All the reassuring detail was
 * inside a popup, so a user watching the app saw a spinner that never moved,
 * and the honest conclusion from that is "this is broken". That is how
 * DL-1111 came to be filed as "Sync does nothing" when the scan was running
 * perfectly the whole time.
 *
 * The widget's own words are passed through unedited. We do not have a better
 * description of what it is doing than it does, and paraphrasing a live
 * progress string is how a UI ends up claiming a stage that already finished.
 */
export function describeStealthProgress(
  progress?: StealthSyncProgress | null,
): StealthProgressLine {
  // Nothing has arrived yet. Say the two things the user cannot see for
  // themselves: where the work is happening, and that slow is expected here.
  if (!progress) {
    return { headline: "Scanning. The first scan for a wallet can take a few minutes." };
  }

  const headline =
    progress.message ??
    // No sentence, but a stage name is still better than silence.
    (progress.stage ? `Scanning: ${progress.stage}` : "Scanning.");

  return {
    headline,
    detail: progress.detail,
    percent: progress.percent,
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
            // The four the widget actually sends.
            stage: stringOrUndefined(message.stage),
            percent: percentOrUndefined(message.percent),
            message: stringOrUndefined(message.message),
            detail: stringOrUndefined(message.detail),
            // The four it does not, kept so a future frame is not dropped.
            scanned_blocks: numberOrUndefined(message.scanned_blocks),
            total_blocks: numberOrUndefined(message.total_blocks),
            current_height: numberOrUndefined(message.current_height),
            found_transactions: numberOrUndefined(message.found_transactions),
          });
          break;
        case STEALTH_MESSAGE.SYNC_COMPLETE:
          args.onComplete?.({
            txCount: numberOrUndefined(message.tx_count),
            lastBlockScanned: numberOrUndefined(message.last_block_scanned),
            cursorUpdateFailed: message.cursor_update_failed === true,
            addressWindowExhausted: message.address_window_exhausted === true,
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

/**
 * A percentage, or undefined.
 *
 * Clamped rather than trusted. This number drives a progress bar's width, and
 * a widget that sends 140 or -3 during a retry would otherwise paint a bar
 * outside its own track. Out-of-range is treated as a real reading that needs
 * bounding, not as a malformed frame, because the scan is plainly alive either
 * way and hiding the bar would be the worse answer.
 */
function percentOrUndefined(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.min(100, Math.max(0, value));
}
