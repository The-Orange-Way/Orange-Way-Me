import { describe, it, expect, vi, beforeEach } from "vitest";

const createClientMock = vi.fn(() => ({}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

describe("supabase client auth flow", () => {
  beforeEach(() => {
    vi.resetModules();
    createClientMock.mockClear();
    vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "test-publishable-key");
  });

  it("pins flowType to pkce so a library default or dependency bump cannot silently switch to implicit", async () => {
    const { supabase } = await import("../client");
    // The client is a lazy singleton behind a Proxy: touching any
    // property forces createSupabaseClient() to run once.
    void supabase.auth;

    expect(createClientMock).toHaveBeenCalledTimes(1);
    const options = createClientMock.mock.calls[0]?.[2] as {
      auth?: { flowType?: string };
    };
    expect(options?.auth?.flowType).toBe("pkce");
  });
});
