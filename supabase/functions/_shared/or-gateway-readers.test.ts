/**
 * Guard test: every edge function resolves the Orange Rails gateway through
 * _shared/or-gateway.ts, and none of them reads OR_SUPABASE_URL directly.
 *
 * or-gateway.test.ts proves the resolver is correct. This proves the resolver
 * is USED. Those are different claims, and only the second one decays over
 * time: a new function gets written by copying an older one, keeps its own
 * inline host handling, and hands X-Platform-API-Key to whatever the env var
 * happens to name, with every other test still passing.
 *
 * If this test fails on a function you just wrote, the fix is not to add the
 * file to an exception list. Import getOrGatewayFromEnv and refuse the request
 * when it returns null, exactly as the three readers below do.
 */

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const SHARED_DIR = dirname(fileURLToPath(import.meta.url));
const FUNCTIONS_DIR = join(SHARED_DIR, "..");

/** The one file allowed to read the raw env var. */
const RESOLVER_PATH = join(SHARED_DIR, "or-gateway.ts");

/**
 * Every function that dials the OR gateway. Adding a reader means adding it
 * here, which is the point: the list is the contract, and a new reader that
 * skips the resolver fails the second assertion below rather than shipping.
 */
const KNOWN_READERS = [
  "ow-or-proxy",
  "owm-or-quick-connect",
  "owm-or-discover-quiltt",
];

const DIRECT_READ = /Deno\s*\.\s*env\s*\.\s*get\(\s*["'`]OR_SUPABASE_URL["'`]\s*\)/;

function collectTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...collectTsFiles(full));
    } else if (entry.endsWith(".ts")) {
      out.push(full);
    }
  }
  return out;
}

describe("OR gateway readers", () => {
  it("finds the edge function sources it is supposed to be scanning", () => {
    // Without this, a moved directory turns the scan below into a silent
    // pass over an empty list, and the guard stops guarding anything.
    const files = collectTsFiles(FUNCTIONS_DIR);
    expect(files.length).toBeGreaterThan(KNOWN_READERS.length);
  });

  it("has no direct OR_SUPABASE_URL read outside the resolver", () => {
    const offenders = collectTsFiles(FUNCTIONS_DIR)
      .filter((file) => file !== RESOLVER_PATH)
      .filter((file) => DIRECT_READ.test(readFileSync(file, "utf8")))
      .map((file) => relative(FUNCTIONS_DIR, file));

    // Named in the message so a failure says which file to fix, not just
    // that something somewhere is wrong.
    expect(
      offenders,
      `read OR_SUPABASE_URL directly: ${offenders.join(", ")}`,
    ).toEqual([]);
  });

  it.each(KNOWN_READERS)("%s resolves through getOrGatewayFromEnv", (fn) => {
    const source = readFileSync(join(FUNCTIONS_DIR, fn, "index.ts"), "utf8");
    expect(source).toContain("getOrGatewayFromEnv");
    expect(source).toContain("_shared/or-gateway.ts");
  });
});
