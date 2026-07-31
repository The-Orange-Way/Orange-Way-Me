import { describe, expect, it } from "vitest";
import {
  createVaultEnvelope,
  unwrapVaultEnvelope,
  addSlotToEnvelope,
  VAULT_ENVELOPE_VERSION,
  V4_ARGON2ID_PARALLELISM,
} from "@/lib/vault-envelope";

const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

const PW = "correct-horse-battery-staple";

describe("vault envelope v4 (AES-KW)", () => {
  it("round-trips: unwrap returns the same MEK that create produced", async () => {
    const { envelope, mekRawBytes } = await createVaultEnvelope(PW);
    expect(envelope.v).toBe(VAULT_ENVELOPE_VERSION);
    expect(envelope.epoch).toBe(0);
    expect(envelope.slots).toHaveLength(1);
    expect(mekRawBytes).toHaveLength(32);

    const recovered = await unwrapVaultEnvelope(envelope, PW);
    expect(toHex(recovered)).toBe(toHex(mekRawBytes));
  });

  it("records the locked Argon2id parallelism (1) on the slot", async () => {
    const { envelope } = await createVaultEnvelope(PW);
    expect(envelope.slots[0].par).toBe(V4_ARGON2ID_PARALLELISM);
    expect(envelope.slots[0].par).toBe(1);
    // AES-KW of a 32-byte key is 40 bytes -> ceil(40/3)*4 = 56 base64 chars.
    expect(atob(envelope.slots[0].wrapped)).toHaveLength(40);
  });

  it("throws on the wrong password (no verifier, KW integrity is the check)", async () => {
    const { envelope } = await createVaultEnvelope(PW);
    await expect(unwrapVaultEnvelope(envelope, "totally-wrong-pw-14c")).rejects.toThrow();
  });

  it("throws when the wrapped bytes are tampered", async () => {
    const { envelope } = await createVaultEnvelope(PW);
    const wrapped = atob(envelope.slots[0].wrapped);
    const bytes = Uint8Array.from(wrapped, (c) => c.charCodeAt(0));
    bytes[0] ^= 0xff; // flip a byte in the wrapper
    let bin = "";
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    envelope.slots[0].wrapped = btoa(bin);
    await expect(unwrapVaultEnvelope(envelope, PW)).rejects.toThrow();
  });

  it("multi-slot: two passwords over one MEK unwrap to byte-identical key material", async () => {
    const { envelope, mekRawBytes } = await createVaultEnvelope(PW);
    const SECOND_PW = "second-device-pass-14c";
    const two = await addSlotToEnvelope(envelope, mekRawBytes, "device-2", SECOND_PW);

    expect(two.slots).toHaveLength(2);
    // Different salts -> the wrappers differ on the wire...
    expect(two.slots[0].wrapped).not.toBe(two.slots[1].wrapped);

    // ...but both open to the exact same MEK.
    const viaFirst = await unwrapVaultEnvelope(two, PW);
    const viaSecond = await unwrapVaultEnvelope(two, SECOND_PW);
    expect(toHex(viaFirst)).toBe(toHex(mekRawBytes));
    expect(toHex(viaSecond)).toBe(toHex(mekRawBytes));
    expect(toHex(viaFirst)).toBe(toHex(viaSecond));
  });

  it("adding a slot does not bump the epoch (MEK unchanged)", async () => {
    const { envelope, mekRawBytes } = await createVaultEnvelope(PW);
    const two = await addSlotToEnvelope(
      envelope,
      mekRawBytes,
      "device-2",
      "second-device-pass-14c",
    );
    expect(two.epoch).toBe(0);
  });

  it("refuses a duplicate slot id", async () => {
    const { envelope, mekRawBytes } = await createVaultEnvelope(PW);
    await expect(
      addSlotToEnvelope(envelope, mekRawBytes, "primary", "another-pass-14c"),
    ).rejects.toThrow();
  });
});
