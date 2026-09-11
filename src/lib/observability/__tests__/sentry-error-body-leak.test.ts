/**
 * B4: does the whole proxy response body that CallProxyError carries reach
 * the Sentry event? (OWM-T0423 / OWM-T0424)
 *
 * CallProxyError (src/lib/or/proxy-errors.ts:14-22) assigns the ENTIRE
 * upstream response body to an own property `body`. Under sink mode that
 * body is a list of Orange Rails transaction rows whose enc_amount,
 * enc_description and enc_merchant fields are PLAINTEXT by Orange Rails
 * design (they are encrypted at rest on the OR side under a key this app
 * never sees, and OR hands the decrypted value to us in a "sink" response).
 * Two or-sync call sites hand a CallProxyError straight to console.error
 * (src/components/connections/ConnectionsPage.tsx:939 and :1038).
 *
 * The scrubber half of this question is already settled and is NOT
 * re-derived here: SECRET_KEY_PATTERNS matches on the KEY NAME, and its
 * plaintext-field patterns are anchored (/^merchant$/i, /^description$/i,
 * /^memo$/i, /^balance$/i). None of enc_amount, enc_description or
 * enc_merchant match those anchored patterns, and the unanchored /key/i
 * does not match "enc_amount" either. So the open question is only: does
 * the body reach the event at all, unredacted.
 *
 * THE TRAP this test is written to avoid: beforeBreadcrumb and beforeSend
 * are declared INLINE inside the Sentry.init() call in initSentry
 * (sentry.ts:264-294) and are never exported. Re-implementing their
 * bodies here would assert on a replica and prove nothing about what
 * ships. Instead: mock @sentry/react with an init() spy, set
 * VITE_SENTRY_DSN so initSentry does not early-return, call initSentry(),
 * then pull beforeBreadcrumb / beforeSend off the CAPTURED options object
 * -- the same pattern sentry.test.ts already uses for its no-PII
 * contract tests.
 *
 * ZKA: synthetic marker only (ACME_QA_MARKER_7731). No real customer
 * data, no key material, no token anywhere in this file.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CallProxyError } from "../../or/proxy-errors";

const initMock = vi.fn();

vi.mock("@sentry/react", () => ({
  init: initMock,
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

/** Synthetic-only marker. Never a real value from any customer or system. */
const MARKER = "ACME_QA_MARKER_7731";

/**
 * Shape of a single row in an Orange Rails "sink" response: the fields OR
 * hands back already decrypted, under names carrying the enc_ prefix
 * because that is the column name on the OR side, not because the value
 * arriving here is still ciphertext.
 */
function sinkRow() {
  return {
    id: "row-1",
    enc_amount: `amount-${MARKER}`,
    enc_description: `description-${MARKER}`,
    enc_merchant: `merchant-${MARKER}`,
  };
}

async function freshSentryModule() {
  // initSentry guards on a module-scoped `initialised` boolean, same as
  // sentry.test.ts -- reset the module registry so each test gets a
  // fresh copy and can call initSentry exactly once.
  vi.resetModules();
  return import("../sentry");
}

describe("B4: does a CallProxyError body reach the Sentry event", () => {
  beforeEach(() => {
    initMock.mockClear();
    vi.stubEnv("VITE_SENTRY_DSN", "https://public@sentry.test/123");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("records the resolved @sentry/react version this suite ran against (package.json pins ^10, a range, not a fact)", async () => {
    const pkg = (await import("@sentry/react/package.json")) as unknown as
      | { version?: string; default?: { version?: string } };
    const version = pkg.version ?? pkg.default?.version;
    expect(typeof version).toBe("string");
    expect(version).toBeTruthy();
    // eslint-disable-next-line no-console -- QA reads this in the CI run output, on purpose.
    console.log(`OWM-T0428: resolved @sentry/react version = ${version}`);
  });

  it("beforeBreadcrumb: a CallProxyError-shaped console/error breadcrumb -- does the sink row marker survive?", async () => {
    const mod = await freshSentryModule();
    mod.initSentry();
    const cfg = initMock.mock.calls[0][0];

    const proxyErr = new CallProxyError("or-sync failed", 502, sinkRow());
    const breadcrumb = {
      category: "console",
      level: "error",
      message: proxyErr.message,
      data: { arguments: [proxyErr.message, proxyErr] },
    };

    const result = cfg.beforeBreadcrumb(breadcrumb) as typeof breadcrumb | null;

    expect(result).not.toBeNull();
    // Expected from source reading: SECRET_KEY_PATTERNS is a key-name
    // denylist, enc_amount/enc_description/enc_merchant match none of its
    // entries, so the marker is expected to survive. If this assertion
    // ever flips, the mechanism that removed it needs to be found and
    // named -- do not just update the expectation.
    expect(JSON.stringify(result)).toContain(MARKER);
  });

  it("beforeSend: an event carrying the CallProxyError body under extra -- does the sink row marker survive?", async () => {
    const mod = await freshSentryModule();
    mod.initSentry();
    const cfg = initMock.mock.calls[0][0];

    const proxyErr = new CallProxyError("or-sync failed", 502, sinkRow());
    const event = {
      exception: { values: [{ value: proxyErr.message }] },
      extra: { body: proxyErr.body },
    };

    const result = cfg.beforeSend(event) as typeof event | null;

    expect(result).not.toBeNull();
    // Same expectation as the breadcrumb case, same reasoning: nothing in
    // SECRET_KEY_PATTERNS matches an enc_* key name.
    expect(JSON.stringify(result)).toContain(MARKER);
  });

  it("NEGATIVE CONTROL: a field named exactly \"description\" (not enc_description) MUST come back redacted", async () => {
    const mod = await freshSentryModule();
    mod.initSentry();
    const cfg = initMock.mock.calls[0][0];

    // Without this control, a test that passes because the fixture never
    // reached the scrubber at all is indistinguishable from a test that
    // passes because the scrubber worked. This proves the scrubber is
    // actually wired into beforeSend and beforeBreadcrumb.
    const sendResult = cfg.beforeSend({
      extra: { description: `plain-${MARKER}` },
    }) as { extra: Record<string, unknown> };
    expect(sendResult.extra.description).toBe("[redacted]");
    expect(JSON.stringify(sendResult)).not.toContain(MARKER);

    const bcResult = cfg.beforeBreadcrumb({
      category: "console",
      level: "error",
      data: { description: `plain-${MARKER}` },
    }) as { data: Record<string, unknown> } | null;
    expect(bcResult).not.toBeNull();
    expect(bcResult!.data.description).toBe("[redacted]");
    expect(JSON.stringify(bcResult)).not.toContain(MARKER);
  });
});
