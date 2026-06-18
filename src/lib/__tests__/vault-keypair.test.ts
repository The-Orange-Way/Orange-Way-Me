/**
 * Phase 4.1 — user_public_keys + vault_metadata.enc_private_key
 * lifecycle tests.
 *
 * Scope:
 *   1. `ensureUserKeypair` on first call INSERTs into user_public_keys
 *      and UPDATEs vault_metadata.enc_private_key.
 *   2. `ensureUserKeypair` on a second call is a no-op (idempotent).
 *   3. `rewrapUserKeypair` uses a single atomic UPDATE on
 *      vault_metadata and NEVER INSERTs or DELETEs a private-key row.
 *   4. After N=10 password changes, vault_metadata.enc_private_key
 *      UPDATE count = 10, INSERT count = 0, DELETE count = 0.
 *   5. Public key is byte-identical across every re-wrap — only the
 *      ciphertext of the private key changes.
 *
 * The Supabase client is stubbed with minimal in-memory tables
 * (`FakeTables`) that count every INSERT / UPDATE / DELETE on each of
 * the two tables separately so the test can assert per-table
 * invariants. The real Supabase schema types are not pulled in — the
 * 4.1 keypair module takes a narrow `SupabaseKeypairClient` interface
 * for exactly this reason.
 */

import { describe, it, expect, beforeEach } from "vitest";

// The vault crypto helpers (vault.ts) reach for `window.crypto` in
// some code paths. Under the "node" environment we run in, there is no
// `window`. Point it at `globalThis` so WebCrypto calls resolve to
// node's built-in implementation. This polyfill stays local to this
// test file.
if (typeof (globalThis as unknown as { window?: unknown }).window === "undefined") {
  (globalThis as unknown as { window: typeof globalThis }).window = globalThis;
}

import {
  ensureUserKeypair,
  rewrapUserKeypair,
  importMekForHkdf,
  type SupabaseKeypairClient,
} from "@/lib/vault-keypair";

// ---------------------------------------------------------------------------
// In-memory fake for user_public_keys + vault_metadata.
// ---------------------------------------------------------------------------

interface PublicKeyRow {
  user_id: string;
  public_key_b64: string;
  algorithm: string;
}

interface VaultMetadataRow {
  user_id: string;
  enc_private_key: string | null;
}

interface CallCounts {
  select: number;
  insert: number;
  update: number;
  delete: number;
}

class FakeTables {
  publicKeys: Map<string, PublicKeyRow> = new Map();
  vaultMetadata: Map<string, VaultMetadataRow> = new Map();
  publicKeyCalls: CallCounts = { select: 0, insert: 0, update: 0, delete: 0 };
  vaultMetadataCalls: CallCounts = { select: 0, insert: 0, update: 0, delete: 0 };

  /**
   * Seed a vault_metadata row — simulates the real-world state where
   * `createVault` has already run before the Phase 4.1 code path is
   * exercised. Without this seed the UPDATE in `ensureUserKeypair`
   * would hit "no row to update".
   */
  seedVaultMetadata(userId: string): void {
    this.vaultMetadata.set(userId, { user_id: userId, enc_private_key: null });
  }

  client(): SupabaseKeypairClient {
    // Capture `this` so the nested supabase-client mock can reach store fields
    // (chained from(...).select(...).eq(...) loses lexical `this`).
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const store = this;
    return {
      from(table) {
        if (table === "user_public_keys") {
          return {
            select(_columns: string) {
              return {
                eq(_col: "user_id", userId: string) {
                  return {
                    async maybeSingle() {
                      store.publicKeyCalls.select += 1;
                      const row = store.publicKeys.get(userId) ?? null;
                      return { data: row, error: null };
                    },
                  };
                },
              };
            },
            async insert(values: Record<string, unknown>) {
              store.publicKeyCalls.insert += 1;
              const user_id = values.user_id as string;
              if (store.publicKeys.has(user_id)) {
                return {
                  error: new Error("duplicate row — test invariant violated"),
                };
              }
              store.publicKeys.set(user_id, {
                user_id,
                public_key_b64: values.public_key_b64 as string,
                algorithm: (values.algorithm as string) ?? "x25519-mlkem768-v1",
              });
              return { error: null };
            },
            update(values: Record<string, unknown>) {
              return {
                async eq(_col: "user_id", userId: string) {
                  store.publicKeyCalls.update += 1;
                  const row = store.publicKeys.get(userId);
                  if (!row) {
                    return { error: new Error("no row to update") };
                  }
                  store.publicKeys.set(userId, {
                    ...row,
                    ...(values.public_key_b64 !== undefined
                      ? { public_key_b64: values.public_key_b64 as string }
                      : {}),
                    ...(values.algorithm !== undefined
                      ? { algorithm: values.algorithm as string }
                      : {}),
                  });
                  return { error: null };
                },
              };
            },
          };
        }
        if (table === "vault_metadata") {
          return {
            select(_columns: string) {
              return {
                eq(_col: "user_id", userId: string) {
                  return {
                    async maybeSingle() {
                      store.vaultMetadataCalls.select += 1;
                      const row = store.vaultMetadata.get(userId) ?? null;
                      return { data: row, error: null };
                    },
                  };
                },
              };
            },
            async insert(_values: Record<string, unknown>) {
              // Not expected on the 4.1 keypair path — counted so the
              // test can assert it stays at 0.
              store.vaultMetadataCalls.insert += 1;
              return {
                error: new Error("vault_metadata INSERT not expected from keypair lifecycle"),
              };
            },
            update(values: Record<string, unknown>) {
              return {
                async eq(_col: "user_id", userId: string) {
                  store.vaultMetadataCalls.update += 1;
                  const row = store.vaultMetadata.get(userId);
                  if (!row) {
                    return { error: new Error("no vault_metadata row") };
                  }
                  store.vaultMetadata.set(userId, {
                    ...row,
                    ...(values.enc_private_key !== undefined
                      ? { enc_private_key: values.enc_private_key as string }
                      : {}),
                  });
                  return { error: null };
                },
              };
            },
          };
        }
        throw new Error(`unexpected table in test stub: ${String(table)}`);
      },
    };
  }
}

// ---------------------------------------------------------------------------
// Test helpers.
// ---------------------------------------------------------------------------

const USER_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
// 32-byte base64 salt — must be non-empty for the HKDF subkey derivation.
const SALT_B64 = btoa(String.fromCharCode(...new Uint8Array(32).map((_, i) => i)));

/**
 * Build a distinct salt per label so the test can simulate the
 * real-world salt rotation on password change.
 */
function saltFor(label: string): string {
  const bytes = new Uint8Array(32);
  const encoded = new TextEncoder().encode(label);
  for (let i = 0; i < 32; i++) {
    bytes[i] = (encoded[i % encoded.length] ^ (i * 11)) & 0xff;
  }
  return btoa(String.fromCharCode(...bytes));
}

/**
 * Build a deterministic but distinct raw MEK per label so each test
 * case has identifiable key material.
 */
async function freshMek(label: string): Promise<CryptoKey> {
  const bytes = new Uint8Array(32);
  const encoded = new TextEncoder().encode(label);
  for (let i = 0; i < 32; i++) {
    bytes[i] = encoded[i % encoded.length] ^ (i * 7);
  }
  return importMekForHkdf(bytes);
}

// ---------------------------------------------------------------------------
// Tests.
// ---------------------------------------------------------------------------

describe("vault-keypair — ensureUserKeypair", () => {
  let store: FakeTables;

  beforeEach(() => {
    store = new FakeTables();
    store.seedVaultMetadata(USER_ID);
  });

  it("INSERTs user_public_keys and UPDATEs vault_metadata on first call", async () => {
    const mek = await freshMek("first-unlock");
    const res = await ensureUserKeypair({
      userId: USER_ID,
      mek,
      saltB64: SALT_B64,
      supabase: store.client(),
    });

    expect(res.generated).toBe(true);
    expect(store.publicKeys.size).toBe(1);
    expect(store.publicKeyCalls.insert).toBe(1);
    expect(store.vaultMetadataCalls.update).toBe(1);
    expect(store.vaultMetadataCalls.insert).toBe(0);

    const pkRow = store.publicKeys.get(USER_ID)!;
    expect(pkRow.algorithm).toBe("x25519-mlkem768-v1");
    // 1216 bytes → base64 length = ceil(1216/3)*4 = 1624.
    expect(pkRow.public_key_b64.length).toBe(1624);

    const vmRow = store.vaultMetadata.get(USER_ID)!;
    expect(vmRow.enc_private_key).toBeTypeOf("string");
    expect(vmRow.enc_private_key!.length).toBeGreaterThan(0);
  });

  it("is idempotent — second call is a no-op (no extra INSERT, no extra UPDATE)", async () => {
    const mek = await freshMek("first-unlock");
    await ensureUserKeypair({
      userId: USER_ID,
      mek,
      saltB64: SALT_B64,
      supabase: store.client(),
    });

    const insertsAfterFirst = store.publicKeyCalls.insert;
    const updatesAfterFirst = store.vaultMetadataCalls.update;

    const again = await ensureUserKeypair({
      userId: USER_ID,
      mek,
      saltB64: SALT_B64,
      supabase: store.client(),
    });

    expect(again.generated).toBe(false);
    expect(store.publicKeys.size).toBe(1);
    expect(store.publicKeyCalls.insert).toBe(insertsAfterFirst); // still 1
    expect(store.vaultMetadataCalls.update).toBe(updatesAfterFirst); // still 1
  });
});

describe("vault-keypair — rewrapUserKeypair", () => {
  let store: FakeTables;

  beforeEach(() => {
    store = new FakeTables();
    store.seedVaultMetadata(USER_ID);
  });

  it("no-ops if no enc_private_key yet (password change before first unlock)", async () => {
    const oldMek = await freshMek("old");
    const newMek = await freshMek("new");
    const res = await rewrapUserKeypair({
      userId: USER_ID,
      oldMek,
      newMek,
      oldSaltB64: SALT_B64,
      newSaltB64: SALT_B64,
      supabase: store.client(),
    });
    expect(res).toEqual({ rewrapped: false, reason: "no-row" });
    expect(store.vaultMetadataCalls.update).toBe(0);
    expect(store.vaultMetadataCalls.insert).toBe(0);
    expect(store.vaultMetadataCalls.delete).toBe(0);
  });

  it("single password change: UPDATE=1, no INSERT, no DELETE on vault_metadata", async () => {
    const mek = await freshMek("first-unlock");
    await ensureUserKeypair({
      userId: USER_ID,
      mek,
      saltB64: SALT_B64,
      supabase: store.client(),
    });

    // Reset counters so we measure only the rewrap step.
    const updatesAfterEnsure = store.vaultMetadataCalls.update;

    // The MEK bytes don't change on password change, but the
    // salt does — simulate that by passing distinct salts.
    const newSalt = saltFor("rotated-1");
    const res = await rewrapUserKeypair({
      userId: USER_ID,
      oldMek: mek,
      newMek: mek,
      oldSaltB64: SALT_B64,
      newSaltB64: newSalt,
      supabase: store.client(),
    });

    expect(res).toEqual({ rewrapped: true });
    expect(store.vaultMetadata.size).toBe(1);
    expect(store.vaultMetadataCalls.update).toBe(updatesAfterEnsure + 1);
    expect(store.vaultMetadataCalls.insert).toBe(0);
    expect(store.vaultMetadataCalls.delete).toBe(0);
    // The public-key row must not be touched on password change.
    expect(store.publicKeyCalls.insert).toBe(1); // only the initial insert
    expect(store.publicKeyCalls.update).toBe(0);
    expect(store.publicKeyCalls.delete).toBe(0);
  });

  it("after N=10 password changes, vault_metadata UPDATE=10, INSERT=0, DELETE=0", async () => {
    const mek = await freshMek("only-mek");
    await ensureUserKeypair({
      userId: USER_ID,
      mek,
      saltB64: SALT_B64,
      supabase: store.client(),
    });
    // Reset so we count only the password-change UPDATEs.
    const updatesBaseline = store.vaultMetadataCalls.update; // should be 1

    let currentSalt = SALT_B64;
    const N = 10;
    for (let i = 1; i <= N; i++) {
      const nextSalt = saltFor(`password-${i}`);
      const res = await rewrapUserKeypair({
        userId: USER_ID,
        oldMek: mek,
        newMek: mek,
        oldSaltB64: currentSalt,
        newSaltB64: nextSalt,
        supabase: store.client(),
      });
      expect(res).toEqual({ rewrapped: true });
      currentSalt = nextSalt;
    }

    expect(store.vaultMetadata.size).toBe(1);
    expect(store.vaultMetadataCalls.update - updatesBaseline).toBe(N); // 10
    expect(store.vaultMetadataCalls.insert).toBe(0);
    expect(store.vaultMetadataCalls.delete).toBe(0);
  });

  it("public key is unchanged across re-wraps; only private ciphertext differs", async () => {
    const mek = await freshMek("public-key-stability");
    await ensureUserKeypair({
      userId: USER_ID,
      mek,
      saltB64: SALT_B64,
      supabase: store.client(),
    });

    const pkBefore = store.publicKeys.get(USER_ID)!.public_key_b64;
    const cipherBefore = store.vaultMetadata.get(USER_ID)!.enc_private_key!;

    let currentSalt = SALT_B64;
    const seenCiphertexts = new Set<string>([cipherBefore]);

    for (let i = 1; i <= 5; i++) {
      const nextSalt = saltFor(`rotation-${i}`);
      await rewrapUserKeypair({
        userId: USER_ID,
        oldMek: mek,
        newMek: mek,
        oldSaltB64: currentSalt,
        newSaltB64: nextSalt,
        supabase: store.client(),
      });
      currentSalt = nextSalt;

      // Public key must not drift.
      expect(store.publicKeys.get(USER_ID)!.public_key_b64).toBe(pkBefore);

      // Private ciphertext must change every call (different IV at
      // minimum; different wrap key when the salt rotates).
      const cipherNow = store.vaultMetadata.get(USER_ID)!.enc_private_key!;
      expect(seenCiphertexts.has(cipherNow)).toBe(false);
      seenCiphertexts.add(cipherNow);
    }
  });
});
