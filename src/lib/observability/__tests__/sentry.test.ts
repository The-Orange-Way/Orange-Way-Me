/**
 * Sentry initialisation: no-PII contract.
 *
 * These tests pin the Sentry.init() config that protects the
 * "we can't see your data" marketing claim. If any of them fails, the
 * change made to sentry.ts is one of:
 *
 *   - Demoting the explicit `sendDefaultPii: false` back to the SDK
 *     default.
 *   - Letting BrowserTracing, Replay, or BrowserSession back into the
 *     integrations list. Replay ships DOM mutations, which would
 *     capture form-input values (a direct ZKA breach). BrowserSession
 *     would attach a per-pageload session id keyed against the ingest
 *     IP (a fingerprint at the Sentry edge).
 *
 * If your change was intentional, the README + threat-model claims about
 * Sentry need updating in lockstep, NOT just this test.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const initMock = vi.fn();
const captureExceptionMock = vi.fn();
const captureMessageMock = vi.fn();

vi.mock("@sentry/react", () => ({
  init: initMock,
  captureException: captureExceptionMock,
  captureMessage: captureMessageMock,
}));

async function freshSentryModule() {
  // initSentry guards on a module-scoped `initialised` boolean. Reset the
  // module registry so each test gets a clean copy and can call initSentry
  // exactly once.
  vi.resetModules();
  return import("../sentry");
}

describe("Sentry init no-PII contract", () => {
  beforeEach(() => {
    initMock.mockClear();
    captureExceptionMock.mockClear();
    captureMessageMock.mockClear();
    vi.stubEnv("VITE_SENTRY_DSN", "https://public@sentry.test/123");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("calls Sentry.init exactly once with sendDefaultPii: false", async () => {
    const mod = await freshSentryModule();
    mod.initSentry();
    expect(initMock).toHaveBeenCalledTimes(1);
    const cfg = initMock.mock.calls[0][0];
    expect(cfg.sendDefaultPii).toBe(false);
  });

  it("keeps tracesSampleRate at 0 (no performance tracing)", async () => {
    const mod = await freshSentryModule();
    mod.initSentry();
    const cfg = initMock.mock.calls[0][0];
    expect(cfg.tracesSampleRate).toBe(0);
  });

  it("drops every name in DROPPED_INTEGRATIONS and keeps every other safe default", async () => {
    const mod = await freshSentryModule();
    mod.initSentry();
    const cfg = initMock.mock.calls[0][0];
    expect(typeof cfg.integrations).toBe("function");

    // Synthetic defaults list — the union of integrations we expect to
    // be DROPPED and integrations we expect to be KEPT. If a future SDK
    // adds a new PII-leaning default, this list will need an entry added
    // AND the source-of-truth set in sentry.ts updated.
    const safeAllowlist = new Set([
      "InboundFilters",
      "FunctionToString",
      "GlobalHandlers",
      "Breadcrumbs",
      "LinkedErrors",
      "Dedupe",
      "BrowserApiErrors",
    ]);
    const fakeDefaults = [
      ...[...mod.DROPPED_INTEGRATIONS].map((name) => ({ name })),
      ...[...safeAllowlist].map((name) => ({ name })),
    ];
    const filtered = cfg.integrations(fakeDefaults);
    const filteredNames = new Set(filtered.map((i: { name: string }) => i.name));

    // Every dropped name must be absent (positive assertion per integration,
    // not just "the dropped set is gone" — catches a future SDK rename
    // where the dropped name disappears from defaults silently).
    for (const dropped of mod.DROPPED_INTEGRATIONS) {
      expect(filteredNames.has(dropped)).toBe(false);
    }
    // The remaining names must all be in the safe allowlist. If the SDK
    // ships a new default integration this assertion fails closed, the
    // contract test breaks, and a contributor must explicitly classify
    // the new integration as safe (extend allowlist) or PII-leaning
    // (extend DROPPED_INTEGRATIONS).
    for (const name of filteredNames) {
      expect(safeAllowlist.has(name as string)).toBe(true);
    }
  });

  it("is a no-op when VITE_SENTRY_DSN is unset", async () => {
    vi.stubEnv("VITE_SENTRY_DSN", "");
    const mod = await freshSentryModule();
    mod.initSentry();
    expect(initMock).not.toHaveBeenCalled();
  });

  it("is idempotent — second call does not re-init", async () => {
    const mod = await freshSentryModule();
    mod.initSentry();
    mod.initSentry();
    expect(initMock).toHaveBeenCalledTimes(1);
  });

  it("redacts stealth wallet key fields before sending events", async () => {
    const mod = await freshSentryModule();
    mod.initSentry();
    const cfg = initMock.mock.calls[0][0];
    const scrubbed = cfg.beforeSend({
      extra: {
        or_stealth_key_b64: "secret-a",
        stealth_key: "secret-b",
        credKeyB64: "secret-c",
        label: "safe context",
      },
    }) as { extra: Record<string, unknown> };

    expect(scrubbed.extra.or_stealth_key_b64).toBe("[redacted]");
    expect(scrubbed.extra.stealth_key).toBe("[redacted]");
    expect(scrubbed.extra.credKeyB64).toBe("[redacted]");
    expect(scrubbed.extra.label).toBe("safe context");
  });

  it("redacts xpub and bare secret key names (DL-1584)", async () => {
    const mod = await freshSentryModule();
    mod.initSentry();
    const cfg = initMock.mock.calls[0][0];
    const scrubbed = cfg.beforeSend({
      extra: {
        xpub: "xpub6D4BDPcP2GT...",
        wallet_xpub: "xpub6D4BDPcP2GT...",
        my_secret: "s".repeat(20),
        label: "safe context",
      },
    }) as { extra: Record<string, unknown> };

    expect(scrubbed.extra.xpub).toBe("[redacted]");
    expect(scrubbed.extra.wallet_xpub).toBe("[redacted]");
    expect(scrubbed.extra.my_secret).toBe("[redacted]");
    expect(scrubbed.extra.label).toBe("safe context");
  });

  /**
   * The one free-form string beforeSend used to miss. Sentry.captureMessage
   * populates the top-level message, and none of the walks (extra, contexts,
   * tags, request, transaction, breadcrumbs, exception values) reach it. There
   * is no application callsite for captureMessage today, so this pins a latent
   * gap shut before one arrives rather than closing a live leak.
   */
  it("scrubs the top-level event message, which is what captureMessage populates", async () => {
    const mod = await freshSentryModule();
    mod.initSentry();
    const cfg = initMock.mock.calls[0][0];
    const scrubbed = cfg.beforeSend({
      message: `wallet import failed for ${EXTENDED_KEY}`,
    }) as { message: string };

    expect(scrubbed.message).not.toContain(EXTENDED_KEY);
    expect(scrubbed.message).toContain("[redacted-key-shape]");
  });

  it("scrubs logentry.message too, which is the other shape a message arrives in", async () => {
    const mod = await freshSentryModule();
    mod.initSentry();
    const cfg = initMock.mock.calls[0][0];
    const scrubbed = cfg.beforeSend({
      logentry: { message: `wallet import failed for ${EXTENDED_KEY}` },
    }) as { logentry: { message: string } };

    expect(scrubbed.logentry.message).not.toContain(EXTENDED_KEY);
    expect(scrubbed.logentry.message).toContain("[redacted-key-shape]");
  });

  /**
   * Order, not coverage. The length cap keeps the FIRST characters, so a key
   * that straddles the cap is the only input that tells the two orderings
   * apart: cap first and what survives is a prefix of the key, short enough
   * that the pattern no longer matches it, and it goes out on the wire.
   */
  it("scrubs a value before the 2000-character cap, not after", async () => {
    const mod = await freshSentryModule();
    mod.initSentry();
    const cfg = initMock.mock.calls[0][0];
    const scrubbed = cfg.beforeSend({
      extra: { detail: "a".repeat(1990) + EXTENDED_KEY },
    }) as { extra: Record<string, string> };

    expect(scrubbed.extra.detail).not.toContain("xpub");
    expect(scrubbed.extra.detail).toContain("[redacted-key-shape]");
  });

  it("scrubs an exception value before the 4000-character cap, not after", async () => {
    const mod = await freshSentryModule();
    mod.initSentry();
    const cfg = initMock.mock.calls[0][0];
    const scrubbed = cfg.beforeSend({
      exception: { values: [{ value: "a".repeat(3990) + EXTENDED_KEY }] },
    }) as { exception: { values: Array<{ value: string }> } };

    expect(scrubbed.exception.values[0].value).not.toContain("xpub");
    expect(scrubbed.exception.values[0].value).toContain("[redacted-key-shape]");
  });

  it("fails closed: drops the event instead of throwing when the scrubber itself throws", async () => {
    const mod = await freshSentryModule();
    mod.initSentry();
    const cfg = initMock.mock.calls[0][0];
    // A throwing getter is the cheapest way to fail the scrubber partway
    // through walking a payload. The point of the assertion is that a
    // half-scrubbed event never reaches the network, and that calling
    // beforeSend does not itself throw out of the SDK's hands.
    const hostile = {};
    Object.defineProperty(hostile, "extra", {
      enumerable: true,
      get() {
        throw new Error("scrubber blew up");
      },
    });
    expect(() => cfg.beforeSend(hostile)).not.toThrow();
    expect(cfg.beforeSend(hostile)).toBeNull();
  });

  it("fails closed on breadcrumbs too: drops the breadcrumb when scrubbing it throws", async () => {
    const mod = await freshSentryModule();
    mod.initSentry();
    const cfg = initMock.mock.calls[0][0];
    const hostileBc = { category: "xhr" };
    Object.defineProperty(hostileBc, "data", {
      enumerable: true,
      get() {
        throw new Error("scrubber blew up");
      },
    });
    expect(() => cfg.beforeBreadcrumb(hostileBc)).not.toThrow();
    expect(cfg.beforeBreadcrumb(hostileBc)).toBeNull();
  });
});
