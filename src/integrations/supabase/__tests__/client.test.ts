/**
 * @vitest-environment node
 *
 * DEV-0478: the Supabase auth flow must be pinned to PKCE, not left to
 * whichever default @supabase/supabase-js ships in a given version. This
 * pins the CONFIGURATION we pass to createClient, so a dependency bump or
 * a regeneration of this file cannot silently switch it back to the
 * implicit flow (tokens in the URL fragment) with nobody noticing.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const createClientMock = vi.fn(() => ({ auth: {} }));

vi.mock("@supabase/supabase-js", () => ({
  createClient: createClientMock,
}));

describe("supabase client auth flow", () => {
  beforeEach(() => {
    createClientMock.mockClear();
    vi.stubEnv("VITE_SUPABASE_URL", "https://ow.local");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "pub-key");
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("pins flowType to pkce so a library default change cannot land tokens in the URL fragment", async () => {
    const { supabase } = await import("../client");

    // The client is built lazily behind a Proxy; touching any property
    // forces creation, the same way real callers trigger it.
    void supabase.auth;

    expect(createClientMock).toHaveBeenCalledTimes(1);
    const [, , options] = createClientMock.mock.calls[0] as [
      string,
      string,
      { auth: { flowType?: string } },
    ];
    expect(options.auth.flowType).toBe("pkce");
  });
});
