/**
 * handleDeleteConfirmed wiring, read as source.
 *
 * WHY A SOURCE TEST AND NOT A RENDER TEST. Same reasoning as
 * connections-page-sync-wiring.test.ts, read that file's header first: there
 * is no jsdom, no happy-dom and no @testing-library in devDependencies, and
 * the component is thousands of lines with auth, the vault, the supabase
 * client, the router, the runtime flags and the toast layer behind it. A
 * render harness for that becomes the most brittle object in the suite.
 * Playwright is not an option on a pull request either: this repo's PR gate
 * runs vitest only, no e2e job.
 *
 * WHAT IT DEFENDS (OWM-T0138, DL-1081). classifyDeleteReadback itself is
 * already covered by connection-delete.test.ts, but that file never touches
 * ConnectionsPage.tsx, so nothing catches the handler simply not calling it,
 * or calling it and ignoring the answer. A 2xx from or-connection-delete /
 * or-stealth-connection-delete is not proof the row is actually gone: the
 * endpoint can acknowledge a delete that did not take. Before this gate
 * existed, the UI's optimistic removal hid that and showed a success toast
 * for a delete that silently failed server-side. This file asserts the
 * handler still reads the list back, still classifies it, and still refuses
 * to say "disconnected" when the read-back says the row is still there.
 *
 * ORDER AND CONTROL FLOW ARE THE PROPERTY, not presence. A decoy call to
 * classifyDeleteReadback, or a silent-failure branch missing its `return`,
 * would leave every existing presence-only assertion green while reopening
 * the hole (same failure mode OWM-T0694 named for the sync gate).
 *
 * IF THIS FAILS, read the message on the assertion. It names which fact
 * stopped being true. Do not delete the test to make the build green: the
 * fact it names is the one the customer relies on.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const SOURCE = readFileSync(new URL("../ConnectionsPage.tsx", import.meta.url), "utf8");

/**
 * The body of one top-level handler in the component, comments stripped.
 *
 * Comments are removed so that a future comment MENTIONING one of the names
 * below cannot pass or fail an assertion about the CODE. Only whole-line `//`
 * comments are stripped, never a trailing one, because a trailing `//` inside
 * a string literal (a URL, for example) would take real code with it.
 *
 * Throws rather than returning empty if the handler is not found, so renaming
 * or removing it fails loudly instead of making every assertion below
 * vacuous.
 */
const CODE_ONLY = SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

function handlerCode(name: string): string {
  const opening = `async function ${name}(`;
  const start = CODE_ONLY.indexOf(opening);
  if (start === -1) {
    throw new Error(
      `ConnectionsPage.tsx no longer contains "${opening}". If it was renamed, ` +
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
 * inside it cannot be confused with a return anywhere else in the handler
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

describe("ConnectionsPage handleDeleteConfirmed wiring", () => {
  it("still exists as a handler this test can read", () => {
    const code = handlerCode("handleDeleteConfirmed");
    expect(code.length).toBeGreaterThan(200);
  });

  it("classifies the read-back after the delete request, not before", () => {
    const code = handlerCode("handleDeleteConfirmed");
    const deleteCall = code.indexOf("callProxy(");
    const classify = code.indexOf("classifyDeleteReadback(");
    expect(deleteCall).toBeGreaterThan(-1);
    expect(
      classify,
      "handleDeleteConfirmed no longer calls classifyDeleteReadback. Without it a " +
        "2xx from the delete endpoint is trusted outright, which is exactly the " +
        "silent-failure hole DL-1081 closed.",
    ).toBeGreaterThan(-1);
    expect(
      deleteCall < classify,
      "classifyDeleteReadback is being called before the delete request runs. It " +
        "has to read the list back AFTER callProxy, not before, or it is just " +
        "classifying stale state.",
    ).toBe(true);
  });

  it("classifyDeleteReadback( is not duplicated above the read-back gate", () => {
    const code = handlerCode("handleDeleteConfirmed");
    const occurrences = code.split("classifyDeleteReadback(").length - 1;
    expect(
      occurrences,
      "classifyDeleteReadback( appears more than once in handleDeleteConfirmed. " +
        "The assertions in this file find only the FIRST occurrence, so a decoy " +
        "call placed above the real gate would let the real gate's control flow " +
        "drift undetected (same failure mode as OWM-T0694 on the sync handler).",
    ).toBe(1);
  });

  it("the silent-failure branch actually returns: deleting the return reopens the hole", () => {
    const code = handlerCode("handleDeleteConfirmed");
    const classify = code.indexOf("classifyDeleteReadback(");
    expect(classify).toBeGreaterThan(-1);
    const ifStart = code.indexOf('if (readback === "silent-failure")');
    expect(
      ifStart,
      "No `if (readback === \"silent-failure\")` branch found after " +
        "classifyDeleteReadback. Without it the classification result is computed " +
        "and never acted on.",
    ).toBeGreaterThan(-1);
    const gateBlock = blockAt(code, ifStart);
    const toastCall = gateBlock.indexOf("toast.error(");
    const returnAfterToast = gateBlock.indexOf("return", toastCall);
    expect(
      toastCall > -1 && returnAfterToast > toastCall,
      "The silent-failure branch no longer contains toast.error followed by a " +
        "return. Without the return, a silent failure falls straight through into " +
        "the success path below, which is exactly the false 'disconnected' toast " +
        "DL-1081 exists to prevent.",
    ).toBe(true);
  });

  it("never shows the success toast inside the silent-failure branch", () => {
    const code = handlerCode("handleDeleteConfirmed");
    const ifStart = code.indexOf('if (readback === "silent-failure")');
    expect(ifStart).toBeGreaterThan(-1);
    const gateBlock = blockAt(code, ifStart);
    expect(
      gateBlock.includes("toast.success("),
      "toast.success is being called inside the silent-failure branch. A read-back " +
        "that found the row still present must never claim the connection was " +
        "disconnected.",
    ).toBe(false);
  });

  it("shows the success toast only below/outside the silent-failure branch", () => {
    const code = handlerCode("handleDeleteConfirmed");
    const ifStart = code.indexOf('if (readback === "silent-failure")');
    expect(ifStart).toBeGreaterThan(-1);
    const gateBlock = blockAt(code, ifStart);
    const gateEnd = ifStart + gateBlock.length;
    const successToast = code.indexOf("toast.success(", gateEnd);
    expect(
      successToast,
      "handleDeleteConfirmed no longer shows a success toast after the " +
        "silent-failure gate. Without it a confirmed delete has no positive " +
        "confirmation for the customer.",
    ).toBeGreaterThan(-1);
  });
});
