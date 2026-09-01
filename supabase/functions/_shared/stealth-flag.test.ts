import { describe, expect, it } from "vitest";

import { readStealthSyncEnabled, STEALTH_SYNC_FLAG_KEY } from "./stealth-flag.ts";

describe("readStealthSyncEnabled", () => {
  it("allows only when the row was read and enabled is exactly true", async () => {
    expect(await readStealthSyncEnabled(async () => ({ data: { enabled: true }, error: null }))).toBe(
      true,
    );
  });

  it("refuses when the row says false", async () => {
    expect(
      await readStealthSyncEnabled(async () => ({ data: { enabled: false }, error: null })),
    ).toBe(false);
  });

  it("refuses when the query returns an error", async () => {
    // The case that matters most: we cannot tell "the switch is on" from
    // "the database did not answer", so we must not guess in the open
    // direction.
    expect(
      await readStealthSyncEnabled(async () => ({
        data: null,
        error: { message: "connection refused" },
      })),
    ).toBe(false);
  });

  it("refuses when the read throws", async () => {
    expect(
      await readStealthSyncEnabled(async () => {
        throw new Error("network down");
      }),
    ).toBe(false);
  });

  it("refuses when the row is absent", async () => {
    // maybeSingle() answers data: null with no error when the key is not
    // there. A fresh database is exactly this shape, so reading it as
    // permission would mean the feature is on before anyone decided it.
    expect(await readStealthSyncEnabled(async () => ({ data: null, error: null }))).toBe(false);
  });

  it("refuses a row with no enabled column", async () => {
    expect(await readStealthSyncEnabled(async () => ({ data: {}, error: null }))).toBe(false);
  });

  it("refuses truthy values that are not the boolean true", async () => {
    for (const value of ["true", 1, "yes", {}, []]) {
      expect(
        await readStealthSyncEnabled(async () => ({ data: { enabled: value }, error: null })),
      ).toBe(false);
    }
  });

  it("refuses a result that is not an object at all", async () => {
    expect(await readStealthSyncEnabled(async () => null)).toBe(false);
    expect(await readStealthSyncEnabled(async () => undefined)).toBe(false);
    expect(await readStealthSyncEnabled(async () => "ok")).toBe(false);
  });

  it("reads the key the migration seeds", () => {
    // Pinned because a typo here is invisible: a key that does not exist
    // reads as a missing row, which fails closed, so the feature would be
    // permanently off with no error anywhere.
    expect(STEALTH_SYNC_FLAG_KEY).toBe("stealth_sync_enabled");
  });
});
