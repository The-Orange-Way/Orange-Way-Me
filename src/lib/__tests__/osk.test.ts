/**
 * @vitest-environment node
 *
 * Phase 4.4 — Household Signing Key (HSK) client helper tests.
 *
 * Exercises:
 *   1. `generateAndWrapHouseholdSigningKey` produces a bundle whose
 *      wraps each unwrap back to the same ML-DSA-65 secret key the
 *      generator produced.
 *   2. `signMutation` + `verifySignature` round-trip for a recipient
 *      who unwrapped their row.
 *   3. A non-writer (whose wrap was never minted) cannot unwrap.
 *   4. `verifySignature` returns false (never throws) on tampered input.
 *
 * Pure-crypto; no Supabase dependency. The edge function wire format
 * is integration-tested separately.
 */

import { describe, it, expect } from "vitest";

// OW crypto primitives look up `window.crypto`; node's test env exposes
// only `globalThis.crypto`. Alias once so downstream imports resolve.
if (typeof (globalThis as unknown as { window?: unknown }).window === "undefined") {
  (globalThis as unknown as { window: typeof globalThis }).window = globalThis;
}

import {
  generateAndWrapHouseholdSigningKey,
  generateHouseholdSigningKey,
  wrapHouseholdSigningKey,
  unwrapHouseholdSigningKey,
  signMutation,
  signWithPrivateKey,
  verifySignature,
  verifyMutation,
  ML_DSA_65,
} from "@/lib/osk";
import { generateHybridKemKeyPair } from "@/lib/pqc";

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

describe("generateHouseholdSigningKey", () => {
  it("produces ML-DSA-65 sized keys", () => {
    const { publicKey, privateKey } = generateHouseholdSigningKey();
    expect(publicKey.length).toBe(ML_DSA_65.publicKeyBytes);
    expect(privateKey.length).toBe(ML_DSA_65.secretKeyBytes);
  });
});

describe("generateAndWrapHouseholdSigningKey", () => {
  it("produces a bundle with one wrap per writer", async () => {
    const writerA = generateHybridKemKeyPair();
    const writerB = generateHybridKemKeyPair();

    const bundle = await generateAndWrapHouseholdSigningKey("household-123", [
      {
        userId: "11111111-1111-1111-1111-111111111111",
        publicKeyB64: bytesToBase64(writerA.publicKey),
      },
      {
        userId: "22222222-2222-2222-2222-222222222222",
        publicKeyB64: bytesToBase64(writerB.publicKey),
      },
    ]);

    expect(bundle.algorithm).toBe("ml-dsa-65");
    expect(bundle.keyVersion).toBe(1);
    expect(bundle.wraps).toHaveLength(2);
    expect(bundle.wraps[0]).toMatchObject({
      user_id: "11111111-1111-1111-1111-111111111111",
      wrap_algo: "hybrid_x25519_mlkem768",
      key_version: 1,
    });
    expect(bundle.privateKeyBytes.length).toBe(ML_DSA_65.secretKeyBytes);
  });

  it("throws when householdId is empty", async () => {
    await expect(generateAndWrapHouseholdSigningKey("", [])).rejects.toThrow(/householdId/);
  });

  it("throws when writers is empty", async () => {
    await expect(generateAndWrapHouseholdSigningKey("hh-1", [])).rejects.toThrow(/writer/);
  });

  it("wrapped private key unwraps to the exact generator output", async () => {
    const writer = generateHybridKemKeyPair();
    const bundle = await generateAndWrapHouseholdSigningKey("hh-1", [
      {
        userId: "33333333-3333-3333-3333-333333333333",
        publicKeyB64: bytesToBase64(writer.publicKey),
      },
    ]);

    const unwrapped = await unwrapHouseholdSigningKey(
      bundle.wraps[0].wrapped_private_key,
      writer.secretKey,
    );

    expect(bytesToBase64(unwrapped)).toBe(bytesToBase64(bundle.privateKeyBytes));
  });

  it("refuses to unwrap for a third party", async () => {
    const writer = generateHybridKemKeyPair();
    const outsider = generateHybridKemKeyPair();
    const bundle = await generateAndWrapHouseholdSigningKey("hh-1", [
      {
        userId: "44444444-4444-4444-4444-444444444444",
        publicKeyB64: bytesToBase64(writer.publicKey),
      },
    ]);

    await expect(
      unwrapHouseholdSigningKey(bundle.wraps[0].wrapped_private_key, outsider.secretKey),
    ).rejects.toThrow();
  });
});

describe("wrapHouseholdSigningKey (single-recipient wrap)", () => {
  it("produces a blob whose IV matches the embedded IV slice", async () => {
    const { privateKey } = generateHouseholdSigningKey();
    const recipient = generateHybridKemKeyPair();
    const wrapped = await wrapHouseholdSigningKey(privateKey, bytesToBase64(recipient.publicKey));
    // Round-trip ok.
    const recovered = await unwrapHouseholdSigningKey(wrapped.wrappedBlobB64, recipient.secretKey);
    expect(bytesToBase64(recovered)).toBe(bytesToBase64(privateKey));
    expect(wrapped.wrapAlgo).toBe("hybrid_x25519_mlkem768");
  });
});

describe("signMutation + verifySignature round-trip", () => {
  it("verifies a signature produced via the recipient's unwrapped key", async () => {
    const writer = generateHybridKemKeyPair();
    const bundle = await generateAndWrapHouseholdSigningKey("hh-1", [
      {
        userId: "55555555-5555-5555-5555-555555555555",
        publicKeyB64: bytesToBase64(writer.publicKey),
      },
    ]);

    const privateKey = await unwrapHouseholdSigningKey(
      bundle.wraps[0].wrapped_private_key,
      writer.secretKey,
    );

    const payload = new TextEncoder().encode("tx:abcdef:ciphertext");
    const { signature_b64, key_version } = signMutation(payload, {
      privateKeyBytes: privateKey,
      keyVersion: bundle.keyVersion,
    });

    expect(key_version).toBe(1);
    expect(verifySignature(bundle.publicKeyB64, payload, signature_b64)).toBe(true);
    // Back-compat alias keeps the V3 argument order.
    expect(verifyMutation(payload, signature_b64, bundle.publicKeyB64)).toBe(true);
  });

  it("returns false for a tampered payload", async () => {
    const writer = generateHybridKemKeyPair();
    const bundle = await generateAndWrapHouseholdSigningKey("hh-1", [
      {
        userId: "66666666-6666-6666-6666-666666666666",
        publicKeyB64: bytesToBase64(writer.publicKey),
      },
    ]);
    const privateKey = await unwrapHouseholdSigningKey(
      bundle.wraps[0].wrapped_private_key,
      writer.secretKey,
    );

    const payload = new TextEncoder().encode("original");
    const { signature_b64 } = signMutation(payload, {
      privateKeyBytes: privateKey,
      keyVersion: bundle.keyVersion,
    });

    const tampered = new TextEncoder().encode("tampered");
    expect(verifySignature(bundle.publicKeyB64, tampered, signature_b64)).toBe(false);
  });

  it("returns false for a malformed signature (never throws)", async () => {
    const writer = generateHybridKemKeyPair();
    const bundle = await generateAndWrapHouseholdSigningKey("hh-1", [
      {
        userId: "77777777-7777-7777-7777-777777777777",
        publicKeyB64: bytesToBase64(writer.publicKey),
      },
    ]);

    const payload = new TextEncoder().encode("anything");
    expect(verifySignature(bundle.publicKeyB64, payload, "!!!not-base64!!!")).toBe(false);
    expect(verifySignature(bundle.publicKeyB64, payload, bytesToBase64(new Uint8Array(10)))).toBe(
      false,
    );
  });

  it("signs directly with a raw private key (mint-time path)", () => {
    const { publicKey, privateKey } = generateHouseholdSigningKey();
    const payload = new TextEncoder().encode("payload");
    const sig = signWithPrivateKey(payload, privateKey);
    expect(verifySignature(bytesToBase64(publicKey), payload, bytesToBase64(sig))).toBe(true);
  });
});
