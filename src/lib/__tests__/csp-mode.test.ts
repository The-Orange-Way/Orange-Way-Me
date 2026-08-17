/**
 * The per-environment CSP switch (scripts/csp-mode-plugin.ts).
 *
 * The behaviour worth pinning here is not "the string got replaced". It is the
 * direction of failure: every way this can go wrong must land on Report-Only,
 * because a wrong Report-Only header logs a violation and a wrong enforcing
 * header takes the site down. The one exception is an undeterminable target on
 * Cloudflare Pages, which must throw rather than pick either.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

import { applyCspMode, resolveCspMode, ENFORCING_BRANCHES } from "../../../scripts/csp-mode-plugin";

const REPORT_ONLY = `/*
  Content-Security-Policy-Report-Only: default-src 'self'; script-src 'self'
  X-Frame-Options: DENY
`;

const ENFORCING = `/*
  Content-Security-Policy: default-src 'self'; script-src 'self'
  X-Frame-Options: DENY
`;

describe("applyCspMode", () => {
  it("upgrades Report-Only to enforcing", () => {
    expect(applyCspMode(REPORT_ONLY, "enforce")).toBe(ENFORCING);
  });

  it("downgrades enforcing to Report-Only", () => {
    expect(applyCspMode(ENFORCING, "report-only")).toBe(REPORT_ONLY);
  });

  it("is a no-op when the file is already in the requested mode", () => {
    expect(applyCspMode(ENFORCING, "enforce")).toBe(ENFORCING);
    expect(applyCspMode(REPORT_ONLY, "report-only")).toBe(REPORT_ONLY);
  });

  it("leaves the policy body untouched", () => {
    // The rewrite is on the header name only. If it ever starts editing the
    // directives, that is a security change disguised as a build detail.
    const out = applyCspMode(REPORT_ONLY, "enforce");
    expect(out).toContain("default-src 'self'; script-src 'self'");
    expect(out).toContain("X-Frame-Options: DENY");
  });

  it("does not mistake the Report-Only header for an enforcing one", () => {
    // "Content-Security-Policy-Report-Only:" contains no "Content-Security-
    // Policy:" substring, but a careless match on the prefix would see one and
    // conclude the file carries both.
    expect(() => applyCspMode(REPORT_ONLY, "enforce")).not.toThrow();
  });

  it("throws when the file carries no policy at all", () => {
    expect(() => applyCspMode("/*\n  X-Frame-Options: DENY\n", "enforce")).toThrow(
      /no Content-Security-Policy line/,
    );
  });

  it("throws when the file carries both policies", () => {
    expect(() => applyCspMode(REPORT_ONLY + ENFORCING, "enforce")).toThrow(
      /both an enforcing and a Report-Only/,
    );
  });
});

describe("resolveCspMode", () => {
  it("enforces on a Cloudflare Pages build of an enforcing branch", () => {
    const { mode, reason } = resolveCspMode({ CF_PAGES: "1", CF_PAGES_BRANCH: "dev" });
    expect(mode).toBe("enforce");
    expect(reason).toBe("CF_PAGES_BRANCH=dev");
  });

  it("reports on a Cloudflare Pages build of prod", () => {
    // The whole point of the change: prod and dev build from the same commit
    // and must not get the same header.
    expect(resolveCspMode({ CF_PAGES: "1", CF_PAGES_BRANCH: "prod" }).mode).toBe("report-only");
  });

  it("reports on a preview branch", () => {
    expect(resolveCspMode({ CF_PAGES: "1", CF_PAGES_BRANCH: "fix/some-branch" }).mode).toBe(
      "report-only",
    );
  });

  it("throws on Pages when the branch cannot be determined", () => {
    // Auditor requirement on PR 298: fail loudly rather than fall back
    // silently. Falling back to report-only here would be safe for prod and
    // silently wrong for dev, and nobody would notice for weeks.
    expect(() => resolveCspMode({ CF_PAGES: "1" })).toThrow(/cannot be determined/);
    expect(() => resolveCspMode({ CF_PAGES: "1", CF_PAGES_BRANCH: "  " })).toThrow(
      /cannot be determined/,
    );
  });

  it("reports on a local build with no deployment target", () => {
    const { mode, reason } = resolveCspMode({});
    expect(mode).toBe("report-only");
    expect(reason).toBe("local build, no deployment target");
  });

  it("lets OW_CSP_TARGET override the Pages branch", () => {
    expect(
      resolveCspMode({ CF_PAGES: "1", CF_PAGES_BRANCH: "prod", OW_CSP_TARGET: "dev" }).mode,
    ).toBe("enforce");
    expect(
      resolveCspMode({ CF_PAGES: "1", CF_PAGES_BRANCH: "dev", OW_CSP_TARGET: "prod" }).mode,
    ).toBe("report-only");
  });
});

describe("public/_headers", () => {
  const headers = fs.readFileSync(path.resolve(__dirname, "../../../public/_headers"), "utf8");

  it("ships Report-Only as the static baseline", () => {
    // This is the safety property. The plugin can only upgrade, so if this file
    // ever goes back to a bare enforcing header, every environment enforces at
    // once and the per-environment switch is a decoration.
    expect(headers).toContain("Content-Security-Policy-Report-Only:");
    expect(/(^|\s)Content-Security-Policy:/m.test(headers)).toBe(false);
  });

  it("is accepted by the rewriter in both directions", () => {
    const enforced = applyCspMode(headers, "enforce");
    expect(/(^|\s)Content-Security-Policy:/m.test(enforced)).toBe(true);
    expect(applyCspMode(enforced, "report-only")).toBe(headers);
  });
});

describe("ENFORCING_BRANCHES", () => {
  it("does not yet include prod", () => {
    // Adding "prod" is the promotion, and the criterion is written in
    // public/_headers. This test is the reminder that it is a deliberate act.
    expect(ENFORCING_BRANCHES).toContain("dev");
    expect(ENFORCING_BRANCHES).not.toContain("prod");
  });
});
