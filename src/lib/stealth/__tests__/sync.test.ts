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
  STEALTH_WIDGET_PATH,
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

  it("reports progress from the widget's own frames", async () => {
    const { launch, emit } = makeLaunch();
    const onProgress = vi.fn();
    await startStealthSync({ ...ARGS, launch, onProgress });

    emit({ type: STEALTH_MESSAGE.PROGRESS, scanned_blocks: 10, total_blocks: 100 });
    expect(onProgress).toHaveBeenCalledWith(
      expect.objectContaining({ scanned_blocks: 10, total_blocks: 100 }),
    );
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

  it("surfaces the widget's own error text", async () => {
    const { launch, emit } = makeLaunch();
    const onError = vi.fn();
    await startStealthSync({ ...ARGS, launch, onError });

    emit({ type: STEALTH_MESSAGE.ERROR, message: "Envelope not found" });
    expect(onError).toHaveBeenCalledWith("Envelope not found");
  });

  it("still says something when the widget's error carries no message", async () => {
    const { launch, emit } = makeLaunch();
    const onError = vi.fn();
    await startStealthSync({ ...ARGS, launch, onError });

    emit({ type: STEALTH_MESSAGE.ERROR });
    expect(onError).toHaveBeenCalledWith("The connect widget reported an error.");
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
});
