/**
 * @vitest-environment node
 *
 * OWM-T0263. See the file header above (commit message) for why this is a
 * source-text assertion rather than a behavioural test: recoverWithCode is a
 * useCallback reachable only through useVault(), and this repo has no
 * React-render test infrastructure to drive it directly.
 *
 * This test reads the real production file and fails if the resolveOrKeyMaterial
 * call inside recoverWithCode stops passing a literal `saltMatchesExistingRows: false`.
 * It is intentionally brittle to a refactor that renames or restructures the call --
 * that is the tradeoff accepted for this ticket; the stronger fix (giving recovery
 * its own entry point that cannot express `true`) is tracked separately as it is a
 * production change.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const VAULT_CONTEXT_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "VaultContext.tsx",
);

/**
 * Extracts the body of `recoverWithCode` from the raw source, then the
 * `resolveOrKeyMaterial({...})` call inside it, by tracking brace depth
 * rather than regexing across the whole file. Throws with a clear message
 * if either anchor cannot be found, so a rename fails loudly here instead
 * of the assertion below silently matching nothing.
 */
function extractResolveCallInsideRecoverWithCode(source: string): string {
  const fnAnchor = "const recoverWithCode = useCallback(async (recoveryCode";
  const fnStart = source.indexOf(fnAnchor);
  if (fnStart === -1) {
    throw new Error(
      "Could not find 'const recoverWithCode = useCallback(async (recoveryCode' in VaultContext.tsx. " +
        "recoverWithCode was renamed or restructured; update this test's anchor to match.",
    );
  }

  // Walk from fnStart tracking paren/brace depth on the useCallback(...) call
  // to find where recoverWithCode's own definition ends, so the extracted
  // call is scoped to this function and cannot accidentally pick up the
  // unlock call site (which also calls resolveOrKeyMaterial, earlier in the
  // file, with a different, computed flag).
  let depth = 0;
  let started = false;
  let fnEnd = -1;
  for (let i = fnStart; i < source.length; i++) {
    const ch = source[i];
    if (ch === "(" || ch === "{") {
      depth++;
      started = true;
    } else if (ch === ")" || ch === "}") {
      depth--;
      if (started && depth === 0) {
        fnEnd = i + 1;
        break;
      }
    }
  }
  if (fnEnd === -1) {
    throw new Error("Could not find the end of recoverWithCode's useCallback(...) body.");
  }

  const fnBody = source.slice(fnStart, fnEnd);
  const callAnchor = "const orMaterial = await resolveOrKeyMaterial({";
  const callStart = fnBody.indexOf(callAnchor);
  if (callStart === -1) {
    throw new Error(
      "Could not find 'const orMaterial = await resolveOrKeyMaterial({' inside recoverWithCode. " +
        "The call was renamed, removed, or restructured (e.g. option (i) from the Cryptography " +
        "Engineer's ruling on OWM-T0263: recovery given its own entry point). Update or retire " +
        "this test accordingly.",
    );
  }
  const callEnd = fnBody.indexOf("});", callStart);
  if (callEnd === -1) {
    throw new Error("Could not find the end of the resolveOrKeyMaterial({...}) call.");
  }
  return fnBody.slice(callStart, callEnd + 3);
}

describe("recoverWithCode pins saltMatchesExistingRows: false (OWM-T0263 / DL-1506)", () => {
  it("passes a literal `saltMatchesExistingRows: false` at its resolveOrKeyMaterial call site", () => {
    const source = readFileSync(VAULT_CONTEXT_PATH, "utf8");
    const call = extractResolveCallInsideRecoverWithCode(source);

    // The property under test: recovery always mints a brand new kdf_salt
    // before this call runs, so it can never honestly claim the salt
    // matches whatever rows are already sealed. `false` here is what makes
    // resolveOrKeyMaterial refuse to derive-and-pin instead of silently
    // minting a key that opens nothing (see OWM-T0263 notes: the marker
    // written earlier in this same function protects the NEXT unlock, not
    // this call, so this literal is still the only thing guarding it).
    expect(
      /saltMatchesExistingRows:\s*false\s*,/.test(call),
      `Expected the resolveOrKeyMaterial call inside recoverWithCode to pass a literal ` +
        `\`saltMatchesExistingRows: false\`. Found instead:\n\n${call}\n\n` +
        `Passing true (or anything computed that can evaluate true) here re-opens the DL-1506 ` +
        `data-loss bug: an unpinned row under a just-rotated salt would derive-and-pin a key ` +
        `that opens nothing, and report success.`,
    ).toBe(true);

    // Guard the guard: this must not be true by accident of matching a comment or an
    // unrelated `true` sitting nearby. Assert the exact opposite literal is absent from
    // the extracted call.
    expect(
      /saltMatchesExistingRows:\s*true\s*,/.test(call),
      `The extracted resolveOrKeyMaterial call contains BOTH a false and a true literal for ` +
        `saltMatchesExistingRows, which means the extraction is not scoped correctly. Call was:\n\n${call}`,
    ).toBe(false);
  });
});
