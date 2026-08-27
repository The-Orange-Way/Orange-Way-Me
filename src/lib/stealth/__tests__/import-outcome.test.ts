/**
 * DL-1506.
 *
 * The case these tests exist for: a customer changes their vault password, and
 * every transaction already synced for a wallet stops opening. Before this
 * module the whole of what they were told was "Wallet ledger: 14
 * undecryptable." The assertions below are mostly about WORDS, which is
 * unusual for a test suite and is the point. The count was never the part that
 * was broken.
 */

import { describe, expect, it } from "vitest";

import { describeImportOutcome, type ImportCounts } from "../import-outcome";

const NOTHING: ImportCounts = {
  attempted: 0,
  opened: 0,
  imported: 0,
  unmapped: 0,
  untagged: 0,
  errored: 0,
  unreadable: 0,
  unitMismatch: 0,
};

describe("describeImportOutcome", () => {
  it("says nothing at all when nothing happened", () => {
    const out = describeImportOutcome(NOTHING);
    expect(out.silent).toBe(true);
    expect(out.message).toBe("");
  });

  describe("when not one row opened, which is the shape of a rotated key", () => {
    const wiped: ImportCounts = { ...NOTHING, attempted: 14, unreadable: 14 };

    it("flags it as the all-unreadable case", () => {
      expect(describeImportOutcome(wiped).allUnreadable).toBe(true);
      expect(describeImportOutcome(wiped).level).toBe("warning");
    });

    it("never uses the word undecryptable", () => {
      expect(describeImportOutcome(wiped).message).not.toMatch(/undecryptable/i);
    });

    it("names the cause in the customer's own terms", () => {
      const m = describeImportOutcome(wiped).message;
      expect(m).toMatch(/password was changed/i);
      expect(m).toMatch(/recovered/i);
    });

    it("says the state is permanent, so the customer does not just retry", () => {
      expect(describeImportOutcome(wiped).message).toMatch(/cannot be reversed/i);
    });

    it("answers the question the first sentence provokes: is my money gone", () => {
      const m = describeImportOutcome(wiped).message;
      expect(m).toMatch(/bitcoin is not affected/i);
      expect(m).toMatch(/nothing was removed/i);
    });

    it("reads correctly for a single transaction", () => {
      const one: ImportCounts = { ...NOTHING, attempted: 1, unreadable: 1 };
      const m = describeImportOutcome(one).message;
      expect(m).toContain("the 1 saved transaction for this wallet");
      expect(m).not.toContain("all 1");
    });

    it("counts every fetched row, not only the stealth ones", () => {
      expect(describeImportOutcome(wiped).message).toContain("all 14 saved transactions");
    });
  });

  describe("when some rows opened, which is a different problem", () => {
    it("does not claim a rotated key", () => {
      const partial: ImportCounts = {
        ...NOTHING,
        attempted: 10,
        opened: 8,
        imported: 8,
        unreadable: 2,
      };
      const out = describeImportOutcome(partial);
      expect(out.allUnreadable).toBe(false);
      expect(out.message).not.toMatch(/password/i);
      expect(out.message).toBe("Wallet ledger: 8 imported, 2 could not be opened.");
      expect(out.level).toBe("warning");
    });

    it("still avoids the jargon in the mixed summary", () => {
      const partial: ImportCounts = {
        ...NOTHING,
        attempted: 3,
        opened: 1,
        imported: 1,
        unreadable: 2,
      };
      expect(describeImportOutcome(partial).message).not.toMatch(/undecryptable/i);
    });
  });

  describe("the paths that were already correct and must not regress", () => {
    it("reports a clean run as a success", () => {
      const ok: ImportCounts = { ...NOTHING, attempted: 5, opened: 5, imported: 5 };
      const out = describeImportOutcome(ok);
      expect(out.level).toBe("success");
      expect(out.message).toBe("Wallet ledger: 5 imported.");
    });

    it("keeps unmapped and untagged as information, not as a warning", () => {
      const mapping: ImportCounts = {
        ...NOTHING,
        attempted: 4,
        opened: 4,
        imported: 1,
        unmapped: 2,
        untagged: 1,
      };
      const out = describeImportOutcome(mapping);
      expect(out.level).toBe("info");
      expect(out.message).toBe("Wallet ledger: 1 imported, 2 unmapped, 1 untagged.");
    });

    it("treats an errored row as a warning", () => {
      const bad: ImportCounts = { ...NOTHING, attempted: 2, opened: 2, imported: 1, errored: 1 };
      expect(describeImportOutcome(bad).level).toBe("warning");
    });
  });

  describe("guards against a false all-unreadable claim", () => {
    it("does not fire when nothing was fetched", () => {
      const none: ImportCounts = { ...NOTHING, errored: 1 };
      expect(describeImportOutcome(none).allUnreadable).toBe(false);
    });

    it("does not fire when rows opened but failed later for other reasons", () => {
      const later: ImportCounts = { ...NOTHING, attempted: 3, opened: 3, errored: 3 };
      expect(describeImportOutcome(later).allUnreadable).toBe(false);
    });
  });
});
