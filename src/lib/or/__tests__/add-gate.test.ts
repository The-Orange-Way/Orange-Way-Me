/**
 * The add door of the stealth kill switch, contract tests.
 *
 * The sentence these exist to prevent: "the flag is off, so the feature is
 * off". It was not. The flag closed the sync path and the add path never read
 * it, so private-wallet connections could still be created while everyone
 * believed the switch had closed the feature.
 */

import { describe, it, expect } from "vitest";
import {
  STEALTH_CATALOGUE_SLUGS,
  STEALTH_ADD_DISABLED_MESSAGE,
  isStealthCatalogueSlug,
  planCatalogueAdd,
} from "../add-gate";

describe("isStealthCatalogueSlug", () => {
  it("recognises every gated slug, however it is cased or padded", () => {
    for (const slug of STEALTH_CATALOGUE_SLUGS) {
      expect(isStealthCatalogueSlug(slug)).toBe(true);
      expect(isStealthCatalogueSlug(slug.toUpperCase())).toBe(true);
      expect(isStealthCatalogueSlug(`  ${slug}  `)).toBe(true);
    }
  });

  it("does not claim a non-private slug, an empty string, or a missing one", () => {
    expect(isStealthCatalogueSlug("quiltt")).toBe(false);
    expect(isStealthCatalogueSlug("blink")).toBe(false);
    expect(isStealthCatalogueSlug("")).toBe(false);
    expect(isStealthCatalogueSlug("   ")).toBe(false);
    expect(isStealthCatalogueSlug(null)).toBe(false);
    expect(isStealthCatalogueSlug(undefined)).toBe(false);
  });

  it("pins the gated list, so a new private-wallet source cannot be added without adding it here", () => {
    // Failing this test is the intended alarm, not an inconvenience. If the
    // catalogue gains another private-wallet route, it belongs in the module
    // and then in this list, in that order.
    expect([...STEALTH_CATALOGUE_SLUGS].sort()).toEqual(["sparrow", "xpub", "xpub_stealth"]);
  });
});

describe("planCatalogueAdd with the flag OFF", () => {
  it("refuses every gated slug, and says the feature is temporarily unavailable", () => {
    for (const slug of STEALTH_CATALOGUE_SLUGS) {
      const decision = planCatalogueAdd({ slug, stealthSyncEnabled: false });
      expect(decision.allowed).toBe(false);
      expect(decision).toEqual({
        allowed: false,
        reason: "stealth-disabled",
        message: STEALTH_ADD_DISABLED_MESSAGE,
      });
    }
  });

  it("refuses an add that names no slug, because the catalogue it opens contains the gated ones", () => {
    // We do not host the catalogue, so we cannot remove entries from it. An
    // add that can reach a gated slug is treated as reaching one.
    expect(planCatalogueAdd({ stealthSyncEnabled: false }).allowed).toBe(false);
    expect(planCatalogueAdd({ slug: null, stealthSyncEnabled: false }).allowed).toBe(false);
    expect(planCatalogueAdd({ slug: "   ", stealthSyncEnabled: false }).allowed).toBe(false);
  });

  it("leaves the bank route alone, which is the biggest risk in this change", () => {
    expect(planCatalogueAdd({ slug: "quiltt", stealthSyncEnabled: false })).toEqual({
      allowed: true,
    });
  });

  it("leaves other named non-private sources alone", () => {
    expect(planCatalogueAdd({ slug: "blink", stealthSyncEnabled: false }).allowed).toBe(true);
    expect(planCatalogueAdd({ slug: "strike", stealthSyncEnabled: false }).allowed).toBe(true);
  });
});

describe("planCatalogueAdd with the flag ON", () => {
  it("passes the gated slugs through unchanged", () => {
    for (const slug of STEALTH_CATALOGUE_SLUGS) {
      expect(planCatalogueAdd({ slug, stealthSyncEnabled: true })).toEqual({ allowed: true });
    }
  });

  it("passes an add that names no slug, which is how the catalogue button behaves today", () => {
    expect(planCatalogueAdd({ stealthSyncEnabled: true })).toEqual({ allowed: true });
  });

  it("passes the bank route", () => {
    expect(planCatalogueAdd({ slug: "quiltt", stealthSyncEnabled: true })).toEqual({
      allowed: true,
    });
  });
});

describe("planCatalogueAdd fails closed when the flag cannot be read", () => {
  // runtimeFlags.ts already fails closed on the READ of the flag: a query
  // error, a missing row, or a boot that has not resolved yet all leave it
  // false. This is the same rule one layer up, for a caller that hands us
  // something other than a boolean. An unreadable kill switch is not an open
  // one, so none of these may pass on truthiness.
  const notTrue: unknown[] = [undefined, null, "true", "false", 1, 0, {}, [], NaN];

  it("refuses a gated slug for every non-boolean-true flag value", () => {
    for (const value of notTrue) {
      expect(planCatalogueAdd({ slug: "xpub", stealthSyncEnabled: value }).allowed).toBe(false);
    }
  });

  it("refuses an add with no named slug for every non-boolean-true flag value", () => {
    for (const value of notTrue) {
      expect(planCatalogueAdd({ stealthSyncEnabled: value }).allowed).toBe(false);
    }
  });

  it("still lets the bank route through, so an unreadable flag cannot break bank connect", () => {
    for (const value of notTrue) {
      expect(planCatalogueAdd({ slug: "quiltt", stealthSyncEnabled: value }).allowed).toBe(true);
    }
  });
});
