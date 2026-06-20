import { describe, expect, it } from "vitest";
import {
  CURRENT_VAULT_KEY_VERSION,
  KEY_DERIVATION_STRATEGIES,
  type VaultKeyVersion,
} from "@/lib/vault";

/**
 * Stability rule for KEY_DERIVATION_STRATEGIES (see the STABILITY RULE
 * comment in vault.ts). Once a vault is written under a version, that
 * version's entry MUST remain in the registry forever, or every vault
 * stored under it can never unlock again. The registry currently has
 * one entry (v=1 = Argon2id). New versions append; old versions stay.
 *
 * This test is the runtime guard that makes the STABILITY RULE
 * comment load-bearing. If a future PR deletes v1 the unlock flow
 * still compiles (the type narrows fine), but this test fails loudly
 * and CI blocks the change.
 */
describe("vault key-derivation registry stability", () => {
  it("has an entry for every version up to and including the current one", () => {
    for (let v = 1; v <= CURRENT_VAULT_KEY_VERSION; v++) {
      const strategy = KEY_DERIVATION_STRATEGIES[v as VaultKeyVersion];
      expect(strategy, `missing strategy for vault_key_version=${v}`).toBeDefined();
      expect(typeof strategy.deriveMek).toBe("function");
      expect(typeof strategy.deriveMekRawBytes).toBe("function");
      expect(typeof strategy.wrapMekWithPassword).toBe("function");
      expect(typeof strategy.unwrapMekWithPassword).toBe("function");
    }
  });

  it("retains v=1 (the launch baseline Argon2id strategy)", () => {
    // v1 is the version every existing vault was written under. The
    // public launch wiped older test data, so no vault references v2
    // or v3 anymore, but v1 is now the load-bearing entry: removing
    // it would brick every production vault.
    expect(KEY_DERIVATION_STRATEGIES[1]).toBeDefined();
  });

  it("CURRENT_VAULT_KEY_VERSION resolves to a real strategy", () => {
    const current = KEY_DERIVATION_STRATEGIES[CURRENT_VAULT_KEY_VERSION];
    expect(current).toBeDefined();
    expect(typeof current.deriveMek).toBe("function");
  });
});
