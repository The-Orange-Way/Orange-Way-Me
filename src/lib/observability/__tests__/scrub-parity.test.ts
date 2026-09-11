import { beforeEach, describe, expect, it, vi } from "vitest";
import { scrubPostHogEvent, SCRUB_VALUE_KEY_HINTS } from "@/lib/observability/posthog-scrubber";
import { SECRET_KEY_PATTERNS } from "@/lib/observability/sentry";
import { VALUE_SHAPE_REDACTED } from "@/lib/observability/value-shapes";

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

/**
 * Key names covered by BOTH scrubbers, derived from the real source arrays.
 * No hardcoded list: if a hint is added to posthog-scrubber.ts but not to
 * sentry.ts (or the reverse), this set narrows and the invariant test below
 * fires with an actionable message before CI goes green.
 *
 * Algorithm: take every substring hint from SCRUB_VALUE_KEY_HINTS and keep
 * only those that also match at least one regex in SECRET_KEY_PATTERNS. The
 * result is the intersection the two lists are meant to share for key
 * material.
 */
const BOTH_SCRUBBERS_COVER = SCRUB_VALUE_KEY_HINTS.filter((hint) =>
  SECRET_KEY_PATTERNS.some((p) => p.test(hint)),
);

describe("Sentry vs PostHog scrubber parity (OWM-T0738)", () => {
  beforeEach(() => {
    initMock.mockClear();
    vi.stubEnv("VITE_SENTRY_DSN", "https://public@sentry.test/123");
  });

  it("shared coverage set contains every key-material hint added by OWM-T0738", () => {
    // These strings are the specific parity gap this ticket closes. entropy,
    // salt, xpriv and xprv were in sentry.ts but absent from posthog-scrubber.ts
    // before the fix. If any of them is removed from EITHER source array,
    // BOTH_SCRUBBERS_COVER shrinks and this assertion fires before the
    // behavioral tests below have a chance to silently miss it.
    const TICKET_FIXED_KEYS = [
      "entropy",
      "salt",
      "xpriv",
      "xprv",
      "xpub",
      "seed",
      "secret",
      "mek",
      "opk",
      "password",
      "passphrase",
    ];
    for (const key of TICKET_FIXED_KEYS) {
      expect(
        BOTH_SCRUBBERS_COVER,
        `"${key}" dropped from shared coverage -- verify it is in both ` +
          `SCRUB_VALUE_KEY_HINTS (posthog-scrubber.ts) AND matched by ` +
          `SECRET_KEY_PATTERNS (sentry.ts)`,
      ).toContain(key);
    }
  });

  it("PostHog scrubs every key in the shared coverage set", () => {
    const props = Object.fromEntries(BOTH_SCRUBBERS_COVER.map((k) => [k, "sensitive-value"]));
    const r = scrubPostHogEvent({
      uuid: "00000000-0000-0000-0000-000000000000",
      event: "test",
      properties: props,
    } as unknown as Parameters<typeof scrubPostHogEvent>[0]);

    for (const key of BOTH_SCRUBBERS_COVER) {
      expect(r?.properties[key], `PostHog scrubber did not redact "${key}"`).toBe("[redacted]");
    }
  });

  it("Sentry scrubs every key in the shared coverage set", async () => {
    const mod = await freshSentryModule();
    mod.initSentry();
    const cfg = initMock.mock.calls[0][0];
    const extra = Object.fromEntries(BOTH_SCRUBBERS_COVER.map((k) => [k, "sensitive-value"]));
    const scrubbed = cfg.beforeSend({ extra }) as { extra: Record<string, unknown> };

    for (const key of BOTH_SCRUBBERS_COVER) {
      expect(scrubbed.extra[key], `Sentry scrubber did not redact "${key}"`).toBe("[redacted]");
    }
  });
});

// The public BIP32 test vector extended key. 111 characters, so it sits
// comfortably under the PostHog 256 character truncation cap, and it is
// nobody's key. Never put a real one in a public repo.
const XPUB =
  "xpub661MyMwAqRbcFtXgS5sYJABqqG9YLmC4Q1Rdap9gSE8NqtwybGhePY2gZ29ESFjqJoCu1Rupje8YtGqsefD265TMg7usUDFdp6W1EGMcet8";

describe("key-shaped VALUES under innocuous key names", () => {
  beforeEach(() => {
    initMock.mockClear();
    vi.stubEnv("VITE_SENTRY_DSN", "https://public@sentry.test/123");
  });

  it("redacts an extended key under a key named detail on the PostHog side", () => {
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

  it("redacts an extended key in front of a string past the truncation cap", () => {
    // Regression guard for ordering. The cap keeps the FIRST 256
    // characters, so capping before the shape pass ships the key.
    const long = `${XPUB} ${"a".repeat(400)}`;
    const r = scrubPostHogEvent({
      uuid: "00000000-0000-0000-0000-000000000000",
      event: "wallet_import_failed",
      properties: { detail: long },
    } as unknown as Parameters<typeof scrubPostHogEvent>[0]);

    expect(String(r?.properties.detail)).not.toContain("661MyMwAqRbcF");
    expect(String(r?.properties.detail)).toContain(VALUE_SHAPE_REDACTED);
  });

  it("redacts an extended key under a key named detail on the Sentry side", async () => {
    const mod = await freshSentryModule();
    mod.initSentry();
    const cfg = initMock.mock.calls[0][0];
    const scrubbed = cfg.beforeSend({
      extra: { step: "decode", detail: XPUB },
    }) as { extra: Record<string, unknown> };

    expect(scrubbed.extra.detail).toBe(VALUE_SHAPE_REDACTED);
    expect(scrubbed.extra.step).toBe("decode");
  });

  it("redacts a bare extended key in an exception message on the Sentry side", async () => {
    const mod = await freshSentryModule();
    mod.initSentry();
    const cfg = initMock.mock.calls[0][0];
    const scrubbed = cfg.beforeSend({
      exception: { values: [{ value: `sync failed for ${XPUB}` }] },
    }) as { exception: { values: Array<{ value: string }> } };

    const value = scrubbed.exception.values[0].value;
    expect(value).not.toContain("661MyMwAqRbcF");
    expect(value).toContain(VALUE_SHAPE_REDACTED);
  });

  it("redacts a named extended key on the Sentry free-string path", async () => {
    const mod = await freshSentryModule();
    mod.initSentry();
    const cfg = initMock.mock.calls[0][0];
    const scrubbed = cfg.beforeSend({
      exception: { values: [{ value: `sync failed for xpub=${XPUB}` }] },
    }) as { exception: { values: Array<{ value: string }> } };

    expect(scrubbed.exception.values[0].value).not.toContain("661MyMwAqRbcF");
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
