import { describe, it, expect } from "vitest";
import { timeAgoCompact, timeAgoShort, syncBadgeText } from "./sync-age";

/** Fixed epoch so every assertion is deterministic regardless of when the test runs. */
const NOW = 1_700_000_000_000;

/** Produce an ISO string for a point that is `msAgo` milliseconds before NOW. */
function iso(msAgo: number): string {
  return new Date(NOW - msAgo).toISOString();
}

// ---------------------------------------------------------------------------
// timeAgoCompact (paths 1-4: the four output buckets)
// ---------------------------------------------------------------------------

describe("timeAgoCompact", () => {
  it("path 1: returns 'just now' when under 1 minute", () => {
    expect(timeAgoCompact(iso(0), NOW)).toBe("just now");
    expect(timeAgoCompact(iso(30_000), NOW)).toBe("just now");
    expect(timeAgoCompact(iso(59_999), NOW)).toBe("just now");
  });

  it("path 2: returns 'Xm ago' for 1 to 59 minutes", () => {
    expect(timeAgoCompact(iso(60_000), NOW)).toBe("1m ago");
    expect(timeAgoCompact(iso(5 * 60_000), NOW)).toBe("5m ago");
    expect(timeAgoCompact(iso(59 * 60_000), NOW)).toBe("59m ago");
  });

  it("path 3: returns 'Xh ago' for 1 to 23 hours", () => {
    expect(timeAgoCompact(iso(60 * 60_000), NOW)).toBe("1h ago");
    expect(timeAgoCompact(iso(12 * 3_600_000), NOW)).toBe("12h ago");
    expect(timeAgoCompact(iso(23 * 3_600_000), NOW)).toBe("23h ago");
  });

  it("path 4: returns 'Xd ago' for 24 hours or more", () => {
    expect(timeAgoCompact(iso(24 * 3_600_000), NOW)).toBe("1d ago");
    expect(timeAgoCompact(iso(48 * 3_600_000), NOW)).toBe("2d ago");
  });
});

// ---------------------------------------------------------------------------
// timeAgoShort (path 5: the long-form label used in the tooltip)
// ---------------------------------------------------------------------------

describe("timeAgoShort", () => {
  it("returns 'just now' when under 1 minute", () => {
    expect(timeAgoShort(iso(0), NOW)).toBe("just now");
  });

  it("returns 'X min ago' for minutes", () => {
    expect(timeAgoShort(iso(3 * 60_000), NOW)).toBe("3 min ago");
  });

  it("returns singular '1 hour ago'", () => {
    expect(timeAgoShort(iso(3_600_000), NOW)).toBe("1 hour ago");
  });

  it("returns plural 'X hours ago'", () => {
    expect(timeAgoShort(iso(3 * 3_600_000), NOW)).toBe("3 hours ago");
  });

  it("returns singular '1 day ago'", () => {
    expect(timeAgoShort(iso(24 * 3_600_000), NOW)).toBe("1 day ago");
  });

  it("returns plural 'X days ago'", () => {
    expect(timeAgoShort(iso(48 * 3_600_000), NOW)).toBe("2 days ago");
  });
});

// ---------------------------------------------------------------------------
// syncBadgeText (path 6 + path 7 boundary)
// ---------------------------------------------------------------------------

describe("syncBadgeText", () => {
  it("path 6a: returns null when lastSyncAt is null (no sync on record)", () => {
    expect(syncBadgeText(null, NOW)).toBeNull();
  });

  it("path 6b: returns compact text when synced recently", () => {
    expect(syncBadgeText(iso(5 * 60_000), NOW)).toBe("5m ago");
    expect(syncBadgeText(iso(2 * 3_600_000), NOW)).toBe("2h ago");
  });

  it("path 6c: returns null when synced more than 24h ago", () => {
    // One millisecond past the boundary: pill must disappear.
    expect(syncBadgeText(iso(24 * 3_600_000 + 1), NOW)).toBeNull();
    expect(syncBadgeText(iso(48 * 3_600_000), NOW)).toBeNull();
  });

  it("path 7 (boundary): returns '1d ago' at exactly 24h 00m 00s (guard is strictly >)", () => {
    // The check in AccountCard was `if (ageMs > 24 * 60 * 60 * 1000) return null`.
    // Strictly greater-than means the pill still shows at the exact boundary.
    // An off-by-one change to >= would break this test and reveal the regression.
    const EXACTLY_24H = 24 * 60 * 60 * 1000;
    expect(syncBadgeText(iso(EXACTLY_24H), NOW)).toBe("1d ago");
  });
});
