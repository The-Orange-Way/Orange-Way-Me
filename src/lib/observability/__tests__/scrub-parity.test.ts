import { beforeEach, describe, expect, it, vi } from "vitest";
import { scrubPostHogEvent } from "@/lib/observability/posthog-scrubber";

const initMock = vi.fn();

vi.mock("@sentry/react", () => ({
  init: initMock,
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

async function freshSentryModule() {
  vi.resetModules();
  return import("../sentry");
}

// The canonical key names this ticket exists to close the gap on: xpub and
// stealth key names, plus seed/secret parity across both lists. Each must
// be redacted by BOTH the Sentry scrubber and the PostHog scrubber.
const MUST_REDACT_KEYS = [
  "xpub",
  "wallet_xpub",
  "or_stealth_key_b64",
  "stealth_key",
  "seed",
  "wallet_seed",
  "secret",
  "my_secret",
];

describe("Sentry vs PostHog scrubber parity (DL-1584)", () => {
  beforeEach(() => {
    initMock.mockClear();
    vi.stubEnv("VITE_SENTRY_DSN", "https://public@sentry.test/123");
  });

  it("redacts every DL-1584 key name on the PostHog side", () => {
    const props = Object.fromEntries(MUST_REDACT_KEYS.map((k) => [k, "sensitive-value"]));
    const r = scrubPostHogEvent({
      uuid: "00000000-0000-0000-0000-000000000000",
      event: "test",
      properties: props,
    } as unknown as Parameters<typeof scrubPostHogEvent>[0]);

    for (const key of MUST_REDACT_KEYS) {
      expect(r?.properties[key], `PostHog scrubber did not redact "${key}"`).toBe("[redacted]");
    }
  });

  it("redacts every DL-1584 key name on the Sentry side", async () => {
    const mod = await freshSentryModule();
    mod.initSentry();
    const cfg = initMock.mock.calls[0][0];
    const extra = Object.fromEntries(MUST_REDACT_KEYS.map((k) => [k, "sensitive-value"]));
    const scrubbed = cfg.beforeSend({ extra }) as { extra: Record<string, unknown> };

    for (const key of MUST_REDACT_KEYS) {
      expect(scrubbed.extra[key], `Sentry scrubber did not redact "${key}"`).toBe("[redacted]");
    }
  });
});

// The public BIP32 test vector extended key. 111 characters, so it sits
// comfortably under the PostHog 256 character truncation cap, and it is
// nobody's key. Never put a real one in a public repo.
const XPUB =
  "xpub661MyMwAqRbcFtXgS5sYJABqqG9YLmC4Q1Rdap9gSE8NqtwybGhePY2gZ29ESFjqJoCu1Rupje8YtGqsefD265TMg7usUDFdp6W1EGMcet8";

describe("key-shaped VALUES under innocuous keys (OWM-T0378)", () => {
  beforeEach(() => {
    initMock.mockClear();
    vi.stubEnv("VITE_SENTRY_DSN", "https://public@sentry.test/123");
  });

  it("redacts an xpub under a key named detail on the PostHog side", () => {
    const r = scrubPostHogEvent({
      uuid: "00000000-0000-0000-0000-000000000000",
      event: "wallet_import_failed",
      properties: { step: "decode", detail: XPUB },
    } as unknown as Parameters<typeof scrubPostHogEvent>[0]);

    expect(r?.properties.detail).toBe(VALUE_SHAPE_REDACTED);
    // The innocuous sibling must survive: a scrubber that eats ordinary
    // fields costs the debugging signal telemetry exists for.
    expect(r?.properties.step).toBe("decode");
  });

  it("redacts an xpub sitting in front of a string past the truncation cap", () => {
    // Regression guard for ordering. The cap keeps the FIRST 256
    // characters, so capping before the shape pass ships the key.
    const long = `${XPUB} ${"a".repeat(400)}`;
    const r = scrubPostHogEvent({
      uuid: "00000000-0000-0000-0000-000000000000",
      event: "wallet_import_failed",
      properties: { detail: long },
    } as unknown as Parameters<typeof scrubPostHogEvent>[0]);

    expect(String(r?.properties.detail)).not.toContain("xpub661");
    expect(String(r?.properties.detail)).toContain(VALUE_SHAPE_REDACTED);
  });

  it("redacts an xpub under a key named detail on the Sentry side", async () => {
    const mod = await freshSentryModule();
    mod.initSentry();
    const cfg = initMock.mock.calls[0][0];
    const scrubbed = cfg.beforeSend({
      extra: { step: "decode", detail: XPUB },
    }) as { extra: Record<string, unknown> };

    expect(scrubbed.extra.detail).toBe(VALUE_SHAPE_REDACTED);
    expect(scrubbed.extra.step).toBe("decode");
  });

  it("redacts a bare xpub in an exception message on the Sentry side", async () => {
    const mod = await freshSentryModule();
    mod.initSentry();
    const cfg = initMock.mock.calls[0][0];
    const scrubbed = cfg.beforeSend({
      exception: { values: [{ value: `sync failed for ${XPUB}` }] },
    }) as { exception: { values: Array<{ value: string }> } };

    const value = scrubbed.exception.values[0].value;
    expect(value).not.toContain("xpub661");
    expect(value).toContain(VALUE_SHAPE_REDACTED);
  });

  it("redacts xpub=value on the Sentry free-string path", async () => {
    const mod = await freshSentryModule();
    mod.initSentry();
    const cfg = initMock.mock.calls[0][0];
    const scrubbed = cfg.beforeSend({
      exception: { values: [{ value: `sync failed for xpub=${XPUB}` }] },
    }) as { exception: { values: Array<{ value: string }> } };

    expect(scrubbed.exception.values[0].value).not.toContain("xpub661");
  });

  it("leaves ordinary error prose untouched on both products", async () => {
    const prose = "Failed to decode the wallet export file: unexpected end of input";

    const r = scrubPostHogEvent({
      uuid: "00000000-0000-0000-0000-000000000000",
      event: "test",
      properties: { detail: prose },
    } as unknown as Parameters<typeof scrubPostHogEvent>[0]);
    expect(r?.properties.detail).toBe(prose);

    const mod = await freshSentryModule();
    mod.initSentry();
    const cfg = initMock.mock.calls[0][0];
    const scrubbed = cfg.beforeSend({ extra: { detail: prose } }) as {
      extra: Record<string, unknown>;
    };
    expect(scrubbed.extra.detail).toBe(prose);
  });
});
