// @vitest-environment jsdom

import React from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VaultProvider, useVault } from "../VaultContext";

const mocks = vi.hoisted(() => ({
  decryptHmacKey: vi.fn(),
  decryptText: vi.fn(),
  deriveOrCredsKeyFromMek: vi.fn(),
  deriveOrMekBytes: vi.fn(),
  deriveOrOpkSeedFromMek: vi.fn(),
  deriveOrStealthWidgetKeyBytesFromMek: vi.fn(),
  deriveOrTxnsKeyFromMek: vi.fn(),
  ensureUserKeypair: vi.fn(),
  from: vi.fn(),
  getUser: vi.fn(),
  importMekForHkdf: vi.fn(),
  importMekFromRaw: vi.fn(),
  logSecurityEvent: vi.fn(),
  onAuthStateChange: vi.fn(),
  randomBytesB64: vi.fn(),
  rewrapUserKeypair: vi.fn(),
  unwrapMekWithPassword: vi.fn(),
  unwrapOrMekWithVaultMek: vi.fn(),
  wrapMekWithPassword: vi.fn(),
  wrapOrMekWithVaultMek: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getUser: mocks.getUser,
      onAuthStateChange: mocks.onAuthStateChange,
    },
    from: mocks.from,
  },
}));

vi.mock("@/lib/audit", () => ({
  logSecurityEvent: mocks.logSecurityEvent,
}));

vi.mock("@/lib/feature-flags", () => ({
  featureFlags: { phase44Public: false },
}));

vi.mock("@/lib/vault-keypair", () => ({
  ensureUserKeypair: mocks.ensureUserKeypair,
  importMekForHkdf: mocks.importMekForHkdf,
  rewrapUserKeypair: mocks.rewrapUserKeypair,
}));

vi.mock("@/lib/vault", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    KEY_DERIVATION_STRATEGIES: {
      1: {
        unwrapMekWithPassword: mocks.unwrapMekWithPassword,
        wrapMekWithPassword: mocks.wrapMekWithPassword,
      },
    },
    decryptHmacKey: mocks.decryptHmacKey,
    decryptText: mocks.decryptText,
    deriveOrCredsKeyFromMek: mocks.deriveOrCredsKeyFromMek,
    deriveOrMekBytes: mocks.deriveOrMekBytes,
    deriveOrOpkSeedFromMek: mocks.deriveOrOpkSeedFromMek,
    deriveOrStealthWidgetKeyBytesFromMek: mocks.deriveOrStealthWidgetKeyBytesFromMek,
    deriveOrTxnsKeyFromMek: mocks.deriveOrTxnsKeyFromMek,
    importMekFromRaw: mocks.importMekFromRaw,
    randomBytesB64: mocks.randomBytesB64,
    unwrapOrMekWithVaultMek: mocks.unwrapOrMekWithVaultMek,
    wrapOrMekWithVaultMek: mocks.wrapOrMekWithVaultMek,
  };
});

const USER_ID = "vault-provider-user";
const PINNED_ROW = {
  user_id: USER_ID,
  kdf_salt: "salt-at-pin-time",
  kdf_iterations: 600_000,
  verifier_ciphertext: "vault-verifier-ciphertext",
  hmac_salt: "hmac-salt",
  enc_mek_ciphertext: "wrapped-vault-mek",
  enc_hmac_key: "wrapped-hmac-key",
  vault_key_version: 1,
  enc_or_mek_ciphertext: "wrapped-or-mek",
  or_subkey_salt: "salt-at-pin-time",
  or_key_epoch: 1,
};

const updatePayloads: Record<string, unknown>[] = [];
let exposedVault: ReturnType<typeof useVault> | null = null;

function queryFor(table: string) {
  let selectedColumns = "";
  const query = {
    select: vi.fn((columns: string) => {
      selectedColumns = columns;
      return query;
    }),
    eq: vi.fn(() => query),
    order: vi.fn(() => query),
    limit: vi.fn(() => query),
    maybeSingle: vi.fn(async () => {
      if (table !== "vault_metadata") return { data: null, error: null };
      if (selectedColumns === "user_id,vault_key_version") {
        return {
          data: { user_id: USER_ID, vault_key_version: PINNED_ROW.vault_key_version },
          error: null,
        };
      }
      return { data: PINNED_ROW, error: null };
    }),
    update: vi.fn((payload: Record<string, unknown>) => {
      updatePayloads.push(payload);
      return query;
    }),
    then: (resolve: (value: { error: null }) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve({ error: null }).then(resolve, reject),
  };
  return query;
}

function captureVault(vault: ReturnType<typeof useVault>) {
  exposedVault = vault;
}

function VaultProbe({ onReady }: { onReady: (vault: ReturnType<typeof useVault>) => void }) {
  const vault = useVault();
  React.useEffect(() => onReady(vault), [onReady, vault]);
  return null;
}

function vaultHarness() {
  if (!exposedVault) throw new Error("VaultProvider did not expose its context");
  return exposedVault;
}

describe("VaultProvider callback harness", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updatePayloads.length = 0;
    exposedVault = null;

    mocks.getUser.mockResolvedValue({ data: { user: { id: USER_ID } } });
    mocks.onAuthStateChange.mockReturnValue({
      data: { subscription: { unsubscribe: vi.fn() } },
    });
    mocks.from.mockImplementation((table: string) => queryFor(table));

    const mekBytes = new Uint8Array([10, 20, 30, 40]);
    mocks.unwrapMekWithPassword.mockResolvedValue(mekBytes);
    mocks.wrapMekWithPassword.mockResolvedValue("rewrapped-vault-mek");
    mocks.importMekFromRaw.mockResolvedValue({ type: "secret", algorithm: { name: "AES-GCM" } });
    mocks.decryptText.mockResolvedValue("ORANGE_WAY_VAULT_V1");
    mocks.decryptHmacKey.mockResolvedValue({ type: "secret", algorithm: { name: "HMAC" } });
    mocks.unwrapOrMekWithVaultMek.mockResolvedValue(new Uint8Array([50, 60, 70, 80]));
    mocks.deriveOrMekBytes.mockResolvedValue(new Uint8Array([90, 100, 110, 120]));
    mocks.wrapOrMekWithVaultMek.mockResolvedValue("new-wrapped-or-mek");
    mocks.deriveOrCredsKeyFromMek.mockResolvedValue({ type: "secret" });
    mocks.deriveOrTxnsKeyFromMek.mockResolvedValue({ type: "secret" });
    mocks.deriveOrOpkSeedFromMek.mockResolvedValue(new Uint8Array([1]));
    mocks.deriveOrStealthWidgetKeyBytesFromMek.mockResolvedValue(new Uint8Array([2]));
    mocks.importMekForHkdf.mockResolvedValue({ type: "secret", algorithm: { name: "HKDF" } });
    mocks.ensureUserKeypair.mockResolvedValue({ generated: false });
    mocks.rewrapUserKeypair.mockResolvedValue(undefined);
    mocks.randomBytesB64.mockReturnValue("rotated-kdf-salt");
  });

  afterEach(() => {
    cleanup();
  });

  it("omits every Orange Rails pin column when a fully pinned vault changes password", async () => {
    await act(async () => {
      render(
        <VaultProvider>
          <VaultProbe onReady={captureVault} />
        </VaultProvider>,
      );
    });

    await act(async () => {
      await vaultHarness().unlock("current-password");
    });
    await act(async () => {
      await vaultHarness().changeVaultPassword("current-password", "new-password");
    });

    const passwordChangePayload = updatePayloads.find(
      (payload) => payload.enc_mek_ciphertext === "rewrapped-vault-mek",
    );

    expect(passwordChangePayload).toEqual({
      kdf_salt: "rotated-kdf-salt",
      kdf_iterations: 600_000,
      enc_mek_ciphertext: "rewrapped-vault-mek",
      vault_key_version: 1,
    });
    expect(passwordChangePayload).not.toHaveProperty("or_subkey_salt");
    expect(passwordChangePayload).not.toHaveProperty("or_key_epoch");
    expect(passwordChangePayload).not.toHaveProperty("enc_or_mek_ciphertext");
  });
});
