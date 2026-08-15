/**
 * "Sync all" routing and reporting, contract tests.
 *
 * The sentence these exist to prevent: "Sync all: no new transactions across
 * any wallet" shown to someone for whom nothing was attempted.
 */

import { describe, it, expect } from "vitest";
import { planSyncAll, reportSyncAll } from "../sync-all";

describe("planSyncAll", () => {
  it("sends ordinary connections and holds back private ones", () => {
    expect(
      planSyncAll([{ id: "a" }, { id: "b", is_stealth: true }, { id: "c", is_stealth: false }]),
    ).toEqual({ syncableIds: ["a", "c"], skippedPrivateIds: ["b"] });
  });

  it("treats an absent flag as ordinary", () => {
    // is_stealth is optional on the wire. Absent must never reclassify a
    // connection as private and quietly exclude it from a bulk sync.
    expect(planSyncAll([{ id: "a" }]).syncableIds).toEqual(["a"]);
    expect(planSyncAll([{ id: "a" }]).skippedPrivateIds).toEqual([]);
  });

  it("sends nothing when every connection is private", () => {
    expect(planSyncAll([{ id: "a", is_stealth: true }])).toEqual({
      syncableIds: [],
      skippedPrivateIds: ["a"],
    });
  });
});

describe("reportSyncAll", () => {
  const base = { synced: 0, skippedPrivateCount: 0, stealthSyncEnabled: true };

  it("never says up to date when nothing was attempted", () => {
    // THE DEFECT. One requested id, no entry returned, synced 0. The old code
    // read this as "no new transactions across any wallet".
    const report = reportSyncAll({ ...base, requestedIds: ["a"], returned: [] });
    expect(report.missingIds).toEqual(["a"]);
    const text = report.toasts.map((t) => t.message).join(" ");
    expect(text).not.toMatch(/no new transactions/i);
    expect(text).toMatch(/nothing was attempted/i);
    expect(report.toasts[0]?.level).toBe("warning");
  });

  it("flags the untouched ones even when others succeeded", () => {
    const report = reportSyncAll({
      ...base,
      requestedIds: ["a", "b"],
      returned: [{ connection_id: "a", synced: 3 }],
      synced: 3,
    });
    expect(report.missingIds).toEqual(["b"]);
    expect(report.toasts.map((t) => t.level)).toEqual(["success", "warning"]);
    expect(report.toasts[1]?.message).toMatch(/1 connection was not attempted/);
  });

  it("says up to date only when every requested id came back with zero", () => {
    const report = reportSyncAll({
      ...base,
      requestedIds: ["a", "b"],
      returned: [
        { connection_id: "a", synced: 0 },
        { connection_id: "b", synced: 0 },
      ],
    });
    expect(report.missingIds).toEqual([]);
    expect(report.toasts).toEqual([
      { level: "info", message: "Sync all: no new transactions across any wallet." },
    ]);
  });

  it("reports private connections that were held back", () => {
    const report = reportSyncAll({
      ...base,
      requestedIds: ["a"],
      returned: [{ connection_id: "a", synced: 0 }],
      skippedPrivateCount: 2,
    });
    const messages = report.toasts.map((t) => t.message);
    expect(messages.some((m) => /2 private connections were skipped/.test(m))).toBe(true);
  });

  it("does not promise an individual sync that is switched off", () => {
    // While the private-scan entry is dark, "use Sync on each one" would send
    // the user to a button that also does nothing.
    const report = reportSyncAll({
      ...base,
      stealthSyncEnabled: false,
      requestedIds: [],
      returned: [],
      skippedPrivateCount: 1,
    });
    const text = report.toasts.map((t) => t.message).join(" ");
    expect(text).toMatch(/can't be synced here yet/);
    expect(text).not.toMatch(/Use Sync/);
  });

  it("says nothing was syncable rather than up to date when only private exist", () => {
    const report = reportSyncAll({
      ...base,
      requestedIds: [],
      returned: [],
      skippedPrivateCount: 1,
    });
    const text = report.toasts.map((t) => t.message).join(" ");
    expect(text).not.toMatch(/no new transactions/i);
    expect(text).toMatch(/one at a time/i);
  });

  it("keeps the error wording and counts", () => {
    const report = reportSyncAll({
      ...base,
      requestedIds: ["a", "b"],
      returned: [
        { connection_id: "a", synced: 0, error: "boom" },
        { connection_id: "b", synced: 0, error: "bang" },
      ],
      firstErrorMessage: "Upstream said no.",
    });
    expect(report.toasts[0]?.level).toBe("error");
    expect(report.toasts[0]?.message).toBe(
      "2 connections couldn't sync: Upstream said no. (and 1 other)",
    );
  });

  it("warns rather than celebrates when some synced and some errored", () => {
    const report = reportSyncAll({
      ...base,
      requestedIds: ["a", "b"],
      returned: [
        { connection_id: "a", synced: 5 },
        { connection_id: "b", synced: 0, error: "boom" },
      ],
      synced: 5,
      firstErrorMessage: "Upstream said no.",
    });
    expect(report.toasts[0]?.level).toBe("warning");
    expect(report.toasts[0]?.message).toMatch(/Synced 5 across 1 wallet; 1 had trouble/);
  });
});
