/**
 * @vitest-environment node
 *
 * Regression guard for how OR_CONNECT_BASE resolves from the environment.
 *
 * Two separate production incidents live behind these assertions:
 *
 *  1. The value must never be the apex orangerails.com/connect. That host
 *     redirects the popup to connect.orangerails.com, so the widget posts
 *     its completion message from an origin that can never equal
 *     `new URL(OR_CONNECT_BASE).origin`. Both connect paths compare origins
 *     strictly and drop a mismatch with no error, so connect silently
 *     never completes.
 *
 *  2. A deploy workflow that sets VITE_OR_CONNECT_URL to an EMPTY STRING,
 *     intending "fall back to the default", produces "" here. An empty
 *     string is not nullish, so `??` keeps it, the base becomes "", and
 *     `new URL("")` throws, taking down both paths at the first call.
 *     The resolution uses `||` so empty is treated as unset. If someone
 *     "tidies" that back to `??`, this test fails.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const invokeMock = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: invokeMock } },
}));

// A Quiltt bundle is supplied so buildBankPopupUrl takes its fast path,
// which derives the popup URL purely from OR_CONNECT_BASE. The slow path
// reads window.location, which does not exist in this node environment
// and is not what these tests are about.
const QUICK_CONNECT = {
  orPlatformUserId: "or-user-1",
  widget_token: "widget-tok",
  expires_at: "2099-01-01T00:00:00Z",
  quilttBundle: {
    session_token: "sess-tok",
    connector_id: "conn-id",
    platform_slug: "orangeway",
    app_user_id: "app-user-1",
  },
};

async function resolveBaseOrigin(): Promise<string> {
  const { buildBankPopupUrl } = await import("../bank-connect");
  const url = buildBankPopupUrl({
    quickConnect: QUICK_CONNECT,
    credKeyB64: "Y3JlZA==",
    txnKeyB64: "dHhu",
  });
  return new URL(url).origin;
}

describe("OR_CONNECT_BASE resolution", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses the configured widget host when the env var is set", async () => {
    vi.stubEnv("VITE_OR_CONNECT_URL", "https://dev.orangerails.com/connect");
    expect(await resolveBaseOrigin()).toBe("https://dev.orangerails.com");
  });

  it("treats an EMPTY env var as unset rather than keeping it (the `??` trap)", async () => {
    vi.stubEnv("VITE_OR_CONNECT_URL", "");
    // With `??` this threw "Invalid URL" instead of returning an origin.
    await expect(resolveBaseOrigin()).resolves.toBe("https://connect.orangerails.com");
  });

  it("never falls back to the redirecting apex", async () => {
    vi.stubEnv("VITE_OR_CONNECT_URL", "");
    expect(await resolveBaseOrigin()).not.toBe("https://orangerails.com");
  });
});
