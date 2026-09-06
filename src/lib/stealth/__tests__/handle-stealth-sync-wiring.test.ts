/**
 * handleStealthSync wiring, read as source (OWM-T0520, OWM-T0495, OWM-T0671,
 * OWM-T0694).
 *
 * WHY A SOURCE TEST AND NOT A RENDER TEST. This mirrors the reasoning in
 * connections-page-sync-wiring.test.ts, which this file's describe block
 * used to live in: there is no jsdom, no happy-dom and no @testing-library
 * in devDependencies, and a render harness for a component this size becomes
 * the most brittle object in the suite. handleStealthSync is no longer part
 * of that component (OWM-T0520 extracted it into its own module so a Node
 * harness can drive the real production code without mounting React), but
 * the same constraint applies to its new home: this module still closes
 * nothing itself, but its correctness depends on ORDER, not on anything a
 * render would exercise differently.
 *
 * WHY THIS MOVED HERE INSTEAD OF STAYING IN ConnectionsPage.tsx's TEST FILE.
 * handleStealthSync is now a 12-line wrapper in ConnectionsPage.tsx that
 * forwards to this module. Reading ConnectionsPage.tsx as source would find
 * that wrapper, not the kill-switch gate or the credentials key export, so
 * every assertion below would either false-fail immediately or (worse)
 * silently stop measuring the thing its own message claims to check. The
 * fact this test defends (order: read the switch, gate on it, THEN export
 * the key) lives in this file now, so the test that defends it does too.
 *
 * ORDER IS THE PROPERTY, not presence. Below the export the gate guards
 * nothing, because the key has already left the vault by then.
 *
 * IF THIS FAILS, read the message on the assertion. Do not delete the test
 * to make the build green: the fact it names is the one the customer relies
 * on.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const SOURCE = readFileSync(new URL("../handle-stealth-sync.ts", import.meta.url), "utf8");

/**
 * The body of one top-level function in this module, comments stripped.
 *
 * Comments are removed so that a future comment MENTIONING one of the names
 * below cannot pass or fail an assertion about the CODE. Only whole-line `//`
 * comments are stripped, never a trailing one, because a trailing `//` inside
 * a string literal (a URL, for example) would take real code with it.
 *
 * Throws rather than returning empty if the function is not found, so
 * renaming or removing it fails loudly instead of making every assertion
 * below vacuous.
 */
const CODE_ONLY = SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

function handlerCode(name: string): string {
  const opening = `async function ${name}(`;
  const start = CODE_ONLY.indexOf(opening);
  if (start === -1) {
    throw new Error(
      `handle-stealth-sync.ts no longer contains "${opening}". If it was renamed, ` +
        `update this test to the new name; do not delete the assertions.`,
    );
  }
  const bodyStart = CODE_ONLY.indexOf("{", start);
  if (bodyStart === -1) {
    throw new Error(`Found ${opening} but no opening brace after it.`);
  }
  let depth = 0;
  for (let i = bodyStart; i < CODE_ONLY.length; i += 1) {
    const ch = CODE_ONLY[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return CODE_ONLY.slice(start, i + 1);
    }
  }
  throw new Error(`Braces in ${name} never balanced; the slice would run to EOF.`);
}

/**
 * The block starting at `searchFrom`, from its first `{` to the matching
 * closing brace. Used to isolate one `if` statement's body so a return
 * inside it cannot be confused with a return anywhere else in the function
 * (OWM-T0694).
 */
function blockAt(code: string, searchFrom: number): string {
  const bodyStart = code.indexOf("{", searchFrom);
  if (bodyStart === -1) {
    throw new Error(`No opening brace found after index ${searchFrom}.`);
  }
  let depth = 0;
  for (let i = bodyStart; i < code.length; i += 1) {
    const ch = code[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return code.slice(searchFrom, i + 1);
    }
  }
  throw new Error(`Braces starting at index ${searchFrom} never balanced.`);
}

describe("handleStealthSync wiring", () => {
  const SYNC_DOOR_REFUSAL = "Scanning a private wallet is temporarily unavailable.";

  it("still exists as a function this test can read", () => {
    const code = handlerCode("handleStealthSync");
    expect(code.length).toBeGreaterThan(200);
  });

  it("reads the switch above the key export", () => {
    const code = handlerCode("handleStealthSync");
    const refresh = code.indexOf("refreshRuntimeFlagsForDoor(");
    const gate = code.indexOf("isStealthSyncEnabled(");
    const keyExport = code.indexOf("exportOrCredsKey(");
    expect(keyExport).toBeGreaterThan(-1);
    expect(
      gate > -1 && gate < keyExport,
      "The kill switch check is gone from handleStealthSync, or it now sits BELOW " +
        "exportOrCredsKey. This gate is the last thing between a flag flip and the " +
        "customer's credentials key crossing to the provider origin. Below the export " +
        "it guards nothing: the key has already left the vault (OWM-T0495, OWM-T0671).",
    ).toBe(true);
    expect(
      refresh > -1 && refresh < gate,
      "handleStealthSync no longer re-reads the runtime flags before it consults the " +
        "switch. Without that read the door answers from the copy cached when the tab " +
        "loaded, so the one customer the switch fails to reach is the customer already " +
        "in the app (OWM-T0504), and joining a query that was already in flight can " +
        "answer from before the press (OWM-T0587).",
    ).toBe(true);
  });

  it("isStealthSyncEnabled( is not duplicated above the gate", () => {
    const code = handlerCode("handleStealthSync");
    const occurrences = code.split("isStealthSyncEnabled(").length - 1;
    expect(
      occurrences,
      "isStealthSyncEnabled( appears more than once in handleStealthSync. The " +
        "assertions in this file find only the FIRST occurrence, so a decoy call " +
        "placed above the real gate would let the real gate move below the key " +
        "export undetected (OWM-T0694).",
    ).toBe(1);
  });

  it("the gate actually returns: deleting the return reopens the hole", () => {
    const code = handlerCode("handleStealthSync");
    const gate = code.indexOf("isStealthSyncEnabled(");
    expect(gate).toBeGreaterThan(-1);
    const ifStart = code.lastIndexOf("if", gate);
    expect(ifStart).toBeGreaterThan(-1);
    const gateBlock = blockAt(code, ifStart);
    const refusal = gateBlock.indexOf(SYNC_DOOR_REFUSAL);
    const returnAfterRefusal = gateBlock.indexOf("return", refusal);
    expect(
      refusal > -1 && returnAfterRefusal > refusal,
      "The switch gate's if-block no longer contains a return after its refusal " +
        "message. Without it, a refused press shows the toast and falls straight " +
        "through into the code below the gate, including the credentials key " +
        "export (OWM-T0694: deleting one `return;` reopens the hole with a green " +
        "suite, because the three existing assertions here are all presence-only " +
        "and none of them checks control flow).",
    ).toBe(true);
  });

  it("refuses out loud instead of returning silently", () => {
    const code = handlerCode("handleStealthSync");
    const refusal = code.indexOf(SYNC_DOOR_REFUSAL);
    const keyExport = code.indexOf("exportOrCredsKey(");
    expect(
      refusal > -1 && refusal < keyExport,
      "The sync door no longer shows its refusal message above the key export. A gate " +
        "that returns with no word to anyone reads as a dead Sync button, which turns " +
        "a switched-off feature into a support conversation instead of an explanation.",
    ).toBe(true);
  });

  it("keeps the retry action pointed back at this gated handler", () => {
    const code = handlerCode("handleStealthSync");
    expect(
      code.includes('label: "Try again"'),
      "The failure toast lost its Try again action. OWM-T0495 closed the retry hole by " +
        "gating this handler, not by deleting the retry; deleting it takes a working " +
        "recovery away from every customer whose scan failed for a retryable reason.",
    ).toBe(true);
    expect(
      /onClick:\s*\(\)\s*=>\s*void handleStealthSync\(/.test(code),
      "The Try again action no longer re-enters handleStealthSync. It has to, because " +
        "that is the entry the gate above covers. Any other retry target is a second " +
        "door into the private scan with no kill switch on it (OWM-T0495).",
    ).toBe(true);
  });
});
