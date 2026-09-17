/**
 * runBankSync -> BankSyncDialog unitMismatch wiring, read as source (OWM-T0740).
 *
 * WHY A SOURCE TEST AND NOT A RENDER TEST. Same reason as
 * connections-page-sync-wiring.test.ts: nothing in this repo renders
 * ConnectionsPage. There is no jsdom, no happy-dom and no @testing-library in
 * devDependencies, the component is 2200+ lines with auth, the vault, the
 * supabase client, the router and the runtime flags behind it, and no e2e job
 * runs on pull requests here (Playwright exists in devDependencies but no
 * check-run in this repo executes it). Building a render harness for one
 * ticket becomes the most brittle object in the suite; that decision is
 * already made and documented on the sibling file, not re-litigated here.
 *
 * WHAT THIS DEFENDS. BankSyncDialog.test.ts already proves the pure
 * predicate bankSyncHasWarning is correct in isolation: given a
 * BankSyncOutcome with unitMismatch > 0 it returns true. That test cannot
 * notice if the two places that actually matter stop feeding it real data:
 *
 *   1. runBankSync (ConnectionsPage.tsx) could drop `unitMismatch` from
 *      either of its two return statements -- the early-return guard clause
 *      or the normal success path -- and go back to reporting a refused
 *      credit as if nothing happened, exactly the defect this ticket was
 *      filed for.
 *   2. BankSyncDialog's phase === "done" render could stop calling
 *      bankSyncHasWarning, or the warning paragraph naming the refused count
 *      could be deleted, and a refused credit would render as a plain
 *      success again with no test catching it.
 *
 * Both are read from the real source files, not a copy or a mock, so a
 * genuine regression in either file fails this suite.
 *
 * IF THIS FAILS: read the assertion message, it names which fact broke.
 * Do not delete the test to get CI green -- the fact it names is the one a
 * customer's balance depends on.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const CONNECTIONS_PAGE_SOURCE = readFileSync(
  new URL("../ConnectionsPage.tsx", import.meta.url),
  "utf8",
);
const BANK_SYNC_DIALOG_SOURCE = readFileSync(
  new URL("../BankSyncDialog.tsx", import.meta.url),
  "utf8",
);

function runBankSyncBody(source: string): string {
  const start = source.indexOf("const runBankSync = useCallback(");
  if (start === -1) {
    throw new Error(
      "runBankSync is no longer defined as `const runBankSync = useCallback(...)` in " +
        "ConnectionsPage.tsx. This test locates the function by that exact declaration; " +
        "update the locator if the declaration style changed, and re-check the assertions " +
        "below still describe real behaviour.",
    );
  }
  // The callback's dependency array closes with `],` at the top level. Take
  // a generous slice from the declaration forward rather than trying to
  // balance braces, since every assertion below just needs the two return
  // statements to be somewhere in this slice.
  return source.slice(start, start + 4000);
}

describe("runBankSync return object carries unitMismatch (OWM-T0740)", () => {
  const body = runBankSyncBody(CONNECTIONS_PAGE_SOURCE);

  it("includes unitMismatch on the early-return guard (no user/subaccount/connection)", () => {
    expect(
      /return\s*\{\s*imported:\s*0,\s*total:\s*0,\s*unmapped:\s*0,\s*errored:\s*0,\s*unitMismatch:\s*0,?\s*\}/.test(
        body,
      ),
    ).toBe(true);
  });

  it("propagates result.unitMismatch on the success return, not a hardcoded 0", () => {
    // Must be the live guard's count, not a literal -- a literal 0 here would
    // compile, pass a naive "field exists" check, and still hide every
    // refused credit from the customer.
    expect(/unitMismatch:\s*result\.unitMismatch/.test(body)).toBe(true);
  });

  it("does not return a bare unmapped/errored pair without unitMismatch alongside it", () => {
    // The exact shape of the original defect: `{ imported, total, unmapped,
    // errored }` with no unitMismatch key at all.
    expect(
      /return\s*\{\s*imported:\s*result\.imported,\s*total:\s*result\.total,\s*unmapped:\s*result\.unmapped,\s*errored:\s*result\.errored,?\s*\};/.test(
        body,
      ),
    ).toBe(false);
  });
});

describe("BankSyncDialog done-phase render uses bankSyncHasWarning (OWM-T0740)", () => {
  it("selects the warning icon (AlertCircle) over the success icon when bankSyncHasWarning is true", () => {
    expect(
      BANK_SYNC_DIALOG_SOURCE.includes(
        'bankSyncHasWarning({ unitMismatch }) ? (\n              <AlertCircle',
      ),
    ).toBe(true);
  });

  it("renders a customer-visible warning line naming the refused count when bankSyncHasWarning is true", () => {
    const idx = BANK_SYNC_DIALOG_SOURCE.indexOf("bankSyncHasWarning({ unitMismatch }) && (");
    expect(idx).toBeGreaterThan(-1);
    const warningBlock = BANK_SYNC_DIALOG_SOURCE.slice(idx, idx + 400);
    expect(warningBlock).toContain("${unitMismatch}");
    expect(warningBlock.toLowerCase()).toContain("not updated");
    expect(warningBlock.toLowerCase()).toContain("currency");
  });

  it("feeds the done-phase render from outcome.unitMismatch, not a value that never updates", () => {
    expect(BANK_SYNC_DIALOG_SOURCE).toContain("setUnitMismatch(outcome.unitMismatch)");
  });
});
