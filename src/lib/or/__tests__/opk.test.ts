import { describe, it, expect } from "vitest";
import { opkKeypairFromSeed, opkSealOpen, opkSealForTest, OPK_ALG } from "../opk";

describe("OPK sealed-box round trip", () => {
  it("derives a deterministic keypair from a seed", async () => {
    const seed = new Uint8Array(32).fill(7);
    const a = await opkKeypairFromSeed(seed);
    const b = await opkKeypairFromSeed(seed);
    expect(a.publicKeyB64).toBe(b.publicKeyB64);
    expect(a.publicKey.length).toBe(32);
    expect(a.secretKey.length).toBe(32);
  });

  it("different seeds yield different keypairs", async () => {
    const a = await opkKeypairFromSeed(new Uint8Array(32).fill(1));
    const b = await opkKeypairFromSeed(new Uint8Array(32).fill(2));
    expect(a.publicKeyB64).not.toBe(b.publicKeyB64);
  });

  it("opens a sealed box sealed to its public key (mirrors OR's crypto_box_seal)", async () => {
    const kp = await opkKeypairFromSeed(new Uint8Array(32).fill(42));
    const msg = JSON.stringify({ amount: "12.34", merchant: "Mercury", date: "2026-06-10" });
    const sealed = await opkSealForTest(msg, kp.publicKey);
    const opened = await opkSealOpen(sealed, kp);
    expect(opened).toBe(msg);
  });

  it("fails to open a box sealed to a different keypair", async () => {
    const kp1 = await opkKeypairFromSeed(new Uint8Array(32).fill(3));
    const kp2 = await opkKeypairFromSeed(new Uint8Array(32).fill(4));
    const sealed = await opkSealForTest("secret", kp1.publicKey);
    await expect(opkSealOpen(sealed, kp2)).rejects.toThrow();
  });

  it("rejects a 31-byte seed", async () => {
    await expect(opkKeypairFromSeed(new Uint8Array(31))).rejects.toThrow(/32 bytes/);
  });

  it("alg id matches OR's expected opk_alg", () => {
    expect(OPK_ALG).toBe("libsodium-crypto_box_seal-v1");
  });
});
