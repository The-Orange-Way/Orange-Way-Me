// Passphrase generator using the EFF Large Wordlist (7,776 words).
// The wordlist itself lives in src/assets/eff-wordlist.json and is loaded
// via dynamic import so it is split into its own chunk and kept out of the
// main bundle. log2(7776) ≈ 12.925 bits/word, so 6 words ≈ 77.5 bits entropy.
//
// ZKA invariant: the returned phrase is only ever used as user-facing
// passphrase input (e.g. into createVault). We do not log or transmit it.

export const EFF_WORDLIST_SIZE = 7776;

let cachedWords: readonly string[] | null = null;

async function loadWords(): Promise<readonly string[]> {
  if (cachedWords) return cachedWords;
  const mod = await import("@/assets/eff-wordlist.json");
  const words = (mod.default ?? mod) as string[];
  if (!Array.isArray(words) || words.length !== EFF_WORDLIST_SIZE) {
    throw new Error(
      `EFF wordlist integrity check failed: expected ${EFF_WORDLIST_SIZE} words, got ${
        Array.isArray(words) ? words.length : typeof words
      }`,
    );
  }
  cachedWords = Object.freeze(words.slice());
  return cachedWords;
}

/**
 * Eagerly fetch the wordlist chunk. Optional — callers can also just await
 * generatePassphrase directly. Useful to prime the chunk on hover/focus
 * before the user clicks "generate".
 */
export function preloadWordlist(): Promise<readonly string[]> {
  return loadWords();
}

export async function generatePassphrase(
  numWords = 6,
): Promise<{ phrase: string; entropyBits: number }> {
  const words = await loadWords();
  const n = words.length;
  const bitsPerWord = Math.log2(n);
  // Rejection sampling. Same pattern as generateRecoveryCode in vault.ts.
  // Direct `random % n` introduces a small modulo bias (n = 7776 is not a
  // power of 2). Draw a 32-bit uint and reject any value that falls in the
  // bias zone above `floor(2^32 / n) * n`, redraw until we get one that
  // doesn't. Loss-of-entropy on rejection is zero by construction.
  const limit = Math.floor(0x1_00000000 / n) * n; // ≈ 4.294e9, divisible by n
  const out: string[] = [];
  while (out.length < numWords) {
    // Draw a generous batch each round to amortize getRandomValues overhead.
    const batch = new Uint32Array(numWords * 2);
    crypto.getRandomValues(batch);
    for (let i = 0; i < batch.length && out.length < numWords; i++) {
      if (batch[i] < limit) out.push(words[batch[i] % n]);
    }
  }
  return {
    phrase: out.join(" "),
    entropyBits: Math.round(numWords * bitsPerWord),
  };
}
