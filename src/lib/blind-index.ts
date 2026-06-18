/**
 * blindIndexHmac — deterministic HMAC-SHA-256 of a normalized input,
 * used as a server-side equality search key for encrypted columns.
 * Matches the implementation in useAccounts.ts.
 */
export async function blindIndexHmac(input: string, hmacKey: CryptoKey): Promise<string> {
  const sig = await crypto.subtle.sign(
    "HMAC",
    hmacKey,
    new TextEncoder().encode(input.trim().toLowerCase()),
  );
  const bytes = new Uint8Array(sig);
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}
