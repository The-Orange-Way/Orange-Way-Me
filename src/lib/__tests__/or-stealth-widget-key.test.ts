/**
 * OR stealth-sync widget subkey derivation.
 *
 * The widget key is the fourth member of the OR subkey HKDF family
 * (IKM = OR MEK, salt "ow-or:" + userVaultSaltB64). These tests prove the
 * four properties that matter for it:
 *   1. it derives a usable AES-GCM key that round-trips;
 *   2. it is non-extractable (extractable=false, exportKey rejects), which
 *      is a deliberate divergence from the extractable siblings;
 *   3. it is domain-separated from the creds/txns siblings via a distinct
 *      HKDF info label, so a sibling's ciphertext cannot be opened by it;
 *   4. it regenerates deterministically from the same MEK+salt, so it
 *      survives lock/unlock with no separate storage.
 *
 * HKDF is deterministic and fast, so we derive straight off a fixed 32-byte
 * MEK and never pay the Argon2id cost. Node/WebCrypto glue matches the other
 * vault tests: point `window` at `globalThis` before importing vault.ts.
 */
import { describe, it, expect } from "vitest";

if (typeof (globalThis as unknown as { window?: unknown }).window === "undefined") {
  (globalThis as unknown as { window: typeof globalThis }).window = globalThis;
}

import {
  deriveOrStealthWidgetKeyFromMek,
  deriveOrCredsKeyFromMek,
  deriveOrTxnsKeyFromMek,
} from "@/lib/vault";

// A fixed, non-secret 32-byte "MEK" and a stored client salt. HKDF is
// deterministic, so these stand in for the real derived values.
const MEK = new Uint8Array(32);
for (let i = 0; i < 32; i++) MEK[i] = (i * 7 + 3) & 0xff;
const SALT_B64 = "dGVzdC12YXVsdC1zYWx0LTMyLWJ5dGVzLWZvci11bml0LXRlc3Q";

async function aesGcmEncrypt(key: CryptoKey, plaintext: string) {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ct = await globalThis.crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(plaintext),
  );
  return { iv, ct };
}

async function aesGcmDecrypt(key: CryptoKey, iv: Uint8Array, ct: ArrayBuffer) {
  const pt = await globalThis.crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  return new TextDecoder().decode(pt);
}

describe("OR stealth-sync widget key derivation", () => {
  it("derives a usable AES-GCM key that round-trips", async () => {
    const key = await deriveOrStealthWidgetKeyFromMek(MEK, SALT_B64);
    const { iv, ct } = await aesGcmEncrypt(key, "widget payload");
    const pt = await aesGcmDecrypt(key, iv, ct);
    expect(pt).toBe("widget payload");
  });

  it("is non-extractable: extractable=false and exportKey rejects", async () => {
    const key = await deriveOrStealthWidgetKeyFromMek(MEK, SALT_B64);
    expect(key.extractable).toBe(false);
    await expect(globalThis.crypto.subtle.exportKey("raw", key)).rejects.toBeDefined();
  });

  it("is domain-separated from the creds sibling (distinct info label)", async () => {
    const widget = await deriveOrStealthWidgetKeyFromMek(MEK, SALT_B64);
    const creds = await deriveOrCredsKeyFromMek(MEK, SALT_B64);
    // A ciphertext sealed with the creds key must NOT open under the widget
    // key. Same IKM and salt, different info => different key.
    const { iv, ct } = await aesGcmEncrypt(creds, "creds only");
    await expect(aesGcmDecrypt(widget, iv, ct)).rejects.toBeDefined();
  });

  it("is domain-separated from the txns sibling (distinct info label)", async () => {
    const widget = await deriveOrStealthWidgetKeyFromMek(MEK, SALT_B64);
    const txns = await deriveOrTxnsKeyFromMek(MEK, SALT_B64);
    const { iv, ct } = await aesGcmEncrypt(txns, "txns only");
    await expect(aesGcmDecrypt(widget, iv, ct)).rejects.toBeDefined();
  });

  it("regenerates deterministically from the same MEK+salt (survives unlock)", async () => {
    const first = await deriveOrStealthWidgetKeyFromMek(MEK, SALT_B64);
    const second = await deriveOrStealthWidgetKeyFromMek(MEK, SALT_B64);
    // "Close then reopen vault": encrypt with the first derivation, decrypt
    // with a freshly re-derived one. If the label/salt/IKM are stable, this
    // round-trips.
    const { iv, ct } = await aesGcmEncrypt(first, "survives reopen");
    const pt = await aesGcmDecrypt(second, iv, ct);
    expect(pt).toBe("survives reopen");
  });

  it("changes with the salt (per-user separation)", async () => {
    const key = await deriveOrStealthWidgetKeyFromMek(MEK, SALT_B64);
    const otherKey = await deriveOrStealthWidgetKeyFromMek(MEK, SALT_B64 + "x");
    const { iv, ct } = await aesGcmEncrypt(key, "user A");
    await expect(aesGcmDecrypt(otherKey, iv, ct)).rejects.toBeDefined();
  });
});
