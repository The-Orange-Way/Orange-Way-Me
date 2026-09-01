/**
 * @vitest-environment node
 *
 * OWM-T0478. One flag, both doors.
 *
 * The bank case below is the one that matters most. The single biggest risk in
 * this change is closing the bank route by accident while aiming at the
 * stealth slugs, so it gets its own assertion rather than a comment claiming
 * it is unaffected.
 */
import { describe, it, expect, vi } from "vitest";
import { isAddEntryPointOffered, BITCOIN_SOURCE_UNAVAILABLE_MESSAGE } from "../add-gate";

// bank-connect imports the supabase client at module load. Nothing in the
// tests below calls an edge function, so a hollow client is enough.
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: vi.fn() } },
}));

describe("isAddEntryPointOffered", () => {
  it("offers the Bitcoin source catalogue when the build flag and the kill switch are both on", () => {
    expect(
      isAddEntryPointOffered("bitcoin-source", {
        orConnectBuildEnabled: true,
        stealthSyncEnabled: true,
      }),
    ).toBe(true);
  });

  it("refuses the Bitcoin source catalogue when the kill switch is off", () => {
    expect(
      isAddEntryPointOffered("bitcoin-source", {
        orConnectBuildEnabled: true,
        stealthSyncEnabled: false,
      }),
    ).toBe(false);
  });

  it("refuses it when the build never enabled connect at all", () => {
    expect(
      isAddEntryPointOffered("bitcoin-source", {
        orConnectBuildEnabled: false,
        stealthSyncEnabled: true,
      }),
    ).toBe(false);
  });

  it("refuses it when neither is on, which is the unreadable-flag case", () => {
    // runtimeFlags reports false when the app_flags read fails, so this is
    // also what a broken lookup looks like from here. An unreadable kill
    // switch is not an open one.
    expect(
      isAddEntryPointOffered("bitcoin-source", {
        orConnectBuildEnabled: false,
        stealthSyncEnabled: false,
      }),
    ).toBe(false);
  });

  it("keeps the bank route open with the kill switch off", () => {
    expect(
      isAddEntryPointOffered("bank", {
        orConnectBuildEnabled: false,
        stealthSyncEnabled: false,
      }),
    ).toBe(true);
  });

  it("names the route that still works in the refusal copy", () => {
    expect(BITCOIN_SOURCE_UNAVAILABLE_MESSAGE).toMatch(/temporarily unavailable/i);
    expect(BITCOIN_SOURCE_UNAVAILABLE_MESSAGE).toMatch(/bank/i);
  });
});

describe("the bank route cannot reach the source catalogue", () => {
  it("goes straight to the provider's bank page, so no stealth slug is reachable through it", async () => {
    const { buildBankPopupUrl } = await import("../bank-connect");

    const url = buildBankPopupUrl({
      quickConnect: {
        orPlatformUserId: "platform-user-1",
        widget_token: "widget-tok-abc",
        expires_at: "2026-01-01T00:00:00Z",
        quilttBundle: {
          session_token: "sess",
          connector_id: "conn",
          platform_slug: "plat",
          app_user_id: "app-user-1",
        },
      },
      credKeyB64: "Y3JlZA==",
      txnKeyB64: "dHhu",
    });

    const [path] = url.split("#");
    expect(path).toBe("https://connect.orangerails.com/connect/quiltt");
    // The catalogue lives at /connect with no provider named. This URL is
    // neither of those things, which is why the stealth gate does not apply
    // to it. The slow-path fallback in the same function names
    // provider=quiltt explicitly, so it does not reach the catalogue either.
    expect(path.endsWith("/connect")).toBe(false);
  });
});
