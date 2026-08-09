import { describe, expect, it } from "vitest";
import { isMarketingPath } from "@/lib/observability/analytics-surface";

// Every authenticated / private surface in src/routes as of this change.
// Analytics must never run on any of them.
const APP_PATHS = [
  "/dashboard",
  "/accounts",
  "/accounts/abc-123",
  "/transactions",
  "/budgets",
  "/goals",
  "/goals/abc-123",
  "/wallets",
  "/wallets/abc-123",
  "/cash-flow",
  "/connections",
  "/households",
  "/settings",
  "/settings/profile",
  "/settings/security",
  "/settings/household",
  "/settings/household-security",
  "/settings/import-export",
  "/settings/reset-vault",
  "/ai",
  "/admin",
  "/auth",
  "/join",
  "/reset-password",
];

// Public marketing pages. Analytics is allowed here and only here.
const MARKETING = [
  "/",
  "/about",
  "/features",
  "/pricing",
  "/bitcoin",
  "/security",
  "/privacy",
  "/terms",
  "/faq",
  "/compare",
  "/enterprise",
  "/self-host",
  "/beta",
  "/changelog",
  "/privacy-changelog",
  "/landing-classic",
];

describe("analytics surface gate", () => {
  it.each(APP_PATHS)("refuses analytics on the app surface %s", (path) => {
    expect(isMarketingPath(path)).toBe(false);
  });

  it.each(MARKETING)("allows analytics on the marketing page %s", (path) => {
    expect(isMarketingPath(path)).toBe(true);
  });

  it("treats an unknown path as non-marketing (default deny)", () => {
    // A route added tomorrow, a typo, or a 404 all land here. Silence is the
    // safe answer: a new screen has to be opted in deliberately.
    expect(isMarketingPath("/some-route-that-does-not-exist-yet")).toBe(false);
    expect(isMarketingPath("/dashboard/anything/deeper")).toBe(false);
  });

  it("ignores a trailing slash", () => {
    expect(isMarketingPath("/features/")).toBe(true);
    expect(isMarketingPath("/")).toBe(true);
  });

  it("does not match a marketing path as a prefix of an app path", () => {
    // "/security" is marketing, "/settings/security" is not. Exact match,
    // not startsWith, is what keeps those apart.
    expect(isMarketingPath("/settings/security")).toBe(false);
    expect(isMarketingPath("/security")).toBe(true);
  });

  it("handles an empty pathname without throwing", () => {
    expect(isMarketingPath("")).toBe(true);
  });
});
