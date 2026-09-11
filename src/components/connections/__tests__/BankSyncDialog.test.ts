/**
 * OWM-T0740.
 *
 * Bank sync (runBankSync / BankSyncDialog) shares the DL-1424 unit guard with
 * the other import path, so a mismatched-currency balance credit is refused
 * on both. Only one path told the customer: BankSyncOutcome dropped the
 * unitMismatch count entirely, so a refused credit here looked identical to
 * a clean sync. This test pins the rule that decides whether the dialog may
 * show a plain success, so removing or forgetting to wire the count fails
 * the suite instead of failing silently in production again.
 */

import { describe, expect, it } from "vitest";

import { bankSyncHasWarning, type BankSyncOutcome } from "../BankSyncDialog";

const CLEAN: BankSyncOutcome = { imported: 3, total: 3, unmapped: 0, errored: 0, unitMismatch: 0 };

describe("bankSyncHasWarning", () => {
  it("is false when nothing was refused", () => {
    expect(bankSyncHasWarning(CLEAN)).toBe(false);
  });

  it("is true when a balance credit was refused for a unit mismatch", () => {
    expect(bankSyncHasWarning({ ...CLEAN, unitMismatch: 1 })).toBe(true);
  });

  it("is true even when every row otherwise imported cleanly", () => {
    // The exact shape of OWM-T0740: imported === total, errored 0, unmapped
    // 0, and still one refused credit that must not read as a plain success.
    expect(bankSyncHasWarning({ ...CLEAN, unitMismatch: 2 })).toBe(true);
  });
});
