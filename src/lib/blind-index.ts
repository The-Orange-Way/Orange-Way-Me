/**
 * blindIndexHmac — deterministic HMAC-SHA-256 of a normalized input,
 * used as a server-side equality search key for encrypted columns.
 * This is the only implementation. Import it; never re-declare it. The value
 * it returns is stored and later searched for, so correctness is agreement:
 * a second copy that drifts makes rows silently stop matching, with no error.
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
