/**
 * @vitest-environment node
 *
 * OWM-T0215 source wiring. ConnectionsPage has no component-test DOM harness
 * in this repository, so this follows the adjacent handler wiring test and
 * checks the privacy boundary at the call sites themselves.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const SOURCE = readFileSync(new URL("../ConnectionsPage.tsx", import.meta.url), "utf8");

describe("ConnectionsPage import observability wiring", () => {
  it("captures throwing paths through a fixed-code synthetic exception", () => {
    expect(SOURCE).toContain("const report = new Error(code)");
    expect(SOURCE).toContain("captureException(report,");
    expect(SOURCE).not.toContain("captureException(importErr,");
    expect(SOURCE).not.toContain("captureException(err,");

    for (const code of [
      "or_import_bridge_failed",
      "connection_sync_failed",
      "connection_sync_all_failed",
      "stealth_ledger_import_failed",
    ]) {
      expect(SOURCE).toContain(`"${code}"`);
    }
  });

  it("reports decrypt and parse failures as separate counted events", () => {
    expect(SOURCE).toContain('captureMessage("OR import could not decrypt sealed rows"');
    expect(SOURCE).toContain('failureCode: "decrypt_failed"');
    expect(SOURCE).toContain("failureCount: decryptFailures");

    expect(SOURCE).toContain('captureMessage("OR import could not parse decrypted rows"');
    expect(SOURCE).toContain('failureCode: "parse_failed"');
    expect(SOURCE).toContain("failureCount: parseFailures");
    expect(SOURCE).toContain("unreadable: decryptFailures + parseFailures");
  });

  it("keeps per-row identifiers and raw errors out of retained warning breadcrumbs", () => {
    expect(SOURCE).not.toContain("console.warn(`[orImportBridge] tx ${orTxId} failed`, err)");
    expect(SOURCE).not.toContain("console.warn(`[bank-sync] tx ${orTxId} failed`, err)");
    expect(SOURCE).toContain(
      'console.log("[orImportBridge] transaction import failure detail", { orTxId, err })',
    );
    expect(SOURCE).toContain(
      'console.log("[bank-sync] transaction import failure detail", { orTxId, err })',
    );
  });
});
