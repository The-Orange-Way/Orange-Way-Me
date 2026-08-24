/**
 * Entropy guards for the 12-word recovery code.
 *
 * This app has already shipped this bug once. An earlier generator could
 * only ever emit 251 of the wordlist's entries, which turned a code
 * advertised at ~155 bits into roughly 96. The existing recovery-code test
 * checks the shape of the output and one coarse symptom of that specific
 * regression; these check the property that was actually violated, and the
 * source the code is drawn from.
 *
 * This matters more here than in most places because deriveRecoveryKek
 * treats the code as a high-entropy secret. It runs PBKDF2, but a work
 * factor is a multiplier on the entropy underneath it, not a replacement
 * for it. If the generator narrows again, nothing else in the system
 * notices and the output still looks exactly like a recovery code.
 *
 * Bounds are set so a correct generator fails less than about once in ten
 * million runs.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { generateRecoveryCode } from "../vault";
import wordlist from "@/assets/eff-wordlist.json";

const WORDS = wordlist as string[];
const N = 7776;
const CODES = 1500;
const WORDS_PER_CODE = 12;
const DRAWS = CODES * WORDS_PER_CODE;

const INDEX_OF = new Map(WORDS.map((w, i) => [w, i]));

async function drawIndices(): Promise<number[]> {
  const out: number[] = [];
  for (let i = 0; i < CODES; i++) {
    for (const w of (await generateRecoveryCode()).split(" ")) {
      const idx = INDEX_OF.get(w);
      expect(idx, `generated word "${w}" is not in the wordlist`).toBeDefined();
      out.push(idx as number);
    }
  }
  return out;
}

describe("recovery code wordlist", () => {
  it("is the full 7,776-entry EFF large wordlist with no repeats", () => {
    expect(WORDS).toHaveLength(N);
    expect(new Set(WORDS).size).toBe(N);
  });
});

describe("recovery code entropy", () => {
  it("emits 12 words per code, every time", async () => {
    for (let i = 0; i < 30; i++) {
      expect((await generateRecoveryCode()).split(" ")).toHaveLength(WORDS_PER_CODE);
    }
  });

  it("reaches the whole wordlist, not a low-index prefix", async () => {
    const idx = await drawIndices();

    // The shipped regression capped the index at 250. With 18,000 uniform
    // draws over 7,776 buckets, never seeing the top or bottom 200 is
    // indistinguishable from impossible.
    expect(Math.max(...idx)).toBeGreaterThan(N - 200);
    expect(Math.min(...idx)).toBeLessThan(200);

    // Coupon-collector over 7,776 buckets with 18,000 draws: ~7,000 distinct.
    expect(new Set(idx).size).toBeGreaterThan(6500);
  });

  it("is uniform across the wordlist (chi-square, 7775 df)", async () => {
    const counts = new Array<number>(N).fill(0);
    for (const i of await drawIndices()) counts[i]++;

    const expected = DRAWS / N;
    let chi = 0;
    for (const c of counts) chi += (c - expected) ** 2 / expected;

    const df = N - 1;
    const sd = Math.sqrt(2 * df);
    expect(chi).toBeGreaterThan(df - 6 * sd);
    expect(chi).toBeLessThan(df + 6 * sd);
  });

  it("does not repeat a code", async () => {
    const codes = new Set<string>();
    for (let i = 0; i < 500; i++) codes.add(await generateRecoveryCode());
    expect(codes.size).toBe(500);
  });
});

/**
 * Distribution tests alone cannot catch a swap to Math.random, because
 * Math.random is uniform. It is predictable rather than skewed, so every
 * statistic above stays healthy while the code becomes guessable from a
 * few observed outputs. Weak-RNG failures in hardware wallets have this
 * shape. Pin the source as well as the histogram.
 */
describe("recovery code randomness source", () => {
  afterEach(() => vi.restoreAllMocks());

  it("draws from crypto.getRandomValues", async () => {
    const spy = vi.spyOn(globalThis.crypto, "getRandomValues");
    await generateRecoveryCode();
    expect(spy).toHaveBeenCalled();
    expect(spy.mock.results[0].value).toBeInstanceOf(Uint32Array);
  });

  it("never consults Math.random", async () => {
    const spy = vi.spyOn(Math, "random");
    for (let i = 0; i < 20; i++) await generateRecoveryCode();
    expect(spy).not.toHaveBeenCalled();
  });

  it("maps CSPRNG output to words and nothing else (known answer)", async () => {
    vi.spyOn(globalThis.crypto, "getRandomValues").mockImplementation(((buf: Uint32Array) => {
      for (let i = 0; i < buf.length; i++) buf[i] = i;
      return buf;
    }) as typeof globalThis.crypto.getRandomValues);
    expect((await generateRecoveryCode()).split(" ")).toEqual(WORDS.slice(0, WORDS_PER_CODE));
  });

  it("rejects out-of-range draws instead of folding them (no modulo bias)", async () => {
    // max is the largest multiple of 7,776 below 2^32. A draw at or above
    // it must be discarded and re-rolled, not reduced. Feed one rejectable
    // value followed by zeros: if rejection works the code is all first-word,
    // if the generator folded the bad draw the first word differs.
    const max = Math.floor(0x100000000 / N) * N;
    let call = 0;
    vi.spyOn(globalThis.crypto, "getRandomValues").mockImplementation(((buf: Uint32Array) => {
      buf.fill(0);
      if (call === 0) buf[0] = max; // exactly at the rejection threshold
      call++;
      return buf;
    }) as typeof globalThis.crypto.getRandomValues);

    const words = (await generateRecoveryCode()).split(" ");
    expect(words).toHaveLength(WORDS_PER_CODE);
    expect(new Set(words).size).toBe(1);
    expect(words[0]).toBe(WORDS[0]);
    // A rejection happened, so it needed more than one draw.
    expect(call).toBeGreaterThan(1);
  });
});
