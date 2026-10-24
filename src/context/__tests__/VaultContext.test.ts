/**
 * @vitest-environment node
 *
 * Ref DL-1571.
 *
 * planOrKeyMaterial's "refuse" mode on the unpinned recovery path is fully
 * covered in ../../lib/or/__tests__/or-key-material.test.ts. That planner is
 * a pure function: it returns a mode and touches no database. Nothing
 * asserted that resolveOrKeyMaterial, the ONE caller (VaultContext.tsx),
 * actually writes nothing to vault_metadata when the plan is "refuse".
 *
 * A future edit to VaultContext could reintroduce a write on the refuse
 * branch and every existing test would still pass. Deriving and pinning
 * under a freshly rotated, unpinned salt is the original DL-1506 defect: it
 * produces Orange Rails key material that opens nothing while looking like
 * success at every layer.
 *
 * supabase.from(...).update(...).eq(...) is mocked so any write is
 * observable. `mek` is a real, non-extractable AES-GCM CryptoKey from
 * Node's WebCrypto (not a stub object), and the second test wraps real
 * bytes with it, so that case is a genuine unwrap round trip rather than a
 * mocked "it returned ok:true".
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

if (typeof (globalThis as unknown as { window?: unknown }).window === "undefined") {
  (globalThis as unknown as { window: typeof globalThis }).window = globalThis;
}

const eqMock = vi.fn(() => Promise.resolve({ error: null }));
const updateMock = vi.fn(() => ({ eq: eqMock }));
const fromMock = vi.fn(() => ({ update: updateMock }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: fromMock },
}));

import { resolveOrKeyMaterial } from "../VaultContext";
import { wrapOrMekWithVaultMek, importMekFromRaw } from "@/lib/vault";
import { CURRENT_OR_KEY_EPOCH, type OrKeyMaterialRow } from "@/lib/or/or-key-material";

const EMPTY_ROW: OrKeyMaterialRow = {
  enc_or_mek_ciphertext: null,
  or_subkey_salt: null,
  or_key_epoch: null,
};

describe("resolveOrKeyMaterial, the untested caller of planOrKeyMaterial (DL-1571)", () => {
  beforeEach(() => {
    fromMock.mockClear();
    updateMock.mockClear();
    eqMock.mockClear();
  });

  it("writes nothing to vault_metadata when nothing is pinned and the salt has just rotated (unpinned recovery)", async () => {
    const mek = await importMekFromRaw(crypto.getRandomValues(new Uint8Array(32)));

    const result = await resolveOrKeyMaterial({
      userId: "user-1",
      password: "irrelevant-on-a-refusal",
      mek,
      row: EMPTY_ROW,
      kdfSalt: "brand-new-salt",
      saltMatchesExistingRows: false,
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a refusal");
    expect(result.reason).toMatch(/re-sync/i);

    // The assertion this ticket exists for.
    expect(fromMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
    expect(eqMock).not.toHaveBeenCalled();
  });

  it("still unwraps a genuinely pinned row after the same salt rotation, so the refusal above is not silencing a real recovery", async () => {
    const mek = await importMekFromRaw(crypto.getRandomValues(new Uint8Array(32)));
    const orMekBytes = crypto.getRandomValues(new Uint8Array(32));
    const ciphertext = await wrapOrMekWithVaultMek(orMekBytes, mek);
    const pinnedRow: OrKeyMaterialRow = {
      enc_or_mek_ciphertext: ciphertext,
      or_subkey_salt: "salt-at-pin-time",
      or_key_epoch: CURRENT_OR_KEY_EPOCH,
    };

    const result = await resolveOrKeyMaterial({
      userId: "user-1",
      password: "irrelevant-on-an-unwrap",
      mek,
      row: pinnedRow,
      kdfSalt: "brand-new-salt",
      saltMatchesExistingRows: false,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected an unwrap");
    expect(result.orMekBytes).toEqual(orMekBytes);

    // Unwrap never writes either: the pin already exists, there is nothing
    // new to persist.
    expect(fromMock).not.toHaveBeenCalled();
  });
});
