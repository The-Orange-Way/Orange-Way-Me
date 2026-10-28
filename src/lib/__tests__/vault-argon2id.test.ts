import { describe, expect, it } from "vitest";
import {
  deriveMekArgon2id,
  deriveMekRawBytesArgon2id,
  wrapMekWithPasswordArgon2id,
  unwrapMekWithPasswordArgon2id,
  encryptText,
  decryptText,
  randomBytesB64,
  buildVaultAad,
} from "@/lib/vault";

/** These tests are about the argon2id KDF, not about binding, so one AAD serves them all. */
const AAD = buildVaultAad({
  table: "vault_metadata",
  column: "enc_mek_ciphertext",
  rowId: "00000000-0000-4000-8000-000000000001",
});

const toHex = (bytes: Uint8Array | ArrayBuffer): string => {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return Array.from(view, (b) => b.toString(16).padStart(2, "0")).join("");
};

describe("vault argon2id (v1)", () => {
  it("derives a working AES-256-GCM key that round-trips text", async () => {
    const salt = randomBytesB64(16);
    const key = await deriveMekArgon2id("correct-horse-battery-staple", salt);
    const ct = await encryptText("hello world", key);
    const pt = await decryptText(ct, key);
    expect(pt).toBe("hello world");
  });

  it("same password + salt yields identical raw key material", async () => {
    const salt = randomBytesB64(16);
    const a = await deriveMekRawBytesArgon2id("password-strong-14c", salt);
    const b = await deriveMekRawBytesArgon2id("password-strong-14c", salt);
    expect(toHex(a)).toBe(toHex(b));
  });

  it("different passwords produce different raw keys", async () => {
    const salt = randomBytesB64(16);
    const a = await deriveMekRawBytesArgon2id("password-strong-14c", salt);
    const b = await deriveMekRawBytesArgon2id("DIFFERENT-pass-14c", salt);
    expect(toHex(a)).not.toBe(toHex(b));
  });

  it("different salts produce different raw keys for the same password", async () => {
    const a = await deriveMekRawBytesArgon2id("password-strong-14c", randomBytesB64(16));
    const b = await deriveMekRawBytesArgon2id("password-strong-14c", randomBytesB64(16));
    expect(toHex(a)).not.toBe(toHex(b));
  });

  it("wrap + unwrap round-trips MEK bytes", async () => {
    const salt = randomBytesB64(16);
    const password = "correct-horse-battery-staple";
    const mek = crypto.getRandomValues(new Uint8Array(32));
    const wrapped = await wrapMekWithPasswordArgon2id(
      mek.buffer as ArrayBuffer,
      password,
      salt,
      AAD,
    );
    const recovered = await unwrapMekWithPasswordArgon2id(wrapped, password, salt, AAD);
    expect(toHex(recovered)).toBe(toHex(mek));
  });

  it("unwrap fails with the wrong password", async () => {
    const salt = randomBytesB64(16);
    const mek = crypto.getRandomValues(new Uint8Array(32));
    const wrapped = await wrapMekWithPasswordArgon2id(
      mek.buffer as ArrayBuffer,
      "correct-horse-battery-staple",
      salt,
      AAD,
    );
    await expect(
      unwrapMekWithPasswordArgon2id(wrapped, "wrong-password-14c", salt, AAD),
    ).rejects.toThrow();
  });
});
