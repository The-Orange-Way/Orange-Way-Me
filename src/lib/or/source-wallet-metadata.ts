/**
 * Decrypts a source_wallets.encrypted_metadata blob, trying the credentials
 * subkey first and falling back to the transactions subkey (OWM-T0770).
 *
 * Orange Rails seals this field under whichever subkey the connect fragment
 * handed it: the transactions subkey when the fragment carried txn_key, the
 * credentials subkey when it did not. OWM-T0413 stopped sending txn_key, so
 * every new row is creds-sealed, but rows written before that fix are
 * txns-sealed and stay unreadable forever without this fallback. Both
 * subkeys already exist in the caller's unlocked vault (same pattern as the
 * stealth-row decrypt loop in ConnectionsPage.tsx), so the second attempt
 * discloses nothing new and only costs one failed AES-GCM tag check, on the
 * cold path where the first attempt already failed.
 */
export async function decryptSourceWalletMetadata(
  encryptedMetadata: string,
  decryptCreds: (cipherB64: string) => Promise<string>,
  decryptTxns: (cipherB64: string) => Promise<string>,
): Promise<{ currency: string; label: string | null }> {
  let json: string;
  try {
    json = await decryptCreds(encryptedMetadata);
  } catch {
    try {
      json = await decryptTxns(encryptedMetadata);
    } catch {
      return { currency: "", label: null };
    }
  }
  try {
    const parsed = JSON.parse(json) as { currency?: string; label?: string };
    return { currency: parsed.currency ?? "", label: parsed.label ?? null };
  } catch {
    return { currency: "", label: null };
  }
}
