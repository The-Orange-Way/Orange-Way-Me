import { describe, expect, it } from "vitest";
import { generatePassphrase, preloadWordlist, EFF_WORDLIST_SIZE } from "../passphrase";
import words from "@/assets/eff-wordlist.json";

describe("eff-wordlist.json", () => {
  it("contains exactly 7,776 entries (EFF Large Wordlist parity)", () => {
    expect(Array.isArray(words)).toBe(true);
    expect(words.length).toBe(EFF_WORDLIST_SIZE);
    expect(EFF_WORDLIST_SIZE).toBe(7776);
  });

  it("entries are non-empty unique lowercase ASCII strings", () => {
    // EFF Large Wordlist is overwhelmingly [a-z]+, with four exceptions that
    // contain a single internal hyphen: drop-down, felt-tip, t-shirt, yo-yo.
    const seen = new Set<string>();
    for (const w of words as string[]) {
      expect(typeof w).toBe("string");
      expect(w.length).toBeGreaterThan(0);
      expect(/^[a-z]+(-[a-z]+)?$/.test(w)).toBe(true);
      seen.add(w);
    }
    expect(seen.size).toBe(words.length);
  });
});

describe("generatePassphrase", () => {
  it("resolves via dynamic import and returns 6 space-separated words by default", async () => {
    const { phrase, entropyBits } = await generatePassphrase();
    const tokens = phrase.split(" ");
    expect(tokens).toHaveLength(6);
    expect(entropyBits).toBe(78);
    const set = new Set(words as string[]);
    for (const t of tokens) {
      expect(set.has(t)).toBe(true);
    }
  });

  it("honours custom word counts and reports proportional entropy", async () => {
    const { phrase, entropyBits } = await generatePassphrase(8);
    expect(phrase.split(" ")).toHaveLength(8);
    expect(entropyBits).toBe(103);
  });

  it("produces non-deterministic output across calls", async () => {
    const a = await generatePassphrase(6);
    const b = await generatePassphrase(6);
    expect(a.phrase).not.toBe(b.phrase);
  });

  it("preloadWordlist returns a frozen array of the right size", async () => {
    const arr = await preloadWordlist();
    expect(arr.length).toBe(EFF_WORDLIST_SIZE);
    expect(Object.isFrozen(arr)).toBe(true);
  });
});
