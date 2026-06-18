import { describe, it, expect } from "vitest";
import { generateRecoveryCode } from "../vault";

describe("generateRecoveryCode (post-entropy-fix)", () => {
  it("returns 12 space-separated words", async () => {
    const code = await generateRecoveryCode();
    const words = code.split(" ");
    expect(words).toHaveLength(12);
    words.forEach((w) => expect(w.length).toBeGreaterThan(0));
  });

  it("produces a different code on every call", async () => {
    const a = await generateRecoveryCode();
    const b = await generateRecoveryCode();
    const c = await generateRecoveryCode();
    expect(a).not.toBe(b);
    expect(b).not.toBe(c);
    expect(a).not.toBe(c);
  });

  it("samples uniformly across the alphabet (not clustered in a/b/c)", async () => {
    // Pre-fix: only 251 alphabetically-sorted words could appear, so 100
    // codes would yield words starting only with a/b/c. Post-fix the full
    // 7,776-word EFF list is used and we should see >15 distinct starting
    // letters across 100 × 12 = 1200 words.
    const firstLetters = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const code = await generateRecoveryCode();
      code.split(" ").forEach((w) => firstLetters.add(w[0].toLowerCase()));
    }
    expect(firstLetters.size).toBeGreaterThan(15);
  });
});
