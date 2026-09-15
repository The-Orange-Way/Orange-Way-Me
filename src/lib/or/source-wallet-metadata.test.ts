/**
 * OWM-T0770. Orange Rails seals source_wallets.encrypted_metadata under
 * whichever subkey the connect fragment handed it at write time -- creds if
 * no txn_key was sent, txns if it was. OWM-T0413 stopped sending txn_key, so
 * new rows are always creds-sealed, but rows written before that fix are
 * txns-sealed and were previously unreadable: ConnectionsPage.tsx decrypted
 * this field with the creds subkey only, so every txns-sealed row failed
 * its AES-GCM tag check, was swallowed by the catch, and rendered with a
 * blank currency and no label.
 *
 * These fixtures use plain fake decrypt functions rather than real AES-GCM,
 * because the two-key SELECTION logic is what regressed, not the cipher
 * itself: real encryption is already covered by the vault crypto tests.
 */
import { describe, expect, it, vi } from "vitest";

import { decryptSourceWalletMetadata } from "./source-wallet-metadata";

const REAL = { currency: "BTC", label: "Cold wallet" };
const CIPHER = "synthetic-cipher-b64";

function credsDecryptor(payload: unknown) {
  return vi.fn(async (cipherB64: string) => {
    if (cipherB64 !== CIPHER) throw new Error("wrong ciphertext");
    return JSON.stringify(payload);
  });
}

function alwaysFails(label: string) {
  return vi.fn(async () => {
    throw new Error(`${label} decrypt failed`);
  });
}

describe("decryptSourceWalletMetadata", () => {
  it("decrypts a row sealed under the transactions subkey via the fallback", async () => {
    const decryptCreds = alwaysFails("creds");
    const decryptTxns = credsDecryptor(REAL);

    const result = await decryptSourceWalletMetadata(CIPHER, decryptCreds, decryptTxns);

    expect(result).toEqual(REAL);
    expect(decryptCreds).toHaveBeenCalledTimes(1);
    expect(decryptTxns).toHaveBeenCalledTimes(1);
  });

  it("decrypts a row sealed under the credentials subkey on the first attempt, without reaching the txns fallback", async () => {
    const decryptCreds = credsDecryptor(REAL);
    const decryptTxns = alwaysFails("txns");

    const result = await decryptSourceWalletMetadata(CIPHER, decryptCreds, decryptTxns);

    expect(result).toEqual(REAL);
    expect(decryptCreds).toHaveBeenCalledTimes(1);
    expect(decryptTxns).not.toHaveBeenCalled();
  });

  it("degrades to a blank currency and null label when both subkeys fail, without throwing", async () => {
    const decryptCreds = alwaysFails("creds");
    const decryptTxns = alwaysFails("txns");

    const result = await decryptSourceWalletMetadata(CIPHER, decryptCreds, decryptTxns);

    expect(result).toEqual({ currency: "", label: null });
  });

  it("degrades to blank rather than throwing when the decrypted payload is not valid JSON", async () => {
    const decryptCreds = vi.fn(async () => "not json");
    const decryptTxns = alwaysFails("txns");

    const result = await decryptSourceWalletMetadata(CIPHER, decryptCreds, decryptTxns);

    expect(result).toEqual({ currency: "", label: null });
  });

  it("defaults currency to an empty string and label to null when the payload omits them", async () => {
    const decryptCreds = credsDecryptor({});
    const decryptTxns = alwaysFails("txns");

    const result = await decryptSourceWalletMetadata(CIPHER, decryptCreds, decryptTxns);

    expect(result).toEqual({ currency: "", label: null });
  });
});
