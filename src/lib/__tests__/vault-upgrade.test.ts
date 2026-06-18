import { describe, expect, it } from "vitest";
import {
  wrapMekWithPassword,
  unwrapMekWithPassword,
  wrapMekWithPasswordArgon2id,
  unwrapMekWithPasswordArgon2id,
  encryptText,
  decryptText,
  importMekFromRaw,
  randomBytesB64,
} from "@/lib/vault";

const toHex = (bytes: Uint8Array | ArrayBuffer): string => {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return Array.from(view, (b) => b.toString(16).padStart(2, "0")).join("");
};

describe("vault v2 → v3 upgrade", () => {
  it("preserves MEK identity across the upgrade", async () => {
    const password = "my-vault-pass-14c";
    const saltV2 = randomBytesB64(16);
    const mekOriginal = crypto.getRandomValues(new Uint8Array(32));

    // v2 vault on disk: MEK wrapped with PBKDF2-derived KEK.
    const wrappedV2 = await wrapMekWithPassword(
      mekOriginal.buffer as ArrayBuffer,
      password,
      saltV2,
    );

    // Upgrade sequence — unwrap with v2, then re-wrap with Argon2id + fresh salt.
    const unwrappedBytes = await unwrapMekWithPassword(wrappedV2, password, saltV2);
    expect(toHex(unwrappedBytes)).toBe(toHex(mekOriginal));

    const saltV3 = randomBytesB64(16);
    const wrappedV3 = await wrapMekWithPasswordArgon2id(
      unwrappedBytes.buffer as ArrayBuffer,
      password,
      saltV3,
    );

    // Post-upgrade unlock must yield the same MEK bytes.
    const recoveredBytes = await unwrapMekWithPasswordArgon2id(wrappedV3, password, saltV3);
    expect(toHex(recoveredBytes)).toBe(toHex(mekOriginal));
  });

  it("data encrypted pre-upgrade still decrypts post-upgrade (MEK unchanged)", async () => {
    const password = "vault-pass-14-char";
    const saltV2 = randomBytesB64(16);

    // Existing v2 vault: random MEK, encrypt a field.
    const mekBytes = crypto.getRandomValues(new Uint8Array(32));
    const mek = await importMekFromRaw(mekBytes);
    const secret = "account-name: Bitcoin Cold Storage";
    const ciphertext = await encryptText(secret, mek);

    const wrappedV2 = await wrapMekWithPassword(mekBytes.buffer as ArrayBuffer, password, saltV2);

    // Upgrade: unwrap v2, re-wrap v3.
    const recovered = await unwrapMekWithPassword(wrappedV2, password, saltV2);
    const saltV3 = randomBytesB64(16);
    const wrappedV3 = await wrapMekWithPasswordArgon2id(
      recovered.buffer as ArrayBuffer,
      password,
      saltV3,
    );

    // After upgrade, the unlock path derives the same MEK and decrypts old ciphertext.
    const mekBytesAfter = await unwrapMekWithPasswordArgon2id(wrappedV3, password, saltV3);
    const mekAfter = await importMekFromRaw(mekBytesAfter);
    const decrypted = await decryptText(ciphertext, mekAfter);
    expect(decrypted).toBe(secret);
  });

  it("upgrade fails fast if the current password is wrong", async () => {
    const saltV2 = randomBytesB64(16);
    const mek = crypto.getRandomValues(new Uint8Array(32));
    const wrappedV2 = await wrapMekWithPassword(
      mek.buffer as ArrayBuffer,
      "correct-pass-14cx",
      saltV2,
    );
    await expect(unwrapMekWithPassword(wrappedV2, "wrong-password-14", saltV2)).rejects.toThrow();
  });
});
