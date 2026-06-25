/**
 * Unit tests for the shared CORS allowlist helpers.
 *
 * These helpers are pure (no Deno / no network) so we exercise them
 * directly from Node-based vitest. The companion Deno-runtime piece
 * (buildCorsHeaders + getAllowedOriginsFromEnv) is covered by a
 * post-deploy smoke test.
 */
import { describe, expect, it } from "vitest";

import { isOriginAllowed, parseAllowedOrigins } from "../../../supabase/functions/_shared/http.ts";

const PROD_ALLOWLIST = [
  "https://orangeway.app",
  "https://orangeway.dev",
  "https://orangeway-dev.pages.dev",
  "https://orangeway-prod.pages.dev",
  "http://localhost:8080",
  "http://localhost:5173",
];

describe("parseAllowedOrigins", () => {
  it("returns null for undefined/null/empty input", () => {
    expect(parseAllowedOrigins(undefined)).toBeNull();
    expect(parseAllowedOrigins(null)).toBeNull();
    expect(parseAllowedOrigins("")).toBeNull();
    expect(parseAllowedOrigins("   ")).toBeNull();
    expect(parseAllowedOrigins(",,, ,")).toBeNull();
  });

  it("parses a comma-separated list into a Set", () => {
    const parsed = parseAllowedOrigins(PROD_ALLOWLIST.join(","));
    expect(parsed).not.toBeNull();
    expect(parsed!.size).toBe(PROD_ALLOWLIST.length);
    for (const o of PROD_ALLOWLIST) expect(parsed!.has(o)).toBe(true);
  });

  it("strips trailing slashes and whitespace from each entry", () => {
    const parsed = parseAllowedOrigins("  https://orangeway.app/  ,  https://orangeway.dev///  ");
    expect(parsed!.has("https://orangeway.app")).toBe(true);
    expect(parsed!.has("https://orangeway.dev")).toBe(true);
    // No slash-bearing entries leaked through
    expect(parsed!.has("https://orangeway.app/")).toBe(false);
  });
});

describe("isOriginAllowed", () => {
  const allowlist = parseAllowedOrigins(PROD_ALLOWLIST.join(","));

  it("returns true for every configured origin (production + dev preview + local)", () => {
    for (const o of PROD_ALLOWLIST) {
      expect(isOriginAllowed(o, allowlist)).toBe(true);
    }
  });

  it("returns false for unknown origins", () => {
    expect(isOriginAllowed("https://evil.example.com", allowlist)).toBe(false);
    expect(isOriginAllowed("https://orangeway.app.evil.example.com", allowlist)).toBe(false);
    expect(isOriginAllowed("http://orangeway.app", allowlist)).toBe(false); // protocol matters
  });

  it("returns false for empty / null / undefined origin", () => {
    expect(isOriginAllowed("", allowlist)).toBe(false);
    expect(isOriginAllowed(null, allowlist)).toBe(false);
    expect(isOriginAllowed(undefined, allowlist)).toBe(false);
    expect(isOriginAllowed("   ", allowlist)).toBe(false);
  });

  it("returns false when allowlist is null (env unset) — NEVER falls back to *", () => {
    expect(isOriginAllowed("https://orangeway.app", null)).toBe(false);
    expect(isOriginAllowed("https://anything.example", null)).toBe(false);
  });

  it("returns false when allowlist is empty", () => {
    expect(isOriginAllowed("https://orangeway.app", new Set())).toBe(false);
  });

  it("handles trailing-slash mismatches consistently (browser strips, ops may not)", () => {
    // Allowlist entries get normalized at parse time, so a stray slash on
    // either side of the comparison resolves identically.
    expect(isOriginAllowed("https://orangeway.app/", allowlist)).toBe(true);
    expect(isOriginAllowed("https://orangeway.app", allowlist)).toBe(true);

    const slashyAllowlist = parseAllowedOrigins("https://orangeway.app/");
    expect(isOriginAllowed("https://orangeway.app", slashyAllowlist)).toBe(true);
    expect(isOriginAllowed("https://orangeway.app/", slashyAllowlist)).toBe(true);
  });

  it("rejects a substring/prefix attack (no startsWith semantics)", () => {
    expect(isOriginAllowed("https://orangeway.app.attacker.com", allowlist)).toBe(false);
    expect(isOriginAllowed("https://orangeway", allowlist)).toBe(false);
  });
});
