/**
 * handleSync wiring, read as source.
 *
 * WHY A SOURCE TEST AND NOT A RENDER TEST. Nothing in this repo renders
 * ConnectionsPage: there is no jsdom, no happy-dom and no @testing-library in
 * devDependencies, and the component is 2270 lines with auth, the vault, the
 * supabase client, the router, the runtime flags and the toast layer behind
 * it. A render harness for that becomes the most brittle object in the suite,
 * and a brittle harness gets skipped, which returns us to an undefended arm by
 * a slower route. Playwright is not an option today either: a pull request in
 * this repo produces five check-runs and none of them is an e2e job, so an e2e
 * test added now would be collected by nothing on the gate.
 *
 * WHAT IT DEFENDS (OWM-T0530, OWM-T0544). handleSync routes a private
 * connection to handleStealthSync and everything else to requestOrSync, which
 * is the only call in this app that takes the Orange Rails credentials key and
 * transactions key out of the vault and puts them in a request body. The rule
 * itself is tested in sync-route.test.ts and the key handover is tested in
 * or-sync-request.test.ts. Neither of those notices if the ARM in the handler
 * is deleted. Deleting it no longer leaks a key, because requestOrSync asks
 * planSyncRoute itself and refuses above its own export, but it does break
 * private wallet sync for every customer who presses Sync on one, silently, on
 * a green board. That is the gap this file closes.
 *
 * WHAT IT DOES NOT CLAIM. It is not the customer-path assertion that no
 * request carrying credentials_key ever leaves the browser. Only a real
 * browser can assert that, and it needs an e2e job on pull requests first.
 * This asserts a weaker and still useful thing: the handler is wired the way
 * the tested rules assume, and it cannot be unwired without failing.
 *
 * IF THIS FAILS, read the message on the assertion. It names which of the four
 * facts stopped being true. Do not delete the test to make the build green:
 * the fact it names is the one the customer relies on.
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
 * or removing it fails loudly instead of making every assertion below vacuous.
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

describe("ConnectionsPage handleSync wiring", () => {
  it("still exists as a handler this test can read", () => {
    const code = handlerCode("handleSync");
    expect(code.length).toBeGreaterThan(200);
  });

  it("sends a private connection to the private path", () => {
    const code = handlerCode("handleSync");
    expect(
      code.includes('route === "private"'),
      "handleSync no longer branches on the private route. A private connection " +
        "must go to handleStealthSync; it must never reach the or-sync path.",
    ).toBe(true);
    expect(
      code.includes("handleStealthSync("),
      "handleSync no longer calls handleStealthSync. The private branch has to " +
        "hand the press to the in-browser scan, not just return.",
    ).toBe(true);
  });

  it("decides the private branch above the call that hands over the vault keys", () => {
    const code = handlerCode("handleSync");
    const privateArm = code.indexOf('route === "private"');
    const keyHandover = code.indexOf("requestOrSync(");
    expect(keyHandover).toBeGreaterThan(-1);
    expect(
      privateArm > -1 && privateArm < keyHandover,
      "The private arm must sit ABOVE the requestOrSync call. Below it, a " +
        "private press reaches the only call that exports vault keys and is " +
        "refused there instead of being scanned, which is a broken feature.",
    ).toBe(true);
  });

  it("exports no vault key in the handler itself", () => {
    const code = handlerCode("handleSync");
    for (const forbidden of ["exportOrCredsKey", "exportOrTxnsKey"]) {
      expect(
        code.includes(forbidden),
        `handleSync calls ${forbidden} directly again. The export belongs inside ` +
          `requestOrSync, which refuses a non-or-sync route before it exports ` +
          `anything (OWM-T0530). An export in the handler is above no check at all.`,
      ).toBe(false);
    }
  });

  it("does not consult the kill switch to decide where the press goes", () => {
    const code = handlerCode("handleSync");
    expect(
      code.includes("isStealthSyncEnabled"),
      "The kill switch is back in the routing decision. That was the original " +
        "defect (OWM-T0530): `isStealthSyncEnabled() && conn.is_stealth` meant " +
        "switching the feature OFF moved a private connection onto the " +
        "key-exporting path instead of refusing it. The switch decides " +
        "refuse-or-scan inside handleStealthSync, above that path's own export.",
    ).toBe(false);
  });
});

describe("ConnectionsPage handleSyncAll wiring", () => {
  it("plans the batch before handing anything to or-sync", () => {
    const code = handlerCode("handleSyncAll");
    const plan = code.indexOf("planSyncAll(");
    const keyHandover = code.indexOf("requestOrSync(");
    expect(plan).toBeGreaterThan(-1);
    expect(keyHandover).toBeGreaterThan(-1);
    expect(
      plan < keyHandover,
      "planSyncAll must run before requestOrSync. It is what holds private " +
        "connections back from the bulk press.",
    ).toBe(true);
  });

  it("exports no vault key in the handler itself", () => {
    const code = handlerCode("handleSyncAll");
    for (const forbidden of ["exportOrCredsKey", "exportOrTxnsKey"]) {
      expect(code.includes(forbidden), `handleSyncAll calls ${forbidden} directly.`).toBe(false);
    }
  });
});

/**
 * The stealth SYNC door, read as source (OWM-T0671).
 *
 * WHY THIS IS SEPARATE FROM handleSync ABOVE. The routing block asserts the
 * kill switch is NOT in handleSync's routing decision, because reading it
 * there was the OWM-T0530 defect. That leaves open where the switch IS, and
 * the answer is at the top of handleStealthSync, above the credentials key
 * export, covering both ways into a private scan: the routed press, and the
 * "Try again" action on the failure toast, which calls this function directly
 * (OWM-T0495). Until this block existed, deleting that gate failed nothing.
 *
 * ORDER IS THE PROPERTY, not presence. Below the export the gate guards
 * nothing, because the key has already left the vault by then.
 */
describe("ConnectionsPage handleStealthSync wiring", () => {
  const SYNC_DOOR_REFUSAL = "Scanning a private wallet is temporarily unavailable.";

  it("still exists as a handler this test can read", () => {
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

/**
 * The import bridge, read as source (OWM-T0717).
 *
 * WHAT IT DEFENDS. or-sync fetches transactions and stores them on the Orange
 * Rails side; a separate call copies them into this app's ledger. Both call
 * sites used to run that copy only when the SAME press reported newly fetched
 * rows. or-sync reports only what it itself just fetched, so a connection
 * whose rows arrived on an earlier press answers 0 for ever, the copy never
 * runs again, and rows that are stored one hop away are never filed. That is
 * not a hypothetical: a tester had 146 transactions fetched five minutes
 * before her account and her wallet mapping existed, so the press that
 * fetched them had nowhere to file them, and every press since answered 0
 * honestly. She saw an empty ledger and a working Sync button.
 *
 * WHY IT IS SAFE TO RUN EVERY TIME. importSyncedTransactionsForConnection is
 * not delta based. It reads what is held for the connection, dedupes, and
 * returns immediately when there is nothing to file. The condition that
 * matters is "this connection was processed and did not error", which is what
 * both call sites now use.
 *
 * The same defect was fixed one path over, on the private-wallet widget, under
 * DL-1116. Its comment already stated the rule: a sync that finds nothing new
 * still has to reconcile.
 *
 * IF THIS FAILS, someone has put a fresh-row count back in front of the copy.
 * That is the bug, not the test.
 */
describe("ConnectionsPage import bridge is not gated on a fresh-row count", () => {
  const BRIDGE = "importSyncedTransactionsForConnection(";

  it("runs the bridge in handleSync without consulting res.synced", () => {
    const code = handlerCode("handleSync");
    const call = code.indexOf(BRIDGE);
    expect(
      call,
      "handleSync no longer calls the import bridge at all. Without it a sync " +
        "fetches transactions and never copies them into the customer's ledger.",
    ).toBeGreaterThan(-1);

    const ifStart = code.lastIndexOf("if", call);
    expect(ifStart).toBeGreaterThan(-1);
    const condition = code.slice(ifStart, code.indexOf("{", ifStart));

    expect(
      condition.includes("user"),
      "The condition immediately above the import bridge is no longer the signed-in " +
        "check this test expects to read. It found: " +
        JSON.stringify(condition.trim()) +
        ". Re-anchor this assertion on the real guard rather than deleting it, " +
        "otherwise the check below passes without measuring anything.",
    ).toBe(true);

    expect(
      /synced/.test(condition),
      "The import bridge is gated on a fresh-row count again (OWM-T0717). " +
        "or-sync reports only what THIS press fetched, so a connection whose rows " +
        "arrived on an earlier press reports 0 for ever and its stored rows are " +
        "never copied into the ledger. The condition is 'processed and no error', " +
        "not 'brought back something new'.",
    ).toBe(false);
  });

  it("excludes an errored single-connection sync from the import bridge (OW-T0263)", () => {
    const code = handlerCode("handleSync");
    const call = code.indexOf(BRIDGE);
    const ifStart = code.lastIndexOf("if", call);
    const condition = code.slice(ifStart, code.indexOf("{", ifStart));

    expect(
      condition.includes("errs.length === 0") || condition.includes("errs.length===0"),
      "handleSync's import-bridge guard no longer excludes a connection whose own " +
        "press just errored. handleSyncAll gates the same call on !c.error; the " +
        "PR body and this file's own docstring above both describe the intended " +
        "condition as 'processed and no error' for BOTH call sites, so the two " +
        "guards must not read differently. Found: " +
        JSON.stringify(condition.trim()),
    ).toBe(true);
  });

  it("selects connections in handleSyncAll by error alone, not by a row count", () => {
    const code = handlerCode("handleSyncAll");
    const call = code.indexOf(BRIDGE);
    expect(
      call,
      "handleSyncAll no longer calls the import bridge, so a bulk press fetches " +
        "transactions for every connection and files none of them.",
    ).toBeGreaterThan(-1);

    const filterStart = code.lastIndexOf("returned.filter(", call);
    expect(
      filterStart,
      "handleSyncAll no longer selects the connections to import from the results " +
        "of the press. Re-anchor this assertion on whatever selects them now.",
    ).toBeGreaterThan(-1);
    const selector = code.slice(filterStart, code.indexOf(";", filterStart));

    expect(
      selector.includes("c.error"),
      "The selector above the import bridge no longer filters out failed " +
        "connections. It found: " +
        JSON.stringify(selector.trim()),
    ).toBe(true);

    expect(
      /synced/.test(selector),
      "The bulk import is gated on a fresh-row count again (OWM-T0717). Same " +
        "reasoning as the single-connection path: a connection that synced cleanly " +
        "with nothing new may still be holding rows that were never copied across.",
    ).toBe(false);
  });
});
