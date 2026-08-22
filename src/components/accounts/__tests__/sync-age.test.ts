import { describe, it, expect } from "vitest";
import { timeAgoCompact, timeAgoShort, syncBadgeText } from "../sync-age";

/**
 * DL-1460. A beta tester opened the app and saw a green "Synced" badge on the
 * accounts page when the last sync had actually been the previous day. The
 * badge showed the word "Synced" and nothing else; the age lived only inside a
 * tooltip, which does not open on a phone, which is where she was.
 *
 * These tests lock the property that actually matters: whatever the badge
 * renders, it always carries the age with it, so it can never make a bare
 * present-tense claim about a stale reading.
 */

const NOW = new Date("2026-08-21T12:00:00.000Z").getTime();
const ago = (ms: number) => new Date(NOW - ms).toISOString();

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe("timeAgoCompact, the age shown on the badge face", () => {
  it("names the age for a sync from the previous day, the case in the report", () => {
    // 18 hours old: inside the 24h window that still renders the green pill,
    // so this is exactly the reading the tester saw described as "Synced".
    expect(timeAgoCompact(ago(18 * HOUR), NOW)).toBe("18h ago");
  });

  it("never returns an empty or bare string, at any age", () => {
    for (const age of [0, 30_000, MIN, 59 * MIN, HOUR, 23 * HOUR, DAY, 5 * DAY]) {
      const label = timeAgoCompact(ago(age), NOW);
      expect(label.length).toBeGreaterThan(0);
      expect(label).not.toBe("Synced");
    }
  });

  it("uses minutes under an hour and hours under a day", () => {
    expect(timeAgoCompact(ago(5 * MIN), NOW)).toBe("5m ago");
    expect(timeAgoCompact(ago(59 * MIN), NOW)).toBe("59m ago");
    expect(timeAgoCompact(ago(HOUR), NOW)).toBe("1h ago");
    expect(timeAgoCompact(ago(23 * HOUR), NOW)).toBe("23h ago");
  });

  it("rolls over to days at exactly 24 hours", () => {
    expect(timeAgoCompact(ago(DAY), NOW)).toBe("1d ago");
    expect(timeAgoCompact(ago(3 * DAY), NOW)).toBe("3d ago");
  });

  it("says just now under a minute rather than 0m ago", () => {
    expect(timeAgoCompact(ago(0), NOW)).toBe("just now");
    expect(timeAgoCompact(ago(59_000), NOW)).toBe("just now");
  });
});

describe("both helpers read the clock they are given", () => {
  /**
   * timeAgoShort previously called Date.now() itself, so the tooltip text was
   * frozen at first render even though useNow re-rendered the component every
   * minute. Passing the clock in is what makes the label move.
   */
  it("returns a different answer when the caller's clock advances", () => {
    const synced = ago(HOUR);
    expect(timeAgoShort(synced, NOW)).toBe("1 hour ago");
    expect(timeAgoShort(synced, NOW + 2 * HOUR)).toBe("3 hours ago");
    expect(timeAgoCompact(synced, NOW)).toBe("1h ago");
    expect(timeAgoCompact(synced, NOW + 2 * HOUR)).toBe("3h ago");
  });

  it("pluralises the long form correctly", () => {
    expect(timeAgoShort(ago(HOUR), NOW)).toBe("1 hour ago");
    expect(timeAgoShort(ago(2 * HOUR), NOW)).toBe("2 hours ago");
    expect(timeAgoShort(ago(DAY), NOW)).toBe("1 day ago");
    expect(timeAgoShort(ago(2 * DAY), NOW)).toBe("2 days ago");
  });
});

describe("syncBadgeText, pill visibility and compact label", () => {
  it("returns null when lastSyncAt is null (no sync on record)", () => {
    expect(syncBadgeText(null, NOW)).toBeNull();
  });

  it("returns compact text when synced recently", () => {
    expect(syncBadgeText(ago(5 * MIN), NOW)).toBe("5m ago");
    expect(syncBadgeText(ago(2 * HOUR), NOW)).toBe("2h ago");
  });

  it("returns null when synced more than 24h ago", () => {
    // One millisecond past the boundary: pill must disappear.
    expect(syncBadgeText(ago(DAY + 1), NOW)).toBeNull();
    expect(syncBadgeText(ago(2 * DAY), NOW)).toBeNull();
  });

  it("returns '1d ago' at exactly 24h 00m 00s (guard is strictly >)", () => {
    // syncBadgeText uses `ageMs > 24 * 60 * 60 * 1000` (strictly greater-than).
    // The pill shows at the exact boundary; >= would break this test.
    expect(syncBadgeText(ago(DAY), NOW)).toBe("1d ago");
  });
});
