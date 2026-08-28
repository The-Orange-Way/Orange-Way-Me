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
