/**
 * Guard test: the private wallet kill switch is still WIRED into ow-or-proxy's
 * or-link-mint-token branch, and every function that mints a widget token is
 * accounted for.
 *
 * WHAT IS ALREADY PROVEN ELSEWHERE, AND WHAT THIS ADDS. OW-T0231 extracted
 * the wiring this test audits into handler.ts, which handler.test.ts now
 * calls directly and drives both directions of the gate behaviourally: flag
 * true reaches the outbound call, flag false refuses with no token anywhere
 * in the body. That is stronger than a text scan, but it only covers
 * ow-or-proxy. This file still does two things handler.test.ts does not: it
 * pins the FULL set of functions that mint a widget token (MINT_TOKEN_CALLERS)
 * so a new caller cannot go unnoticed, and it keeps an independent structural
 * check on the wiring itself, one that does not depend on handler.test.ts
 * staying correct to catch the same inversion/reorder/repoint regressions.
 *
 * WHY THIS READS SOURCE RATHER THAN IMPORTING. readProxySource() below reads
 * handler.ts, not index.ts -- index.ts is now a thin Deno.serve wrapper with
 * no gate logic of its own (see OW-T0231). readFunctionSources() below reads
 * every non-test .ts file in a function's own directory rather than one
 * hardcoded filename, so this test does not go blind the next time a
 * function's implementation is split across more than one file.
 *
 * IT IS PROVEN ABLE TO FAIL. A guard that can only ever report "closed" is
 * indistinguishable from a guard that is stuck closed, and the production flag
 * is false, so nothing else would tell us. The mutation block at the end
 * applies each named failure mode to the real source in memory and asserts the
 * audit rejects it. The real file is never written to.
 *
 * Same shape as or-gateway-readers.test.ts in this directory, which pins the
 * set of functions allowed to resolve the OR gateway. Follow that pattern
 * rather than inventing a new one.
 */

import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const SHARED_DIR = dirname(fileURLToPath(import.meta.url));
const FUNCTIONS_DIR = join(SHARED_DIR, "..");

/** The endpoint that returns a widget token. */
const MINT_ENDPOINT = "or-link-mint-token";

/**
 * Every function whose source names the mint endpoint. This list is the
 * contract: a new caller has to be added here, which is the moment someone
 * has to say out loud whether it consults the switch.
 */
const MINT_TOKEN_CALLERS = ["ow-or-proxy", "owm-or-quick-connect"];

/** Callers that consult the kill switch before minting. */
const GATED_CALLERS = ["ow-or-proxy"];

/**
 * Callers that mint WITHOUT consulting the switch. This is not an exception
 * list and it must not be used as one: it is a record of ground we have not
 * taken yet, and it ratchets in one direction only. Closing one of these
 * fails the test below until the entry moves to GATED_CALLERS, so a fix
 * cannot land while the record still says the door is open.
 *
 * owm-or-quick-connect mints the same token with no flag read (OWM-T0532).
 */
const UNGATED_BASELINE = ["owm-or-quick-connect"];

function collectTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...collectTsFiles(full));
    } else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) {
      out.push(full);
    }
  }
  return out;
}

/** Top level function directory a source file belongs to. */
function owningFunction(file: string): string {
  return relative(FUNCTIONS_DIR, file).split(sep)[0];
}

function findMintCallers(): string[] {
  const callers = collectTsFiles(FUNCTIONS_DIR)
    .filter((file) => readFileSync(file, "utf8").includes(MINT_ENDPOINT))
    .map(owningFunction);
  return [...new Set(callers)].sort();
}

function readProxySource(): string {
  // OW-T0231 extracted the mint gate wiring out of index.ts (a thin
  // Deno.serve wrapper vitest cannot import) into handler.ts, which is
  // importable and exercised directly by handler.test.ts. The structural
  // audit below now reads handler.ts, where the wiring actually lives.
  return readFileSync(join(FUNCTIONS_DIR, "ow-or-proxy", "handler.ts"), "utf8");
}

/** Every non-test .ts file directly under a function's own directory,
 *  concatenated. A caller's wiring can live in more than one file (OW-T0231
 *  split ow-or-proxy into a thin index.ts and an importable handler.ts), so
 *  a check that reads only index.ts silently stops seeing it the moment a
 *  function is split. Reading the whole directory keeps this test correct
 *  regardless of how many files a caller's implementation is split across. */
function readFunctionSources(fn: string): string {
  const dir = join(FUNCTIONS_DIR, fn);
  return readdirSync(dir)
    .filter((entry) => entry.endsWith(".ts") && !entry.endsWith(".test.ts"))
    .filter((entry) => statSync(join(dir, entry)).isFile())
    .map((entry) => readFileSync(join(dir, entry), "utf8"))
    .join("\n");
}

/**
 * Returns a list of what is wrong with the kill switch wiring in the given
 * ow-or-proxy source. Empty means the gate is present, negated, fed by the
 * app_flags row this repo names, and positioned ahead of both the mint body
 * and the outbound call.
 *
 * Written as a pure function over text so the mutation tests below can feed it
 * a deliberately broken version of the real file.
 */
export function auditMintGate(source: string): string[] {
  const problems: string[] = [];

  const at = (needle: string | RegExp): number => {
    if (typeof needle === "string") return source.indexOf(needle);
    const match = needle.exec(source);
    return match ? match.index : -1;
  };

  const branch = at(/else if \(\s*endpoint === "or-link-mint-token"\s*\)/);
  if (branch < 0) {
    // Nothing below can be located without it, so stop here rather than
    // report a cascade of derived failures.
    return ["the or-link-mint-token branch was not found in ow-or-proxy/index.ts"];
  }

  const flagRead = at("readStealthSyncEnabled(");
  const negatedTest = at(/if \(!stealthAllowed\)/);
  const refusalBody = at(
    "{ error: STEALTH_SYNC_DISABLED_ERROR, message: STEALTH_SYNC_DISABLED_MESSAGE }",
  );
  const mintBody = at(/orBody = \{ app_user_id: user\.id, ttl_seconds/);
  const outbound = at("await callOr(deps, endpoint, orBody)");

  if (flagRead < 0) problems.push("the mint branch does not call readStealthSyncEnabled");
  if (negatedTest < 0) {
    // Catches the inversion, which is the one edit that leaves every other
    // assertion here satisfied while opening the door.
    problems.push("the refusal is not written as `if (!stealthAllowed)`");
  }
  if (refusalBody < 0) problems.push("the refusal does not return the stable disabled code");
  if (mintBody < 0) problems.push("the mint body assembly was not found");
  if (outbound < 0) problems.push("the outbound callOr was not found");

  if (flagRead >= 0 && flagRead < branch) {
    problems.push("the flag is read outside the mint branch");
  }
  if (negatedTest >= 0 && flagRead >= 0 && negatedTest < flagRead) {
    problems.push("the refusal is tested before the flag is read");
  }
  if (refusalBody >= 0 && mintBody >= 0 && refusalBody > mintBody) {
    problems.push("the refusal comes after the mint body is assembled");
  }
  if (refusalBody >= 0 && outbound >= 0 && refusalBody > outbound) {
    problems.push("the refusal comes after the outbound request");
  }

  if (refusalBody >= 0 && negatedTest >= 0) {
    const refusal = source.slice(negatedTest, refusalBody + 400);
    if (!refusal.includes("return jsonResponse(")) {
      problems.push("the refusal does not return, so execution continues into the mint");
    }
    if (!/\n\s*503,/.test(refusal)) {
      problems.push("the refusal does not answer 503");
    }
  }

  if (flagRead >= 0 && negatedTest >= 0) {
    // The reader is injected, so the query lives at the call site and can be
    // repointed at another row without touching the gate itself.
    const reader = source.slice(flagRead, negatedTest);
    if (!reader.includes('.from("app_flags")')) {
      problems.push("the injected reader does not query app_flags");
    }
    if (!reader.includes('.select("enabled")')) {
      problems.push("the injected reader does not select the enabled column");
    }
    if (!reader.includes('.eq("key", STEALTH_SYNC_FLAG_KEY)')) {
      problems.push("the injected reader does not key on STEALTH_SYNC_FLAG_KEY");
    }
  }

  return problems;
}

describe("private wallet kill switch wiring in ow-or-proxy", () => {
  it("finds the edge function sources it is supposed to be scanning", () => {
    // Without this, a moved directory turns every scan below into a silent
    // pass over an empty list and the guard stops guarding anything.
    const files = collectTsFiles(FUNCTIONS_DIR);
    expect(files.length).toBeGreaterThan(10);
    expect(existsSync(join(FUNCTIONS_DIR, "ow-or-proxy", "index.ts"))).toBe(true);
  });

  it("gates the mint on the switch, before the token is minted", () => {
    const problems = auditMintGate(readProxySource());
    expect(problems, `kill switch wiring: ${problems.join("; ")}`).toEqual([]);
  });
});

describe("who can mint a widget token", () => {
  it("has no unaccounted caller of the mint endpoint", () => {
    // A new caller is not a formatting change. It is a second door, and it
    // has to be looked at by someone before it ships.
    expect(findMintCallers()).toEqual([...MINT_TOKEN_CALLERS].sort());
  });

  it("classifies every known caller as gated or baselined, and never both", () => {
    const classified = [...GATED_CALLERS, ...UNGATED_BASELINE].sort();
    expect(classified).toEqual([...MINT_TOKEN_CALLERS].sort());
    expect(GATED_CALLERS.filter((fn) => UNGATED_BASELINE.includes(fn))).toEqual([]);
  });

  it.each(GATED_CALLERS)("%s consults the kill switch before minting", (fn) => {
    const source = readFunctionSources(fn);
    expect(source).toContain("_shared/stealth-flag.ts");
    expect(source).toContain("readStealthSyncEnabled");
  });

  it.each(UNGATED_BASELINE)(
    "%s is still ungated, so the baseline is still telling the truth",
    (fn) => {
      const source = readFunctionSources(fn);
      expect(
        source.includes("readStealthSyncEnabled"),
        `${fn} now reads the kill switch. Move it from UNGATED_BASELINE to GATED_CALLERS in this file, in the same PR that closed the door.`,
      ).toBe(false);
    },
  );
});

/**
 * The guard on the guard. Each mutation below is one of the three ways this
 * gate has been identified as breakable, applied to the real source in memory.
 * If the audit accepts a mutated source, the audit is decoration.
 */
describe("the wiring audit can actually fail", () => {
  const mutations: { name: string; mutate: (s: string) => string }[] = [
    {
      name: "the condition is inverted",
      mutate: (s) => s.replace("if (!stealthAllowed)", "if (stealthAllowed)"),
    },
    {
      name: "the mint body is assembled before the refusal",
      mutate: (s) =>
        s.replace(
          "const stealthAllowed = await readStealthSyncEnabled(",
          "orBody = { app_user_id: user.id, ttl_seconds: undefined };\n      const stealthAllowed = await readStealthSyncEnabled(",
        ),
    },
    {
      name: "the reader is repointed at another flag row",
      mutate: (s) =>
        s.replace('.eq("key", STEALTH_SYNC_FLAG_KEY)', '.eq("key", "some_other_flag")'),
    },
  ];

  it.each(mutations)("rejects a source where $name", ({ mutate }) => {
    const source = readProxySource();
    const broken = mutate(source);

    // A mutation that no longer matches anything would make this test pass on
    // unmutated source, which is exactly the silent success it exists to catch.
    expect(broken, "the mutation matched nothing, so it proved nothing").not.toBe(source);

    expect(auditMintGate(broken).length).toBeGreaterThan(0);
  });
});
