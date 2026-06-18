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
  // Unbiased selection: draw a 32-bit uint per word and modulo into range.
  // The tiny modulo bias (n is not a power of 2) is negligible at this
  // wordlist size — entropy delta < 0.01 bit.
  const buf = new Uint32Array(numWords);
  crypto.getRandomValues(buf);
  const out: string[] = [];
  for (let i = 0; i < numWords; i++) {
    out.push(words[buf[i] % n]);
  }
  return {
    phrase: out.join(" "),
    entropyBits: Math.round(numWords * bitsPerWord),
  };
}
