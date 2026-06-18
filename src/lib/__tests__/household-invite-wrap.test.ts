/**
 * @vitest-environment node
 *
 * Phase 4.3 — household invite-wrap pipeline tests.
 *
 * Exercises the wrap/unwrap round-trip using the same hybrid-KEM
 * primitives the production household invite flow uses.
 */

import { describe, it, expect } from "vitest";

// Pure-crypto helpers look up `window.crypto`; node's test env exposes
// only `globalThis.crypto`. Alias once at module load so downstream
// imports resolve cleanly.
if (typeof (globalThis as unknown as { window?: unknown }).window === "undefined") {
  (globalThis as unknown as { window: typeof globalThis }).window = globalThis;
}

import {
  wrapHouseholdDekForRecipient,
  unwrapHouseholdDekForSelf,
  generatePlaceholderHouseholdDek,
  HOUSEHOLD_WRAP_ALGO,
} from "@/lib/household-invite-wrap";
import { generateHybridKemKeyPair } from "@/lib/pqc";

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

describe("generatePlaceholderHouseholdDek", () => {
  it("returns a 32-byte key", () => {
    const dek = generatePlaceholderHouseholdDek();
    expect(dek).toBeInstanceOf(Uint8Array);
    expect(dek.length).toBe(32);
  });

  it("returns distinct keys on each call", () => {
    const a = generatePlaceholderHouseholdDek();
    const b = generatePlaceholderHouseholdDek();
    expect(bytesToBase64(a)).not.toBe(bytesToBase64(b));
  });
});

describe("wrapHouseholdDekForRecipient", () => {
  it("produces a payload the recipient can unwrap back to the input DEK", async () => {
    const recipient = generateHybridKemKeyPair();
    const householdDek = generatePlaceholderHouseholdDek();

    const payload = await wrapHouseholdDekForRecipient(
      householdDek,
      bytesToBase64(recipient.publicKey),
    );

    expect(payload.wrap_algo).toBe(HOUSEHOLD_WRAP_ALGO);
    expect(typeof payload.enc_household_dek).toBe("string");

    const unwrapped = await unwrapHouseholdDekForSelf(
      payload.enc_household_dek,
      recipient.secretKey,
    );
    expect(bytesToBase64(unwrapped)).toBe(bytesToBase64(householdDek));
  });

  it("rejects a DEK that is not 32 bytes", async () => {
    const recipient = generateHybridKemKeyPair();
    const tooShort = new Uint8Array(16);
    crypto.getRandomValues(tooShort);
    await expect(
      wrapHouseholdDekForRecipient(tooShort, bytesToBase64(recipient.publicKey)),
    ).rejects.toThrow(/32 bytes/);
  });

  it("rejects a malformed base64 recipient public key", async () => {
    const householdDek = generatePlaceholderHouseholdDek();
    await expect(wrapHouseholdDekForRecipient(householdDek, "!!!not-base64!!!")).rejects.toThrow();
  });

  it("third party cannot unwrap a wrap intended for someone else", async () => {
    const intendedRecipient = generateHybridKemKeyPair();
    const eavesdropper = generateHybridKemKeyPair();
    const householdDek = generatePlaceholderHouseholdDek();

    const payload = await wrapHouseholdDekForRecipient(
      householdDek,
      bytesToBase64(intendedRecipient.publicKey),
    );

    await expect(
      unwrapHouseholdDekForSelf(payload.enc_household_dek, eavesdropper.secretKey),
    ).rejects.toThrow();
  });

  it("two wraps of the same DEK to the same recipient produce different ciphertexts", async () => {
    const recipient = generateHybridKemKeyPair();
    const householdDek = generatePlaceholderHouseholdDek();
    const a = await wrapHouseholdDekForRecipient(householdDek, bytesToBase64(recipient.publicKey));
    const b = await wrapHouseholdDekForRecipient(householdDek, bytesToBase64(recipient.publicKey));
    expect(a.enc_household_dek).not.toBe(b.enc_household_dek);

    // Both still unwrap to the same key.
    const ua = await unwrapHouseholdDekForSelf(a.enc_household_dek, recipient.secretKey);
    const ub = await unwrapHouseholdDekForSelf(b.enc_household_dek, recipient.secretKey);
    expect(bytesToBase64(ua)).toBe(bytesToBase64(householdDek));
    expect(bytesToBase64(ub)).toBe(bytesToBase64(householdDek));
  });

  it("wrap_algo string matches the DB migration default", async () => {
    const recipient = generateHybridKemKeyPair();
    const dek = generatePlaceholderHouseholdDek();
    const payload = await wrapHouseholdDekForRecipient(dek, bytesToBase64(recipient.publicKey));
    // The migration writes household_keys.wrap_algo default to this
    // exact underscored identifier; the edge functions reject anything
    // else. Lock the contract here so a typo can't drift unnoticed.
    expect(payload.wrap_algo).toBe("hybrid_x25519_mlkem768");
  });
});
