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
