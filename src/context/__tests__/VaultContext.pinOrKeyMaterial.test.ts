/**
 * DEV-0185: on the FINAL pin-write failure only (every retry in
 * PIN_WRITE_BACKOFF_MS exhausted), pinOrKeyMaterial must call the app's
 * error reporter once, with a payload carrying no key material and no
 * vault secret.
 *
 * @/lib/vault is mocked in full rather than partially: pinOrKeyMaterial
 * only needs wrapOrMekWithVaultMek from it, and the rest of that module's
 * exports are real KDF/AEAD primitives this test has no reason to load.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const eqMock = vi.fn();
const updateMock = vi.fn(() => ({ eq: eqMock }));
const fromMock = vi.fn(() => ({ update: updateMock }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: fromMock },
}));

vi.mock("@/lib/observability/sentry", () => ({
  captureMessage: vi.fn(),
  captureException: vi.fn(),
}));

vi.mock("@/lib/vault", () => ({
  wrapOrMekWithVaultMek: vi.fn().mockResolvedValue("stub-ciphertext"),
}));

describe("pinOrKeyMaterial exhausted-retries report (DEV-0185)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reports once, with only a failure class and an attempt count, after every retry fails", async () => {
    eqMock.mockResolvedValue({
      error: { code: "42501", message: "permission denied for table vault_metadata" },
    });

    const { __testing } = await import("../VaultContext");
    const { captureMessage } = await import("@/lib/observability/sentry");

    await __testing.pinOrKeyMaterial({
      userId: "user-1",
      mek: {} as CryptoKey,
      orMekBytes: new Uint8Array([1, 2, 3]),
      saltContext: "salt-context-value",
      epoch: 1,
    });

    // Every attempt in the backoff table ran, and it kept retrying, not
    // giving up early.
    expect(eqMock).toHaveBeenCalledTimes(__testing.PIN_WRITE_BACKOFF_MS.length);

    // The reporter fires exactly once, not once per failed attempt.
    expect(captureMessage).toHaveBeenCalledTimes(1);

    const [name, context] = vi.mocked(captureMessage).mock.calls[0];
    expect(name).toBe("vault.or_pin_write_exhausted");

    // The payload is EXACTLY this shape: a failure class and an attempt
    // count. No userId, no saltContext, no ciphertext, no mek, nothing else.
    expect(context).toEqual({
      level: "error",
      extra: {
        failureClass: "permission_denied",
        attempts: __testing.PIN_WRITE_BACKOFF_MS.length,
      },
    });
  });

  it("does not report when a later attempt succeeds", async () => {
    eqMock
      .mockResolvedValueOnce({ error: { code: "40001", message: "serialization failure" } })
      .mockResolvedValueOnce({ error: null });

    const { __testing } = await import("../VaultContext");
    const { captureMessage } = await import("@/lib/observability/sentry");

    await __testing.pinOrKeyMaterial({
      userId: "user-1",
      mek: {} as CryptoKey,
      orMekBytes: new Uint8Array([1, 2, 3]),
      saltContext: "salt-context-value",
      epoch: 1,
    });

    expect(eqMock).toHaveBeenCalledTimes(2);
    expect(captureMessage).not.toHaveBeenCalled();
  });

  describe("classifyPinWriteFailure", () => {
    it.each([
      [{ code: "42501", message: "permission denied" }, "permission_denied"],
      [{ code: "23505", message: "duplicate key value violates unique constraint" }, "constraint"],
      [new TypeError("Failed to fetch"), "network"],
      [{ message: "Network request failed" }, "network"],
      [{ message: "something odd happened" }, "unknown"],
      [null, "unknown"],
    ])("classifies %j as %s", async (input, expected) => {
      const { __testing } = await import("../VaultContext");
      expect(__testing.classifyPinWriteFailure(input)).toBe(expected);
    });
  });
});
