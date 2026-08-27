/**
 * @vitest-environment node
 *
 * Covers the CALLER of planOrKeyMaterial, not the planner itself (that is
 * ../../lib/or/__tests__/or-key-material.test.ts). See DEV-0070.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const eqMock = vi.fn().mockResolvedValue({ error: null });
const updateMock = vi.fn(() => ({ eq: eqMock }));
const fromMock = vi.fn(() => ({ update: updateMock }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: fromMock },
}));

vi.mock("@/lib/audit", () => ({
  logSecurityEvent: vi.fn(),
}));

import { resolveOrKeyMaterial } from "../VaultContext";
import { CURRENT_OR_KEY_EPOCH, type OrKeyMaterialRow } from "@/lib/or/or-key-material";
import { importMekFromRaw, wrapOrMekWithVaultMek } from "@/lib/vault";

const EMPTY: OrKeyMaterialRow = {
  enc_or_mek_ciphertext: null,
  or_subkey_salt: null,
  or_key_epoch: null,
};

async function makeMek(): Promise<CryptoKey> {
  const raw = crypto.getRandomValues(new Uint8Array(32));
  return importMekFromRaw(raw);
}

beforeEach(() => {
  fromMock.mockClear();
  updateMock.mockClear();
  eqMock.mockClear();
});

describe("resolveOrKeyMaterial (VaultContext caller of planOrKeyMaterial)", () => {
  /**
   * The assertion this ticket exists for. Recovery mints a new salt before
   * asking for key material; when nothing was ever pinned, planOrKeyMaterial
   * refuses (see or-key-material.test.ts: "refuses when nothing is pinned
   * and the salt has just rotated"). resolveOrKeyMaterial must turn that
   * refusal into "return ok:false" and touch vault_metadata NOT AT ALL -
   * never derive-and-write a key that would open nothing while looking like
   * a success.
   */
  it("writes nothing to vault_metadata when recovery refuses an unpinned row", async () => {
    const mek = await makeMek();

    const result = await resolveOrKeyMaterial({
      userId: "user-1",
      password: "irrelevant-on-the-refuse-path",
      mek,
      row: EMPTY,
      kdfSalt: "brand-new-salt-from-recovery",
      saltMatchesExistingRows: false,
    });

    expect(result.ok).toBe(false);

    // Any pin write on this path would be fire-and-forget, not awaited by
    // resolveOrKeyMaterial (see the doc comment on that call site). Give it
    // a macrotask tick to land before asserting it never started.
    await new Promise((resolve) => setTimeout(resolve, 50));

    // The whole point: no table was ever touched.
    expect(fromMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
    expect(eqMock).not.toHaveBeenCalled();
  });

  /**
   * Proves the assertion above is a real guard and not a tautology: if the
   * write path recorded here had reached vault_metadata directly (the shape
   * a regression would take, since pinOrKeyMaterial calls the exact same
   * vaultTable().update(...).eq(...) chain this test mocks), the mock
   * would have recorded it and the test above would fail. This does not
   * call resolveOrKeyMaterial a second time; it exercises the identical
   * mocked chain the way a regression in pinOrKeyMaterial would, so a
   * reviewer can see the failure the first test is built to catch.
   */
  it("the mock actually detects a write, so the assertion above is not vacuous", async () => {
    await fromMock("vault_metadata").update({
      enc_or_mek_ciphertext: "would-be-wrong",
      or_subkey_salt: "brand-new-salt-from-recovery",
      or_key_epoch: CURRENT_OR_KEY_EPOCH,
    }).eq("user_id", "user-1");

    expect(fromMock).toHaveBeenCalledWith("vault_metadata");
    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(eqMock).toHaveBeenCalledTimes(1);
  });

  /**
   * The case that must keep working. A pinned row recovers normally even
   * after the salt rotates, because it unwraps the sealed blob under the
   * MEK recovery reaches through the recovery code; it does not re-derive.
   * unwrap never calls pinOrKeyMaterial, so this must also write nothing.
   */
  it("still unwraps a pinned row on the same rotated-salt recovery, and still writes nothing", async () => {
    const mek = await makeMek();
    const orMekBytes = crypto.getRandomValues(new Uint8Array(32));
    const ciphertext = await wrapOrMekWithVaultMek(orMekBytes, mek);

    const pinned: OrKeyMaterialRow = {
      enc_or_mek_ciphertext: ciphertext,
      or_subkey_salt: "salt-at-pin-time",
      or_key_epoch: CURRENT_OR_KEY_EPOCH,
    };

    const result = await resolveOrKeyMaterial({
      userId: "user-1",
      password: "irrelevant-on-the-unwrap-path",
      mek,
      row: pinned,
      kdfSalt: "brand-new-salt-from-recovery",
      saltMatchesExistingRows: false,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.orMekBytes).toEqual(orMekBytes);
    }
    expect(fromMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
  });
});
