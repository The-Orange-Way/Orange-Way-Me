import { beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_RETAINED_STRING } from "@/lib/or/proxy-errors";

const invoke = vi.fn();
const getSession = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getSession },
    functions: { invoke },
  },
}));

describe("useOrConnectionsList's callProxy", () => {
  beforeEach(() => {
    getSession.mockResolvedValue({ data: { session: { access_token: "t" } } });
  });

  it("does not join a non-scalar error array unbounded into the thrown message", async () => {
    invoke.mockResolvedValue({ data: { error: ["aaa", "bbb"] }, error: null });
    const { callProxy } = await import("./useOrConnectionsList");

    await expect(callProxy("or-connection-list", { subaccount_id: "x" })).rejects.toThrow(
      /^or-connection-list failed$/,
    );
    // Specifically must NOT be the old unbounded behaviour.
    await expect(
      callProxy("or-connection-list", { subaccount_id: "x" }).catch((e: Error) => e.message),
    ).resolves.not.toBe("aaa,bbb");
  });

  it("caps a long scalar error string at MAX_RETAINED_STRING", async () => {
    const long = "x".repeat(MAX_RETAINED_STRING * 3);
    invoke.mockResolvedValue({ data: { error: long }, error: null });
    const { callProxy } = await import("./useOrConnectionsList");

    const message = await callProxy("or-connection-list", { subaccount_id: "x" }).catch(
      (e: Error) => e.message,
    );
    expect((message as string).length).toBeLessThanOrEqual(MAX_RETAINED_STRING);
  });

  it("still throws the plain scalar message for a short string error", async () => {
    invoke.mockResolvedValue({ data: { error: "not found" }, error: null });
    const { callProxy } = await import("./useOrConnectionsList");

    await expect(callProxy("or-connection-list", { subaccount_id: "x" })).rejects.toThrow(
      "not found",
    );
  });
});
