/**
 * @vitest-environment node
 *
 * OWM-E0007 / DEV-0185: PR #812 (merged 2026-09-14) added a captureException
 * call at the end of pinOrKeyMaterial's retry loop. This file adds the
 * acceptance tests that were missing: that the call fires exactly once when
 * all three attempts are exhausted, that its payload never leaks key material,
 * and that it stays silent on a partial success.
 *
 * Tests run through resolveOrKeyMaterial (EMPTY_ROW, saltMatchesExistingRows
 * true, deferPinUntilProven false) -- the same path production unlock uses --
 * so the coverage reaches the real control flow. Fake timers drive the
 * [0, 200, 600] ms backoff inside pinOrKeyMaterial.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- mocks: declared before any dynamic import of VaultContext --------------

const captureException = vi.fn();
vi.mock("@/lib/observability/sentry", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, captureException };
});

const fromMock = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: fromMock },
}));

const deriveOrMekBytes = vi.fn();
const wrapOrMekWithVaultMek = vi.fn();
vi.mock("@/lib/vault", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, deriveOrMekBytes, wrapOrMekWithVaultMek };
});

// ---------------------------------------------------------------------------

const EMPTY_ROW = {
  enc_or_mek_ciphertext: null,
  or_subkey_salt: null,
  or_key_epoch: null,
};

/** Sentinel values that must never reach captureException (ZKA invariant). */
const TEST_USER_ID = "u-sentinel-abc123";
const TEST_SALT = "salt-sentinel-xyz789";
const WRAPPED_CIPHERTEXT = "wrapped-sentinel-aaabbbccc";

describe("VaultContext.pinOrKeyMaterial (exhausted-retry reporting)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    deriveOrMekBytes.mockResolvedValue(new Uint8Array([1, 2, 3, 4]));
    wrapOrMekWithVaultMek.mockResolvedValue(WRAPPED_CIPHERTEXT);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.resetModules();
  });

  /**
   * Reach pinOrKeyMaterial via the same derive-and-pin path production unlock
   * uses, then drain the fire-and-forget promise through the full
   * [0, 200, 600] ms backoff by running all fake timers.
   */
  async function resolveAndDrain() {
    const { resolveOrKeyMaterial } = await import("../VaultContext");
    const result = await resolveOrKeyMaterial({
      userId: TEST_USER_ID,
      password: "password",
      mek: {} as CryptoKey,
      row: EMPTY_ROW,
      kdfSalt: TEST_SALT,
      saltMatchesExistingRows: true,
      deferPinUntilProven: false,
    });
    // Drain the background pinOrKeyMaterial: advance all fake timers (the
    // 200 ms and 600 ms backoff sleeps) and flush the resulting microtasks.
    await vi.runAllTimersAsync();
    return result;
  }

  it("Case A: captureException called once with exactly { errorClass, attempts: 3 } after all writes fail", async () => {
    const updateEq = vi.fn().mockResolvedValue({ error: { message: "backend write error" } });
    fromMock.mockReturnValue({ update: vi.fn().mockReturnValue({ eq: updateEq }) });

    const result = await resolveAndDrain();

    // The key is returned immediately -- the write is fire-and-forget.
    expect(result.ok).toBe(true);

    expect(captureException).toHaveBeenCalledTimes(1);
    const [, opts] = captureException.mock.calls[0] as [
      unknown,
      { extra: Record<string, unknown> },
    ];
    expect(opts.extra).toEqual({
      errorClass: expect.any(String),
      attempts: 3,
    });
  });

  it("Case B: no sentinel value (userId, ciphertext, salt) appears in the captureException payload", async () => {
    const updateEq = vi.fn().mockResolvedValue({ error: { message: "backend write error" } });
    fromMock.mockReturnValue({ update: vi.fn().mockReturnValue({ eq: updateEq }) });

    await resolveAndDrain();

    expect(captureException).toHaveBeenCalledTimes(1);

    // ZKA invariant: the observability payload must never carry user identity,
    // sealed material, or the salt the key was derived under.
    const serialized = JSON.stringify(captureException.mock.calls[0]);
    expect(serialized).not.toContain(TEST_USER_ID);
    expect(serialized).not.toContain(WRAPPED_CIPHERTEXT);
    expect(serialized).not.toContain(TEST_SALT);
  });

  it("Case C: captureException not called when attempt 1 fails and attempt 2 succeeds", async () => {
    const updateEq = vi
      .fn()
      .mockResolvedValueOnce({ error: { message: "transient network error" } })
      .mockResolvedValueOnce({ error: null });
    fromMock.mockReturnValue({ update: vi.fn().mockReturnValue({ eq: updateEq }) });

    await resolveAndDrain();

    expect(captureException).not.toHaveBeenCalled();
  });
});
