/**
 * Stealth Sync, re-running a scan for a connection that already exists.
 *
 * "Re-running", not "resuming". Whether a second scan continues from where the
 * last one stopped is decided upstream, in the widget and in its own store, and
 * this app cannot observe it. See `describeStealthFailure` before writing the
 * word resume anywhere in this file.
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

/**
 * A failure the widget reported, as the widget described it.
 *
 * DL-1117. The widget has always sent three fields on OR_STEALTH_ERROR and
 * this app read one of them. `code` and `retryable` were parsed away, so no
 * error the widget raised could ever be told apart from any other, and the
 * only honest thing the UI could offer was a sentence and a dead end. That is
 * also the whole of DL-1025: the missing retry button is missing because its
 * input was being discarded here, not because nobody drew it.
 */
export interface StealthSyncFailure {
  /** The widget's own sentence. Displayed as-is; never rewritten. */
  message: string;
  /**
   * The widget's machine-readable cause, when it sent one we can read.
   *
   * Carried for support and logging, NOT for deciding retryability. See
   * `describeStealthFailure` for why those are different questions.
   */
  code?: string;
  /**
   * The widget's own verdict on whether trying again could help.
   *
   * Optional because this crosses an origin boundary: a frame that omits it,
   * or sends a non-boolean, must read as "the widget did not say" rather than
   * as a false we invented.
   */
  retryable?: boolean;
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
/**
 * Should a connection row show a scan-progress line?
 *
 * DL-1047 / #313. This exists because the row used to decide with
 * `syncing && conn.is_stealth`, and that is not the same question. A private
 * row can be synced by the generic server-side path, which does no scanning
 * at all: while the stealth entry is off, or if the stealth path throws before
 * the widget starts, `syncing` is true and the row is private, so the old gate
 * opened and `describeStealthProgress(null)` filled it with its "nothing has
 * arrived yet" default. Measured on production 2026-08-18: the row read
 * "Scanning. The first scan for a wallet can take a few minutes." for a
 * request that had already been rejected on the wire.
 *
 * The honest signal is not "is this row syncing" but "did the scan path
 * actually start for this row", which is what `scanActive` carries. Keep
 * `syncing` out of this function entirely: taking it as an input is how the
 * old bug would come back.
 */
export function shouldShowScanProgress(args: {
  /** True only while the in-browser stealth scan path is running for this row. */
  scanActive: boolean;
  /** True when the row is a private connection, whatever is syncing it. */
  isStealth: boolean;
}): boolean {
  return args.scanActive && args.isStealth;
}

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

/** What the UI should do about a failure the widget reported. */
export interface StealthFailureLine {
  /** The sentence to show. Always present. */
  message: string;
  /** Offer a one-press retry next to the message. */
  canRetry: boolean;
  /**
   * A second sentence about what pressing retry actually costs, when we have a
   * positive reason to think it is not cheap. Absent when we have no such
   * reason: see `describeStealthFailure` for why silence is the honest default
   * rather than a reassurance.
   */
  retryNote?: string;
}

/**
 * What this app has actually observed about the scan position for one
 * connection. DL-1171.
 *
 * Every field is optional and undefined means "we have not seen it", never
 * false. This whole type exists to stop the UI reasoning from an assumption:
 * the app is a different origin from the thing that owns the cursor, and the
 * only facts it has are the ones a SYNC_COMPLETE frame handed it during this
 * page's lifetime.
 */
export interface StealthCursorKnowledge {
  /**
   * A scan for this connection completed while this page was open AND reported
   * a `last_block_scanned`. That is the strongest thing we can honestly say,
   * and note what it is not: it is the widget telling us a height, not proof
   * that the height was persisted anywhere.
   */
  completedScanReportedHeight?: boolean;
  /**
   * The last completed scan set `cursor_update_failed`. The widget is telling
   * us in as many words that its position was not saved.
   */
  cursorUpdateFailed?: boolean;
}

/**
 * Decide what a reported failure lets the UI offer.
 *
 * WHY THIS READS `retryable` AND NOT `code`. This is the part to read twice,
 * because deciding from the code is the obvious-looking version and it is
 * wrong. Checked against the deployed widget bundle rather than against the
 * captured type contract, which is known to be stale in other places:
 *
 *   INTERNAL              emitted with retryable TRUE at one site and FALSE at
 *                         another, in the same chunk
 *   NETWORK               true
 *   DELIVERY_ACK_MISSING  true
 *   WINDOW_EXHAUSTED      false
 *   every INIT validation false
 *
 * One code, both verdicts. So no lookup table keyed on `code` can be right,
 * and any table we shipped would drift the first time the widget changed its
 * mind about a case we had hard-coded. The widget is the only thing that knows
 * whether its own failure is transient; this asks it and believes the answer.
 *
 * WHY UNKNOWN MEANS NO BUTTON. When the field is absent or is not a boolean we
 * do not offer the retry. That is the safe direction and it is not a hardship:
 * the row's own Sync button is still right there, so withholding the shortcut
 * costs a user one extra click, while offering it on a permanent failure
 * invites them to press it forever on something that can never succeed.
 *
 * WHAT `retryNote` IS FOR, and why it is usually absent. DL-1171.
 *
 * This app used to state, in a comment right above the retry button, that
 * retrying was safe because "a scan is resumable by design, the widget reads
 * its own cursor back and picks up from last_block_scanned". We cannot see any
 * of that. The cursor lives upstream, and a first scan for a wallet covers a
 * range of roughly a hundred thousand requests, so the difference between
 * continuing and starting over is minutes of someone's evening, not a detail.
 *
 * So the rule for this function: never promise a resume, and never promise a
 * restart either. Speak only when there is a positive, observed reason to
 * think the press is expensive:
 *
 *   cursorUpdateFailed          the widget SAID it could not save its position.
 *                               Not a guess. Say it plainly.
 *   no completed scan observed  we have watched nothing finish for this
 *                               connection, so we have no evidence a saved
 *                               position exists. Say "may", because it may.
 *
 * When a scan did complete and reported a height, this returns no note at all.
 * That is deliberate and it is the case people will want to change. Saying
 * "this will pick up where it left off" there would be inventing the upstream
 * behaviour again, one comment further down the file. Silence costs the user
 * nothing; a false reassurance costs them the thing this ticket is about.
 */
export function describeStealthFailure(
  failure: StealthSyncFailure,
  knowledge?: StealthCursorKnowledge,
): StealthFailureLine {
  const canRetry = failure.retryable === true;
  return {
    message: failure.message,
    canRetry,
    // No button, no note. A caveat about a press that is not on offer is noise.
    ...(canRetry ? retryNoteFor(knowledge) : {}),
  };
}

function retryNoteFor(knowledge?: StealthCursorKnowledge): { retryNote?: string } {
  if (knowledge?.cursorUpdateFailed === true) {
    return {
      retryNote:
        "The last scan could not save its position, so this one may cover ground already scanned.",
    };
  }
  if (knowledge?.completedScanReportedHeight !== true) {
    return {
      retryNote:
        "No scan for this wallet has finished yet, so this may start from the beginning and take several minutes.",
    };
  }
  return {};
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
  /**
   * Called with the widget's own account of a failure.
   *
   * DL-1117 changed this from a bare string. The string was everything the
   * caller could know, so every failure looked identical to every other one
   * and no caller could offer a retry even when the widget had just said the
   * failure was transient.
   */
  onError?: (failure: StealthSyncFailure) => void;
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
          //
          // DL-1117. `code` and `retryable` are read here rather than thrown
          // away. Both are treated as untrusted: a code that is not a string
          // and a retryable that is not a boolean both arrive as undefined,
          // which reads as "the widget did not say" and never as a value we
          // decided on its behalf.
          args.onError?.({
            message: stringOrUndefined(message.message) ?? "The connect widget reported an error.",
            code: stringOrUndefined(message.code),
            retryable: booleanOrUndefined(message.retryable),
          });
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
 * Read a boolean off an untrusted frame, or undefined.
 *
 * Deliberately not `Boolean(value)`. This flag decides whether the UI invites
 * the user to try again, and coercing the string "false", or 0, or a missing
 * field into a definite answer would be inventing the widget's verdict. Only
 * an actual boolean counts as the widget having said anything.
 */
function booleanOrUndefined(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
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
