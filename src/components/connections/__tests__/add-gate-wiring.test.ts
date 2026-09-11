/**
 * The add gate WIRING, not the add gate decision.
 *
 * src/lib/or/__tests__/add-gate.test.ts already covers planCatalogueAdd hard:
 * every gated slug, the unnamed add, the bank route, and nine non-boolean flag
 * values. None of that notices if the call disappears from the component. The
 * decision module was never the thing that was missing. The wiring was, and an
 * absence that reads as green is the failure this whole chain exists to stop.
 *
 * WHY A SOURCE ASSERTION and not a rendered component. Three approaches were
 * available and this is the only one that catches BOTH failures with no new
 * dependency. A rendered test would need a component render harness, which
 * this tree deliberately does not carry. Extracting the handler prelude into a
 * testable function would catch deletion but not ORDERING, and ordering is
 * half of what must hold here: a gate that runs after the key export has
 * already handed the key to the popup, so refusing afterwards refuses nothing.
 * Reading the source catches deletion, reordering, and a refusal that is
 * computed and then ignored. It is brittle to a refactor of
 * handleAddConnection, and that is the intended behaviour: this gate is not
 * supposed to move quietly.
 *
 * The checker is a pure function so the mutation tests below can prove it goes
 * RED. A guard nobody has watched fail is not a guard.
 *
 * OWM-T0500.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SOURCE_PATH = fileURLToPath(new URL("../ConnectionsPage.tsx", import.meta.url));
const SOURCE = readFileSync(SOURCE_PATH, "utf8");

const HANDLER = "async function handleAddConnection(";
const GATE = "planCatalogueAdd(";
const KEY_EXPORT = "exportOrCredsKey(";

const MISSING_HANDLER = "handleAddConnection not found: this guard cannot see what it guards";
const MISSING_CONTROL = "exportOrCredsKey not found in handleAddConnection: the guard is blind";
const MISSING_GATE = "handleAddConnection does not call planCatalogueAdd: the add door is open";
const WRONG_ORDER = "planCatalogueAdd runs after exportOrCredsKey: the key leaves first";
const NOT_ENFORCED = "the planCatalogueAdd refusal is computed but not acted on";

/** The whole gate statement plus the guard block it controls. */
const GATE_BLOCK = /[ \t]*const \w+ = planCatalogueAdd\([\s\S]*?\n[ \t]*\}\n/;

/** The line that exports the credentials key into the connect handoff. */
const KEY_LINE = /[ \t]*const \w+ = await exportOrCredsKey\(\);\n/;

/**
 * The body of handleAddConnection, from its signature to the next function
 * declaration in the component. Scoped on purpose: both symbols appear
 * elsewhere in a file of this size, so a whole-file search would pass on a
 * gate that lives in some other handler entirely.
 */
function handleAddConnectionBody(source: string): string {
  const start = source.indexOf(HANDLER);
  if (start === -1) return "";
  const rest = source.slice(start + HANDLER.length);
  const end = rest.search(/\n {2}(?:async )?function /);
  return end === -1 ? rest : rest.slice(0, end);
}

/** Every way this wiring can be wrong, named. Empty means the wiring holds. */
function checkAddGateWiring(source: string): string[] {
  const body = handleAddConnectionBody(source);
  if (body === "") return [MISSING_HANDLER];

  const problems: string[] = [];
  const gateAt = body.indexOf(GATE);
  const keyAt = body.indexOf(KEY_EXPORT);

  // The control comes first. If the key export cannot be found, the checks
  // below would pass for the wrong reason, and a check that cannot find
  // anything is the exact failure shape this codebase keeps paying for.
  if (keyAt === -1) problems.push(MISSING_CONTROL);
  if (gateAt === -1) problems.push(MISSING_GATE);
  if (gateAt !== -1 && keyAt !== -1 && gateAt > keyAt) problems.push(WRONG_ORDER);
  if (gateAt !== -1 && !/\.allowed[\s\S]{0,200}?return;/.test(body.slice(gateAt))) {
    problems.push(NOT_ENFORCED);
  }
  return problems;
}

/** The gate block as it stands today, so a mutant can move it rather than invent it. */
function gateBlock(): string {
  const found = SOURCE.match(GATE_BLOCK);
  expect(found, "the gate block is not where this guard expects it").not.toBeNull();
  return found ? found[0] : "";
}

describe("the add gate is wired into handleAddConnection", () => {
  it("holds at HEAD: the gate is called, before the key export, and acted on", () => {
    expect(checkAddGateWiring(SOURCE)).toEqual([]);
  });

  it("goes red when the planCatalogueAdd call is deleted", () => {
    const mutant = SOURCE.replace(GATE_BLOCK, "");
    expect(mutant).not.toBe(SOURCE);
    expect(checkAddGateWiring(mutant)).toContain(MISSING_GATE);
  });

  it("goes red when the gate is moved below the key export", () => {
    const block = gateBlock();
    const withoutGate = SOURCE.replace(GATE_BLOCK, "");
    expect(KEY_LINE.test(withoutGate)).toBe(true);
    const mutant = withoutGate.replace(KEY_LINE, (line) => line + block);
    expect(checkAddGateWiring(mutant)).toContain(WRONG_ORDER);
  });

  it("goes red when the refusal is computed but never returned on", () => {
    const mutant = SOURCE.replace(GATE_BLOCK, (block) => block.replace(/\n[ \t]*return;/, ""));
    expect(mutant).not.toBe(SOURCE);
    expect(checkAddGateWiring(mutant)).toContain(NOT_ENFORCED);
  });

  it("goes red, rather than quietly green, when it can no longer find the handler", () => {
    const mutant = SOURCE.replace(HANDLER, "async function handleAddSomethingElse(");
    expect(checkAddGateWiring(mutant)).toEqual([MISSING_HANDLER]);
  });
});
