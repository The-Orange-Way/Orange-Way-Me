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

/**
 * Names the PostHog hint list did not carry. Each entry is either the bare
 * name or a realistic field spelling whose prefix is NOT already covered by
 * an existing hint, so a failure here is caused by the missing name and not
 * by an unrelated word in the key.
 */
const RESIDUAL_POSTHOG_NAMES = [
  "passphrase",
  "wallet_passphrase",
  "pin",
  "wallet_pin",
  "entropy",
  "wallet_entropy",
  "xpriv",
  "wallet_xpriv",
  "kdf_salt",
  "hmac_salt",
  "nonce",
  "aes_nonce",
  "mnemonic",
];

/**
 * Names the Sentry pattern list did not carry. Shorter than the PostHog set
 * because Sentry already matched passphrase and pin.
 */
const RESIDUAL_SENTRY_NAMES = [
  "entropy",
  "wallet_entropy",
  "kdf_salt",
  "hmac_salt",
  "nonce",
  "aes_nonce",
  "xpriv",
  "wallet_xpriv",
  "xprv",
  "mnemonic",
];

const SENTINEL = "sensitive-value";

describe("residual key-material names reach neither vendor (OW-T0116 item 4)", () => {
  beforeEach(() => {
    initMock.mockClear();
    vi.stubEnv("VITE_SENTRY_DSN", "https://public@sentry.test/123");
  });

  it("PostHog redacts every residual key-material name", () => {
    const props = Object.fromEntries(RESIDUAL_POSTHOG_NAMES.map((k) => [k, SENTINEL]));
    const result = scrubPostHogEvent({
      uuid: "00000000-0000-0000-0000-000000000000",
      event: "test",
      properties: props,
    } as unknown as Parameters<typeof scrubPostHogEvent>[0]);

    for (const key of RESIDUAL_POSTHOG_NAMES) {
      expect(result?.properties[key], `PostHog scrubber did not redact "${key}"`).toBe(
        "[redacted]",
      );
    }
  });

  it("Sentry redacts every residual key-material name", async () => {
    const mod = await freshSentryModule();
    mod.initSentry();
    const cfg = initMock.mock.calls[0][0];
    const extra = Object.fromEntries(RESIDUAL_SENTRY_NAMES.map((k) => [k, SENTINEL]));
    const scrubbed = cfg.beforeSend({ extra }) as { extra: Record<string, unknown> };

    for (const key of RESIDUAL_SENTRY_NAMES) {
      expect(scrubbed.extra[key], `Sentry scrubber did not redact "${key}"`).toBe("[redacted]");
    }
  });
});
