/**
 * Structural guard on the SINGLE-CONNECTION sync call site.
 *
 * THE DEFECT THIS DEFENDS (OWM-T0530, OWM-T0544). handleSync used to decide
 * where a press went with `isStealthSyncEnabled() && conn.is_stealth`, so
 * turning the private wallet switch OFF did not refuse a private connection:
 * it fell through to the branch below, which exports two vault keys and posts
 * them to or-sync. PR #590 fixed the routing. It did not make the fix
 * defensible: deleting the arm that acts on a "private" route restored the
 * defect in full with every test in the repo still passing.
 *
 * WHAT THIS FILE IS AND IS NOT. It reads ConnectionsPage.tsx as text and pins
 * four properties of one function. It cannot prove what the component does at
 * runtime, and nothing here should be read as if it could. The behavioural
 * proof lives in src/lib/or/__tests__/sync-route-key-export.test.ts, which
 * proves the key handover itself refuses a private connection, so deleting
 * the arm below can no longer export a key even with this file removed. The
 * two are deliberately independent: one stops the leak, this one notices the
 * edit.
 *
 * Same shape and same reason as supabase/functions/_shared/or-gateway-readers
 * .test.ts, which pins that every edge function resolves the OR gateway
 * through the shared resolver.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PAGE = join(dirname(fileURLToPath(import.meta.url)), "..", "ConnectionsPage.tsx");

const OPEN = "async function handleSync(conn: ConnectionRow)";
const NEXT = "async function handleSyncAll(";

/**
 * The body of handleSync alone. Sliced rather than searched whole-file
 * because handleAddConnection and handleStealthSync legitimately export keys
 * of their own, and an assertion over the whole file would be answered by the
 * wrong function.
 */
function handleSyncSource(): string {
  const src = readFileSync(PAGE, "utf8");
  const start = src.indexOf(OPEN);
  const end = src.indexOf(NEXT, start + 1);
  if (start < 0 || end <= start) return "";
  return src.slice(start, end);
}

describe("handleSync call site", () => {
  it("finds the function it is supposed to be checking", () => {
    // Without this, renaming handleSync turns every assertion below into a
    // pass over an empty string and the guard stops guarding anything.
    const src = readFileSync(PAGE, "utf8");
    expect(src.length, `${PAGE} is empty or unreadable`).toBeGreaterThan(1000);
    expect(src.indexOf(OPEN), `did not find "${OPEN}"`).toBeGreaterThan(-1);
    expect(src.indexOf(NEXT), `did not find "${NEXT}"`).toBeGreaterThan(src.indexOf(OPEN));
    expect(handleSyncSource().length).toBeGreaterThan(500);
  });

  it("routes the press with planSyncRoute", () => {
    expect(handleSyncSource()).toContain("planSyncRoute(conn)");
  });

  it("sends a private connection to handleStealthSync and returns", () => {
    // Delete these lines from ConnectionsPage.tsx and this is the test that
    // goes red. That is the whole point of the file.
    const body = handleSyncSource();
    expect(body, 'the "private" arm is missing from handleSync').toMatch(
      /if\s*\(\s*route === "private"\s*\)\s*\{\s*await handleStealthSync\(conn\);\s*return;\s*\}/,
    );
  });

  it("decides the private arm before it reads any key", () => {
    const body = handleSyncSource();
    const arm = body.indexOf('route === "private"');
    const keys = body.indexOf("exportOrSyncKeysFor");
    expect(arm).toBeGreaterThan(-1);
    expect(keys).toBeGreaterThan(-1);
    expect(arm, "the key read must come after the private arm, never before").toBeLessThan(keys);
  });

  it("never exports a vault key directly, only through the guarded handover", () => {
    // The identifiers still appear, passed as exporters. What must not appear
    // is a CALL: `exportOrCredsKey()` here would be a key read that has not
    // been through planSyncRoute.
    const body = handleSyncSource();
    expect(body).not.toMatch(/exportOrCredsKey\s*\(/);
    expect(body).not.toMatch(/exportOrTxnsKey\s*\(/);
    expect(body).toContain("exportOrSyncKeysFor(conn, {");
  });

  it("does not consult the kill switch when choosing a path", () => {
    // The switch decides refuse-or-scan inside handleStealthSync, above that
    // handler's own key export. It must never be back in this routing
    // decision: an off switch that selects a path is OWM-T0530.
    expect(handleSyncSource()).not.toContain("isStealthSyncEnabled");
  });
});
