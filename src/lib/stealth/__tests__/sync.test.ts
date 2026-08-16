/**
 * Stealth Sync resume, contract tests.
 *
 * The INIT payload IS the contract with the widget. A field renamed or dropped
 * on our side surfaces as a widget that refuses the handshake, or worse, as a
 * scan that runs against the wrong key and writes data nobody can read. So the
 * payload is asserted field by field rather than by shape, and the fields the
 * transport owns are asserted ABSENT here.
 */

import { describe, it, expect, vi } from "vitest";
import {
  buildStealthWidgetUrl,
  buildStealthSyncInit,
  startStealthSync,
  describeStealthProgress,
  describeStealthFailure,
  STEALTH_WIDGET_PATH,
  type StealthCursorKnowledge,
} from "../sync";
import { STEALTH_MESSAGE } from "../protocol";
import type { StealthInboundMessage, StealthChannel } from "../channel";

const ARGS = {
  connectionId: "conn-123",
  appUserId: "user-abc",
  credKeyB64: "a".repeat(44),
  widgetToken: "widget-tok",
};

type LaunchFn = NonNullable<Parameters<typeof startStealthSync>[0]["launch"]>;
type LaunchArgs = Parameters<LaunchFn>[0];

/** A launch double that captures its args and hands back the message handler. */
function makeLaunch() {
  const captured: { url?: string; init?: Record<string, unknown> } = {};
  let onMessage: ((m: StealthInboundMessage) => void) | undefined;
  const stop = vi.fn();
  const launch: LaunchFn = vi.fn(async (a: LaunchArgs) => {
    captured.url = a.url;
    captured.init = a.init;
    onMessage = a.onMessage;
    return { channel: { stop } as unknown as StealthChannel };
  });
  return { launch, captured, emit: (m: StealthInboundMessage) => onMessage?.(m), stop };
}

describe("buildStealthWidgetUrl", () => {
  it("appends the stealth route to the connect base", () => {
    expect(buildStealthWidgetUrl("https://connect.example.com/connect")).toBe(
      "https://connect.example.com/connect/stealth",
    );
  });

  it("does not double the slash when the base already ends in one", () => {
    expect(buildStealthWidgetUrl("https://connect.example.com/connect/")).toBe(
      "https://connect.example.com/connect/stealth",
    );
  });

  it("uses the documented route constant, so a rename cannot pass silently", () => {
    expect(STEALTH_WIDGET_PATH).toBe("/stealth");
  });
});

describe("buildStealthSyncInit", () => {
  it("carries every field the widget requires for a non-add mode", () => {
    const init = buildStealthSyncInit({ ...ARGS, appSlug: "orangeway-me" });
    expect(init).toEqual({
      app_slug: "orangeway-me",
      app_user_id: "user-abc",
      mode: "sync",
      connection_id: "conn-123",
      or_stealth_key_b64: "a".repeat(44),
      widget_token: "widget-tok",
    });
  });

  it("sends mode 'sync', never 'add'", () => {
    // The module this replaces hardcoded "add" and so could not express a
    // resume at all. That is the defect; pin it.
    expect(buildStealthSyncInit(ARGS).mode).toBe("sync");
  });

  it("includes connection_id, which the widget requires for every non-add mode", () => {
    expect(buildStealthSyncInit(ARGS).connection_id).toBe("conn-123");
  });

  it("omits return_callback_origin and protocol_version, which the transport owns", () => {
    // If these ever appear here, a caller could point the widget's callbacks at
    // another origin or claim a protocol version we do not speak. The transport
    // applies both last precisely so this module cannot.
    const init = buildStealthSyncInit(ARGS);
    expect(init).not.toHaveProperty("return_callback_origin");
    expect(init).not.toHaveProperty("protocol_version");
  });
});

describe("startStealthSync", () => {
  it("opens the stealth route and sends the sync INIT", async () => {
    const { launch, captured } = makeLaunch();
    await startStealthSync({ ...ARGS, launch, baseUrl: "https://c.example/connect" });

    expect(captured.url).toBe("https://c.example/connect/stealth");
    expect(captured.init).toMatchObject({ mode: "sync", connection_id: "conn-123" });
  });

  it("puts no key and no token in the URL", async () => {
    const { launch, captured } = makeLaunch();
    await startStealthSync({ ...ARGS, launch, baseUrl: "https://c.example/connect" });

    // A key in a URL lands in history and in any referrer. Both travel over
    // postMessage instead, so neither may appear in the address we open.
    expect(captured.url).not.toContain(ARGS.credKeyB64);
    expect(captured.url).not.toContain(ARGS.widgetToken);
  });

  /**
   * DL-1111. This test used to emit `scanned_blocks` / `total_blocks` and
   * assert they came back, and it passed for as long as the feature was
   * broken. Those two names were never on the wire. The frame recorded from a
   * real scan on deployed dev carries exactly:
   *
   *     type, stage, percent, message, detail
   *
   * so the old test was asserting that the parser could echo back a field the
   * widget has never sent, which every parser can. The lesson is worth keeping
   * next to the fix: a contract test written from an assumed contract tests
   * nothing at all. The payload below is the observed shape.
   */
  it("reports progress using the fields the widget actually sends", async () => {
    const { launch, emit } = makeLaunch();
    const onProgress = vi.fn();
    await startStealthSync({ ...ARGS, launch, onProgress });

    emit({
      type: STEALTH_MESSAGE.PROGRESS,
      stage: "filters",
      percent: 16,
      message: "Downloading public filter files",
      detail: "8,147 of 52,487 read, 224 files/sec, about 3 min left",
    });

    expect(onProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: "filters",
        percent: 16,
        message: "Downloading public filter files",
        detail: "8,147 of 52,487 read, 224 files/sec, about 3 min left",
      }),
    );
  });

  it("still carries the legacy counters if a frame ever sends them", async () => {
    const { launch, emit } = makeLaunch();
    const onProgress = vi.fn();
    await startStealthSync({ ...ARGS, launch, onProgress });

    // Kept deliberately: the counters are unobserved, not disproven, and
    // dropping them would silently discard a future widget's richer frame.
    emit({ type: STEALTH_MESSAGE.PROGRESS, scanned_blocks: 10, total_blocks: 100 });
    expect(onProgress).toHaveBeenCalledWith(
      expect.objectContaining({ scanned_blocks: 10, total_blocks: 100 }),
    );
  });

  it("clamps a percent outside 0 to 100 instead of dropping it", async () => {
    const { launch, emit } = makeLaunch();
    const onProgress = vi.fn();
    await startStealthSync({ ...ARGS, launch, onProgress });

    // A bar painted at 140% escapes its own track. The scan is plainly alive,
    // so bound the number rather than hiding the progress line.
    emit({ type: STEALTH_MESSAGE.PROGRESS, percent: 140 });
    expect(onProgress).toHaveBeenLastCalledWith(expect.objectContaining({ percent: 100 }));

    emit({ type: STEALTH_MESSAGE.PROGRESS, percent: -3 });
    expect(onProgress).toHaveBeenLastCalledWith(expect.objectContaining({ percent: 0 }));

    emit({ type: STEALTH_MESSAGE.PROGRESS, percent: Number.NaN });
    expect(onProgress).toHaveBeenLastCalledWith(expect.objectContaining({ percent: undefined }));
  });

  describe("describeStealthProgress", () => {
    it("says the first scan is slow when no frame has arrived yet", () => {
      // The gap this fills: minutes of silence before the widget's first
      // frame, during which the row otherwise reads as a dead button.
      const line = describeStealthProgress(null);
      expect(line.headline).toMatch(/first scan/i);
      expect(line.percent).toBeUndefined();
    });

    it("passes the widget's own sentence through unedited", () => {
      const line = describeStealthProgress({
        stage: "filters",
        percent: 16,
        message: "Downloading public filter files",
        detail: "8,147 of 52,487 read",
      });
      expect(line.headline).toBe("Downloading public filter files");
      expect(line.detail).toBe("8,147 of 52,487 read");
      expect(line.percent).toBe(16);
    });

    it("falls back to the stage name when the widget sent no sentence", () => {
      expect(describeStealthProgress({ stage: "matching" }).headline).toContain("matching");
    });

    it("never renders an empty line, even from an empty frame", () => {
      expect(describeStealthProgress({}).headline.length).toBeGreaterThan(0);
    });
  });

  it("reports completion with the counts the widget sent", async () => {
    const { launch, emit } = makeLaunch();
    const onComplete = vi.fn();
    await startStealthSync({ ...ARGS, launch, onComplete });

    emit({
      type: STEALTH_MESSAGE.SYNC_COMPLETE,
      tx_count: 3,
      last_block_scanned: 840000,
    });
    expect(onComplete).toHaveBeenCalledWith({
      txCount: 3,
      lastBlockScanned: 840000,
      cursorUpdateFailed: false,
      addressWindowExhausted: false,
    });
  });

  it("reads tx_count, the name the widget actually sends", async () => {
    const { launch, emit } = makeLaunch();
    const onComplete = vi.fn();
    await startStealthSync({ ...ARGS, launch, onComplete });

    // The widget's SYNC_COMPLETE has no `stored_transactions`. Reading that
    // name returned undefined on every real sync and looked exactly like a
    // widget that declined to say. Pin the real name.
    emit({ type: STEALTH_MESSAGE.SYNC_COMPLETE, stored_transactions: 7, tx_count: 2 });
    expect(onComplete).toHaveBeenCalledWith(expect.objectContaining({ txCount: 2 }));
  });

  it("passes through the widget's two honesty warnings", async () => {
    const { launch, emit } = makeLaunch();
    const onComplete = vi.fn();
    await startStealthSync({ ...ARGS, launch, onComplete });

    // A failed cursor write means the next sync rescans; an exhausted address
    // window means history may be missing. Both arrive alongside a successful
    // scan, and dropping them would turn a caveat into a clean success.
    emit({
      type: STEALTH_MESSAGE.SYNC_COMPLETE,
      tx_count: 1,
      cursor_update_failed: true,
      address_window_exhausted: true,
    });
    expect(onComplete).toHaveBeenCalledWith(
      expect.objectContaining({ cursorUpdateFailed: true, addressWindowExhausted: true }),
    );
  });

  it("treats a malformed counter as absent rather than coercing it", async () => {
    const { launch, emit } = makeLaunch();
    const onComplete = vi.fn();
    await startStealthSync({ ...ARGS, launch, onComplete });

    // The widget is another origin. "12" or NaN must read as "did not say",
    // never as a number, so the UI cannot report a count that was never sent.
    emit({
      type: STEALTH_MESSAGE.SYNC_COMPLETE,
      tx_count: "12",
      last_block_scanned: Number.NaN,
    });
    expect(onComplete).toHaveBeenCalledWith({
      txCount: undefined,
      lastBlockScanned: undefined,
      cursorUpdateFailed: false,
      addressWindowExhausted: false,
    });
  });

  /**
   * WHERE THESE PAYLOADS COME FROM, because a made-up one is not evidence and
   * that is exactly how DL-1111 stayed green while it was broken.
   *
   * No live OR_STEALTH_ERROR frame has been recorded: a sync has to fail to
   * produce one, and no failure has been provoked on dev. So these are taken
   * from the DEPLOYED widget bundle, which is the next best source and is
   * better than the captured type contract (known stale elsewhere: it has no
   * `widget_token`, which the deployed widget uses). Read out of
   * dev.orangerails.com chunk `stealth-DHQQ6zju.js`, error emission sites:
   *
   *   {type:"OR_STEALTH_ERROR", code:"NETWORK",           message, retryable:true}
   *   {type:"OR_STEALTH_ERROR", code:"WINDOW_EXHAUSTED",  message, retryable:false}
   *   {type:"OR_STEALTH_ERROR", code:"INTERNAL",          message, retryable:true}
   *   {type:"OR_STEALTH_ERROR", code:"INTERNAL",          message, retryable:false}
   *
   * The last two are the whole argument for reading `retryable` rather than
   * keying a table off `code`: one code, both verdicts, same chunk.
   */
  it("surfaces the widget's own error text, code and retryable verdict", async () => {
    const { launch, emit } = makeLaunch();
    const onError = vi.fn();
    await startStealthSync({ ...ARGS, launch, onError });

    emit({
      type: STEALTH_MESSAGE.ERROR,
      code: "NETWORK",
      message: "Could not reach the filter server.",
      retryable: true,
    });
    expect(onError).toHaveBeenCalledWith({
      message: "Could not reach the filter server.",
      code: "NETWORK",
      retryable: true,
    });
  });

  it("carries a false retryable through as false, not as absent", async () => {
    const { launch, emit } = makeLaunch();
    const onError = vi.fn();
    await startStealthSync({ ...ARGS, launch, onError });

    emit({
      type: STEALTH_MESSAGE.ERROR,
      code: "WINDOW_EXHAUSTED",
      message: "Matches reached the edge of the address window.",
      retryable: false,
    });
    expect(onError).toHaveBeenCalledWith({
      message: "Matches reached the edge of the address window.",
      code: "WINDOW_EXHAUSTED",
      retryable: false,
    });
  });

  it("still says something when the widget's error carries no message", async () => {
    const { launch, emit } = makeLaunch();
    const onError = vi.fn();
    await startStealthSync({ ...ARGS, launch, onError });

    emit({ type: STEALTH_MESSAGE.ERROR });
    expect(onError).toHaveBeenCalledWith({
      message: "The connect widget reported an error.",
      code: undefined,
      retryable: undefined,
    });
  });

  it("treats a non-boolean retryable as the widget not having said", async () => {
    const { launch, emit } = makeLaunch();
    const onError = vi.fn();
    await startStealthSync({ ...ARGS, launch, onError });

    // A string "false" is truthy, and Boolean() would have turned this into a
    // retry invitation on a failure the widget never said was transient.
    emit({
      type: STEALTH_MESSAGE.ERROR,
      code: "INTERNAL",
      message: "Something went wrong.",
      retryable: "false",
    } as unknown as StealthInboundMessage);
    expect(onError).toHaveBeenCalledWith({
      message: "Something went wrong.",
      code: "INTERNAL",
      retryable: undefined,
    });
  });

  it("does not treat ADD_COMPLETE as a finished sync", async () => {
    const { launch, emit } = makeLaunch();
    const onComplete = vi.fn();
    await startStealthSync({ ...ARGS, launch, onComplete });

    // Different flow, different completion. Accepting the wrong terminal
    // message would report a scan that never ran.
    emit({ type: STEALTH_MESSAGE.ADD_COMPLETE, connection_id: "conn-123" });
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("resolving means INIT was sent, not that the scan finished", async () => {
    const { launch } = makeLaunch();
    const onComplete = vi.fn();
    await startStealthSync({ ...ARGS, launch, onComplete });

    // The whole class of bug behind this ticket is treating "the call did not
    // throw" as "the work happened". Launching is not scanning.
    expect(onComplete).not.toHaveBeenCalled();
  });

  describe("describeStealthFailure", () => {
    it("offers a retry when the widget said the failure is retryable", () => {
      const line = describeStealthFailure({
        message: "Could not reach the filter server.",
        code: "NETWORK",
        retryable: true,
      });
      expect(line.message).toBe("Could not reach the filter server.");
      expect(line.canRetry).toBe(true);
    });

    it("withholds the retry when the widget said the failure is permanent", () => {
      expect(
        describeStealthFailure({
          message: "That extended public key is not valid.",
          code: "INVALID_XPUB",
          retryable: false,
        }),
      ).toEqual({ message: "That extended public key is not valid.", canRetry: false });
    });

    it("withholds the retry when the widget did not say", () => {
      // Safe direction, and cheap: the row's Sync button is still there, so a
      // withheld shortcut costs one click while a wrongly offered one invites
      // a user to press it forever on something that cannot succeed.
      expect(describeStealthFailure({ message: "Something went wrong." })).toEqual({
        message: "Something went wrong.",
        canRetry: false,
      });
    });

    it("decides from retryable and never from the code", () => {
      // The deployed widget emits INTERNAL with BOTH verdicts, at two sites in
      // one chunk. Any lookup table keyed on the code is therefore wrong for
      // one of these two, and this test is what stops someone adding one.
      const transient = describeStealthFailure({
        message: "Something went wrong.",
        code: "INTERNAL",
        retryable: true,
      });
      const permanent = describeStealthFailure({
        message: "Something went wrong.",
        code: "INTERNAL",
        retryable: false,
      });
      expect(transient.canRetry).toBe(true);
      expect(permanent.canRetry).toBe(false);
    });

    it("passes the widget's sentence through unedited", () => {
      const message = "Scan stopped at block 962,577. Try again in a moment.";
      expect(describeStealthFailure({ message, retryable: true }).message).toBe(message);
    });
  });

  /**
   * DL-1171. These guard one sentence that used to sit in the app as a comment
   * and as an implied promise: that pressing Try again picks up where the scan
   * stopped. We cannot see the cursor, it is upstream, and a first scan is a
   * range of roughly a hundred thousand requests, so guessing in the
   * reassuring direction is the expensive way to be wrong.
   */
  describe("describeStealthFailure, what it says about the cost of retrying", () => {
    const transient = { message: "Could not reach the filter server.", retryable: true };

    it("never promises that a retry resumes, whatever we know", () => {
      // The one assertion that must never be relaxed. If a future change makes
      // this fail, the change is claiming upstream behaviour this app cannot
      // observe. Read DL-1171 before touching it.
      const cases: Array<StealthCursorKnowledge | undefined> = [
        undefined,
        {},
        { completedScanReportedHeight: true },
        { completedScanReportedHeight: true, cursorUpdateFailed: false },
        { cursorUpdateFailed: true },
      ];
      for (const knowledge of cases) {
        const note = describeStealthFailure(transient, knowledge).retryNote ?? "";
        expect(note).not.toMatch(
          /resume|pick(s)? up where|continue(s)? from|where it (left|stopped)/i,
        );
      }
    });

    it("warns plainly when the widget SAID it could not save its position", () => {
      // Not a guess. The widget set cursor_update_failed, so the user is owed
      // the consequence in words before they press anything.
      const line = describeStealthFailure(transient, {
        completedScanReportedHeight: true,
        cursorUpdateFailed: true,
      });
      expect(line.canRetry).toBe(true);
      expect(line.retryNote).toMatch(/could not save its position/i);
    });

    it("says a first scan MAY start over, because may is the true word", () => {
      const line = describeStealthFailure(transient, {});
      expect(line.retryNote).toMatch(/no scan for this wallet has finished yet/i);
      expect(line.retryNote).toMatch(/\bmay\b/i);
    });

    it("treats no knowledge at all the same as no finished scan", () => {
      // A reload empties what this page has watched. Having forgotten is the
      // same epistemic state as never having seen it, and must read that way.
      expect(describeStealthFailure(transient, undefined).retryNote).toBe(
        describeStealthFailure(transient, {}).retryNote,
      );
    });

    it("stays silent when a scan finished and reported a height", () => {
      // The case people will want to fill in with "this will continue from
      // where it left off". That sentence is exactly what DL-1171 is about.
      // Silence costs the user nothing; a false reassurance costs them minutes.
      const line = describeStealthFailure(transient, {
        completedScanReportedHeight: true,
        cursorUpdateFailed: false,
      });
      expect(line.canRetry).toBe(true);
      expect(line.retryNote).toBeUndefined();
    });

    it("says nothing about a press that is not on offer", () => {
      const line = describeStealthFailure(
        { message: "That extended public key is not valid.", retryable: false },
        {},
      );
      expect(line.canRetry).toBe(false);
      expect(line.retryNote).toBeUndefined();
    });

    it("does not read a missing flag as a false one", () => {
      // undefined means "we have not seen it". A cursorUpdateFailed we never
      // received must not read as the widget having told us it succeeded.
      const unseen = describeStealthFailure(transient, { completedScanReportedHeight: true });
      const said = describeStealthFailure(transient, {
        completedScanReportedHeight: true,
        cursorUpdateFailed: false,
      });
      expect(unseen.retryNote).toBe(said.retryNote);
    });
  });
});
