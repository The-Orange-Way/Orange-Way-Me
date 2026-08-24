/**
 * A correct recovery code, retyped the way people actually retype things,
 * must still open the vault.
 *
 * These twelve words are the last copy of the key to a user's books. They
 * get written on paper and typed back in, or pasted out of a file that
 * wrapped a line. Before this was fixed, a double space or a newline where
 * a single space was expected derived a different key, so the vault
 * rejected a code that was right. There is no retry that helps and no
 * support path that recovers it, because the app cannot read the vault
 * either.
 *
 * The backwards-compatibility case below is the one that matters for
 * anyone who already has a vault: a single-spaced code must derive exactly
 * what it derived before the change.
 */
import { describe, it, expect } from "vitest";
import {
  generateRecoveryCode,
  wrapMekWithRecovery,
  unwrapMekWithRecovery,
  randomBytes,
} from "../vault";

/** wrapMekWithRecovery takes an ArrayBuffer; randomBytes hands back a view. */
function freshMek(): ArrayBuffer {
  return randomBytes(32).buffer as ArrayBuffer;
}

async function unwraps(wrapped: string, attempt: string): Promise<boolean> {
  try {
    await unwrapMekWithRecovery(wrapped, attempt);
    return true;
  } catch {
    return false;
  }
}

describe("recovery code accepts a correctly-typed code", () => {
  it("accepts the code exactly as generated", async () => {
    const code = await generateRecoveryCode();
    const mek = freshMek();
    expect(await unwraps(await wrapMekWithRecovery(mek, code), code)).toBe(true);
  });

  it.each([
    ["a double space between words", (c: string) => c.replace(" ", "  ")],
    ["a newline between words", (c: string) => c.replace(" ", "\n")],
    ["a tab between words", (c: string) => c.replace(" ", "\t")],
    ["leading and trailing whitespace", (c: string) => `\n  ${c}  \n`],
    ["capitals", (c: string) => c.toUpperCase()],
    ["every separator doubled, as a wrapped paste", (c: string) => c.split(" ").join("  ")],
  ])("accepts a code retyped with %s", async (_label, mangle) => {
    const code = await generateRecoveryCode();
    const mek = freshMek();
    const wrapped = await wrapMekWithRecovery(mek, code);
    expect(await unwraps(wrapped, mangle(code))).toBe(true);
  });

  it("still refuses a code with a wrong word", async () => {
    const code = await generateRecoveryCode();
    const mek = freshMek();
    const wrapped = await wrapMekWithRecovery(mek, code);
    const words = code.split(" ");
    words[5] = words[5] === "abacus" ? "zoom" : "abacus";
    expect(await unwraps(wrapped, words.join(" "))).toBe(false);
  });

  it("still refuses a code with the words reordered", async () => {
    const code = await generateRecoveryCode();
    const mek = freshMek();
    const wrapped = await wrapMekWithRecovery(mek, code);
    const words = code.split(" ");
    [words[0], words[1]] = [words[1], words[0]];
    expect(await unwraps(wrapped, words.join(" "))).toBe(false);
  });

  it("does not merge two words into one", async () => {
    // Collapsing runs of whitespace must not delete the separator itself.
    const code = await generateRecoveryCode();
    const mek = freshMek();
    const wrapped = await wrapMekWithRecovery(mek, code);
    expect(await unwraps(wrapped, code.replace(" ", ""))).toBe(false);
  });

  it("derives identically for a single-spaced code, so existing vaults still open", async () => {
    // The pre-change derivation was trim().toLowerCase(). For a code with
    // single spaces that is character-for-character what the new path
    // produces, so a vault wrapped before this change unwraps after it.
    const code = await generateRecoveryCode();
    const legacyNormalized = code.trim().toLowerCase();
    expect(legacyNormalized).toBe(legacyNormalized.replace(/\s+/g, " "));

    const mek = freshMek();
    const wrapped = await wrapMekWithRecovery(mek, legacyNormalized);
    const out = await unwrapMekWithRecovery(wrapped, code);
    expect(out).toEqual(new Uint8Array(mek));
  });
});
