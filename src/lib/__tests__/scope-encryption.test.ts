/**
 * Phase 4.2 — scope-aware encryption routing tests.
 *
 * Scope of these tests:
 *   1. Solo user (no household) — scope='personal' / 'household' /
 *      'author_only' all round-trip via the personal MEK. A warning
 *      fires for scope='household' because the DEK is unavailable.
 *   2. Household member — scope='household' uses the household DEK,
 *      scope='personal' uses the personal MEK, scope='author_only'
 *      uses the personal MEK (documented v1.5 TODO).
 *   3. unwrapHouseholdDek recovers the exact DEK bytes produced by
 *      the Phase 4.0 `wrapDataKeyForRecipients` primitive.
 *   4. Fallback: scope='household' with null DEK logs a warning AND
 *      still round-trips through the personal MEK (not a hard error).
 *
 * Node/WebCrypto glue: vault.ts reaches for `window.crypto` on some
 * code paths. Under the "node" vitest environment we don't have a
 * `window` global, so we point it at `globalThis` before importing
 * anything that may touch it. This matches the polyfill used in
 * `vault-keypair.test.ts`.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

if (typeof (globalThis as unknown as { window?: unknown }).window === "undefined") {
  (globalThis as unknown as { window: typeof globalThis }).window = globalThis;
}

import {
  encryptForScope,
  decryptForScope,
  unwrapHouseholdDek,
  type ScopeKeyBag,
} from "@/lib/scope-encryption";
import { generateHybridKemKeyPair } from "@/lib/pqc";
import { KEY_WRAP_STRATEGIES, DEFAULT_WRAP_ALGORITHM } from "@/lib/key-wrapping";

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------

async function importAesGcm(rawBytes: Uint8Array): Promise<CryptoKey> {
  return globalThis.crypto.subtle.importKey(
    "raw",
    rawBytes as BufferSource,
    { name: "AES-GCM" },
    /* extractable */ false,
    ["encrypt", "decrypt"],
  );
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

/**
 * Build a key bag for a solo user (no household). Personal MEK is
 * deterministic per label so tests can re-derive the same key to
 * simulate "close then reopen vault".
 */
async function soloKeys(label: string): Promise<ScopeKeyBag> {
  const personalBytes = new Uint8Array(32);
  const encoded = new TextEncoder().encode(label);
  for (let i = 0; i < 32; i++) {
    personalBytes[i] = (encoded[i % encoded.length] ^ (i * 7)) & 0xff;
  }
  return {
    personalMek: await importAesGcm(personalBytes),
    householdDek: null,
  };
}

/**
 * Build a key bag for a user in a household. Uses two independent
 * random AES keys — the real world produces the household DEK via
 * `crypto.getRandomValues` inside the Owner's invite flow.
 */
async function householdKeys(label: string): Promise<ScopeKeyBag> {
  const personalBytes = new Uint8Array(32);
  const householdBytes = new Uint8Array(32);
  const encoded = new TextEncoder().encode(label);
  for (let i = 0; i < 32; i++) {
    personalBytes[i] = (encoded[i % encoded.length] ^ (i * 7)) & 0xff;
    householdBytes[i] = (encoded[i % encoded.length] ^ (i * 11) ^ 0x5a) & 0xff;
  }
  return {
    personalMek: await importAesGcm(personalBytes),
    householdDek: await importAesGcm(householdBytes),
  };
}

// ---------------------------------------------------------------------------
// Tests.
// ---------------------------------------------------------------------------

describe("scope-encryption — solo user (no household)", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("scope='personal' round-trips via personal MEK", async () => {
    const keys = await soloKeys("solo-1");
    const ct = await encryptForScope("hello personal", "personal", keys);
    const pt = await decryptForScope(ct, "personal", keys);
    expect(pt).toBe("hello personal");
    // No fallback warning expected.
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("scope='household' falls back to personal MEK + warns", async () => {
    const keys = await soloKeys("solo-2");
    const ct = await encryptForScope("hello household", "household", keys);
    // encrypt warned.
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const pt = await decryptForScope(ct, "household", keys);
    // decrypt warned too — fallback fires on both sides.
    expect(warnSpy).toHaveBeenCalledTimes(2);
    expect(pt).toBe("hello household");
  });

  it("scope='author_only' routes to personal MEK (v1.5 TODO)", async () => {
    const keys = await soloKeys("solo-3");
    const ct = await encryptForScope("author secret", "author_only", keys);
    const pt = await decryptForScope(ct, "author_only", keys);
    expect(pt).toBe("author secret");
    // author_only does NOT emit a fallback warning — it's the
    // documented v1.5 path, not an accident.
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("author_only is currently equivalent to personal (same key, different ciphertext IV)", async () => {
    // Encrypt with personal, decrypt with author_only → works, because
    // both currently route to the personal MEK. Documents the 4.2
    // invariant that the future v1.5 re-wrap must break.
    const keys = await soloKeys("solo-4");
    const ct = await encryptForScope("same-key-check", "personal", keys);
    const pt = await decryptForScope(ct, "author_only", keys);
    expect(pt).toBe("same-key-check");
  });
});

describe("scope-encryption — household member", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("scope='household' uses the household DEK (not personal MEK)", async () => {
    const keys = await householdKeys("household-1");
    const ct = await encryptForScope("shared row", "household", keys);
    const pt = await decryptForScope(ct, "household", keys);
    expect(pt).toBe("shared row");
    // No fallback warning — DEK is available.
    expect(warnSpy).not.toHaveBeenCalled();

    // Sanity: attempting to decrypt the household ciphertext with the
    // personal MEK must fail. This confirms the DEK actually routed.
    await expect(decryptForScope(ct, "personal", keys)).rejects.toBeDefined();
  });

  it("scope='personal' still uses personal MEK even when DEK available", async () => {
    const keys = await householdKeys("household-2");
    const ct = await encryptForScope("my note", "personal", keys);
    const pt = await decryptForScope(ct, "personal", keys);
    expect(pt).toBe("my note");
    expect(warnSpy).not.toHaveBeenCalled();

    // Sanity: decrypting as household must fail.
    await expect(decryptForScope(ct, "household", keys)).rejects.toBeDefined();
  });

  it("scope='author_only' uses personal MEK (v1.5 TODO)", async () => {
    const keys = await householdKeys("household-3");
    const ct = await encryptForScope("my surprise", "author_only", keys);
    const pt = await decryptForScope(ct, "author_only", keys);
    expect(pt).toBe("my surprise");

    // Round-trip with personal MEK because author_only currently
    // routes there. Partner's household DEK won't decrypt it — same
    // semantic as the v1.5 design, different mechanism.
    const pt2 = await decryptForScope(ct, "personal", keys);
    expect(pt2).toBe("my surprise");

    // But the household DEK cannot open the row.
    await expect(decryptForScope(ct, "household", keys)).rejects.toBeDefined();
  });
});

describe("scope-encryption — unwrapHouseholdDek", () => {
  it("recovers a DEK wrapped by the Phase 4.0 key-wrapping primitive", async () => {
    const strategy = KEY_WRAP_STRATEGIES[DEFAULT_WRAP_ALGORITHM];
    expect(strategy).toBeDefined();

    // Member keypair.
    const kp = generateHybridKemKeyPair();

    // The "original" 32-byte household DEK the Owner generated.
    const rawDek = new Uint8Array(32);
    globalThis.crypto.getRandomValues(rawDek);

    // Wrap to the member (this is what 4.3's invite flow will do).
    const wrapped = await strategy.wrapForRecipient(rawDek, kp.publicKey);
    const wrappedB64 = bytesToBase64(wrapped);

    // Unwrap via the 4.2 consumer API.
    const dekKey = await unwrapHouseholdDek(kp.secretKey, wrappedB64);

    // Round-trip encrypt/decrypt with the recovered key.
    const keys: ScopeKeyBag = {
      personalMek: await importAesGcm(new Uint8Array(32)),
      householdDek: dekKey,
    };
    const ct = await encryptForScope("DEK round-trip", "household", keys);
    const pt = await decryptForScope(ct, "household", keys);
    expect(pt).toBe("DEK round-trip");

    // The recovered key must also decrypt a ciphertext produced by
    // the ORIGINAL raw DEK — byte-identical key material.
    const originalKey = await importAesGcm(rawDek);
    const keysWithOriginal: ScopeKeyBag = {
      personalMek: keys.personalMek,
      householdDek: originalKey,
    };
    const ct2 = await encryptForScope("same bytes", "household", keysWithOriginal);
    const pt2 = await decryptForScope(ct2, "household", keys);
    expect(pt2).toBe("same bytes");
  });

  it("throws on a tampered wrap (AEAD catches it)", async () => {
    const strategy = KEY_WRAP_STRATEGIES[DEFAULT_WRAP_ALGORITHM];
    const kp = generateHybridKemKeyPair();
    const rawDek = new Uint8Array(32);
    globalThis.crypto.getRandomValues(rawDek);

    const wrapped = await strategy.wrapForRecipient(rawDek, kp.publicKey);
    // Flip a byte deep in the AES-GCM ciphertext region so the tag
    // mismatches. Flipping the KEM ciphertext would only produce a
    // different (but still valid) shared secret — AEAD still catches
    // the resulting decryption, which is the point of the hybrid.
    const tampered = new Uint8Array(wrapped);
    tampered[tampered.length - 5] ^= 0x01;
    const tamperedB64 = bytesToBase64(tampered);

    await expect(unwrapHouseholdDek(kp.secretKey, tamperedB64)).rejects.toBeDefined();
  });
});
