/**
 * @vitest-environment node
 *
 * Phase 4.4 — HouseholdPage expiry-badge formatting.
 *
 * The "Expires in N days" badge has three tone bands (ok / warn /
 * danger) plus an "Expired" terminal state. These tests pin the
 * boundaries so a typo in a Math.ceil somewhere doesn't silently
 * flip a near-expiry badge from destructive to secondary.
 */

import { describe, it, expect } from "vitest";
import { formatExpiresBadge } from "@/components/settings/HouseholdPage";

function isoFromNow(ms: number): string {
  return new Date(Date.now() + ms).toISOString();
}

describe("formatExpiresBadge", () => {
  it("renders 'Expired' for a past timestamp", () => {
    const out = formatExpiresBadge(isoFromNow(-1_000));
    expect(out.label).toBe("Expired");
    expect(out.tone).toBe("danger");
  });

  it("renders the hours-left form (danger) when <= 2 days remain", () => {
    const out = formatExpiresBadge(isoFromNow(12 * 60 * 60 * 1000));
    expect(out.tone).toBe("danger");
    expect(out.label).toMatch(/Expires in \d+h/);
  });

  it("renders warn tone for 3–7 days remaining", () => {
    const out = formatExpiresBadge(isoFromNow(5 * 24 * 60 * 60 * 1000));
    expect(out.tone).toBe("warn");
    expect(out.label).toMatch(/Expires in 5d/);
  });

  it("renders ok tone for > 7 days remaining", () => {
    const out = formatExpiresBadge(isoFromNow(30 * 24 * 60 * 60 * 1000));
    expect(out.tone).toBe("ok");
    expect(out.label).toMatch(/Expires in \d+d/);
  });
});
