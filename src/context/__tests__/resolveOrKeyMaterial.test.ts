/**
 * @vitest-environment node
 *
 * DEV-0070: resolveOrKeyMaterial is the CALLER that decides whether to write
 * the three Orange Rails key-material columns, based on the plan that
 * planOrKeyMaterial (tested in ../../lib/or/__tests__/or-key-material.test.ts)
 * returns. That planner suite proves the PLAN is "refuse" on an unpinned row
 * under a freshly rotated salt (the recovery case, DL-1506). It never asserted
 * that the caller then actually writes nothing -- that gap is what this file
 * closes.
 *
 * unwrapOrMekWithVaultMek / deriveOrMekBytes / wrapOrMekWithVaultMek are the
 * only "@/lib/vault" exports resolveOrKeyMaterial's own body touches, so those
 * three are mocked and everything else in the module is left real via
 * importOriginal. Supabase is mocked because pinOrKeyMaterial (invoked only on
 * a non-refuse plan) would otherwise reach a real client that does not exist
 * in this environment.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CURRENT_OR_KEY_EPOCH } from "@/lib/or/or-key-material";

const fromMock = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: fromMock },
}));

const unwrapOrMekWithVaultMek = vi.fn();
const deriveOrMekBytes = vi.fn();
const wrapOrMekWithVaultMek = vi.fn();

vi.mock("@/lib/vault", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    unwrapOrMekWithVaultMek,
    deriveOrMekBytes,
    wrapOrMekWithVaultMek,
  };
});

const EMPTY_ROW = {
  enc_or_mek_ciphertext: null,
  or_subkey_salt: null,
  or_key_epoch: null,
};

describe("resolveOrKeyMaterial (VaultContext's OR key-material caller)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetModules();
  });

  it("writes none of the three OR columns when nothing is pinned and the salt has just rotated", async () => {
    const { resolveOrKeyMaterial } = await import("../VaultContext");
    const updateMock = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) });
    fromMock.mockReturnValue({ update: updateMock });

    const result = await resolveOrKeyMaterial({
      userId: "user-1",
      password: "new-password-after-recovery",
      mek: {} as CryptoKey,
      row: EMPTY_ROW,
      kdfSalt: "brand-new-salt-minted-by-recovery",
      saltMatchesExistingRows: false,
    });

    // (2) no key material at all comes back on the refuse path.
    expect(result.ok).toBe(false);
    expect("orMekBytes" in result).toBe(false);

    // Nothing derived, nothing wrapped: there are no bytes in memory a later
    // branch could accidentally seal or persist.
    expect(deriveOrMekBytes).not.toHaveBeenCalled();
    expect(unwrapOrMekWithVaultMek).not.toHaveBeenCalled();
    expect(wrapOrMekWithVaultMek).not.toHaveBeenCalled();

    // pinOrKeyMaterial fires fire-and-forget (`void`, not awaited) only on a
    // non-refuse plan. Flush one microtask/macrotask turn so a regression that
    // re-introduced the call would have had the chance to reach supabase.from
    // before we assert on it.
    await new Promise((resolve) => setTimeout(resolve, 0));

    // (1) the actual assertion the ticket is about: no update call anywhere
    // carries any of the three OR columns. Checked on the PAYLOAD'S KEYS, so a
    // write of an explicit null still fails this the same as a write of a
    // real value would.
    const forbiddenKeys = ["enc_or_mek_ciphertext", "or_subkey_salt", "or_key_epoch"];
    for (const call of updateMock.mock.calls) {
      const payload = call[0] as Record<string, unknown>;
      for (const key of forbiddenKeys) {
        expect(
          key in payload,
          `refuse path must not write "${key}", but an update call had it: ${JSON.stringify(payload)}`,
        ).toBe(false);
      }
    }
  });

  it("names the reason so the disabled-namespace path is diagnosable, not silent", async () => {
    const { resolveOrKeyMaterial } = await import("../VaultContext");
    fromMock.mockReturnValue({ update: vi.fn() });

    const result = await resolveOrKeyMaterial({
      userId: "user-1",
      password: "new-password-after-recovery",
      mek: {} as CryptoKey,
      row: EMPTY_ROW,
      kdfSalt: "brand-new-salt-minted-by-recovery",
      saltMatchesExistingRows: false,
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toMatch(/re-sync/i);
  });

  /**
   * The control case. A pinned row recovers normally even though the salt
   * rotated, because the pinned blob is sealed under the vault MEK and
   * recovery reaches that MEK through the recovery code. If this test ever
   * fails alongside the refuse-path test above passing, the fix traded a
   * silent data loss for a loud, unnecessary lockout instead of fixing
   * anything.
   */
  it("still unwraps and returns key material for a pinned row under a rotated salt", async () => {
    const { resolveOrKeyMaterial } = await import("../VaultContext");
    const updateEq = vi.fn().mockResolvedValue({ error: null });
    fromMock.mockReturnValue({ update: vi.fn().mockReturnValue({ eq: updateEq }) });
    unwrapOrMekWithVaultMek.mockResolvedValue(new Uint8Array([1, 2, 3, 4]));

    const result = await resolveOrKeyMaterial({
      userId: "user-1",
      password: "new-password-after-recovery",
      mek: {} as CryptoKey,
      row: {
        enc_or_mek_ciphertext: "sealed-blob",
        or_subkey_salt: "salt-at-pin-time",
        or_key_epoch: 1,
      },
      kdfSalt: "brand-new-salt-minted-by-recovery",
      saltMatchesExistingRows: false,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.orMekBytes).toEqual(new Uint8Array([1, 2, 3, 4]));
    expect(unwrapOrMekWithVaultMek).toHaveBeenCalledWith("sealed-blob", expect.anything());
    // Unwrap does not re-pin: the row already carries the current pin, so
    // pinOrKeyMaterial is never reached on this path either.
    expect(deriveOrMekBytes).not.toHaveBeenCalled();
    expect(wrapOrMekWithVaultMek).not.toHaveBeenCalled();
  });
});
