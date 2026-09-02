/**
 * Guard test for exportOrSyncKeysFor, the only supported way to read the two
 * vault keys an or-sync request carries.
 *
 * sync-route.test.ts proves planSyncRoute answers correctly. This proves the
 * answer is ENFORCED where the keys actually leave. Those are different
 * claims, and OWM-T0530 was a failure of the second one while the first was
 * fine: the rule was right and the caller did not have to obey it.
 *
 * Every case below asserts what was NOT called. "The refusal threw" is the
 * weaker half; "no key was ever read" is the property the customer is
 * relying on.
 */

import { describe, it, expect, vi } from "vitest";
import { exportOrSyncKeysFor } from "../sync-route";

/**
 * Inferred, not annotated. The object has to satisfy OrSyncKeyExporters or the
 * calls below would not compile, so an explicit annotation would only pin us
 * to whatever shape vi.fn's Mock type happens to have this minor version.
 */
function spyExporters() {
  return {
    exportOrCredsKey: vi.fn(async () => "creds-key-b64"),
    exportOrTxnsKey: vi.fn(async () => "txns-key-b64"),
  };
}

describe("exportOrSyncKeysFor", () => {
  it("exports both keys for an ordinary Bitcoin source", async () => {
    const exporters = spyExporters();

    const keys = await exportOrSyncKeysFor({ provider_type: "blink", is_stealth: false }, exporters);

    expect(keys).toEqual({
      credentials_key: "creds-key-b64",
      transactions_key: "txns-key-b64",
    });
    expect(exporters.exportOrCredsKey).toHaveBeenCalledTimes(1);
    expect(exporters.exportOrTxnsKey).toHaveBeenCalledTimes(1);
  });

  it("treats an absent is_stealth as ordinary, never as private", async () => {
    // An older response shape must not silently reclassify a connection.
    // sync-route.ts carries the same rule for the same reason.
    const exporters = spyExporters();

    await expect(exportOrSyncKeysFor({ provider_type: "strike" }, exporters)).resolves.toEqual({
      credentials_key: "creds-key-b64",
      transactions_key: "txns-key-b64",
    });
  });

  it("reads NO key for a private connection and refuses instead", async () => {
    const exporters = spyExporters();

    await expect(
      exportOrSyncKeysFor({ provider_type: "orangerails", is_stealth: true }, exporters),
    ).rejects.toThrow(/routes to "private"/);

    // The assertion that matters. Not "it threw": that no key was read.
    expect(exporters.exportOrCredsKey).not.toHaveBeenCalled();
    expect(exporters.exportOrTxnsKey).not.toHaveBeenCalled();
  });

  it("reads no key for a bank connection either", async () => {
    // Banks sync through the OPK sealed-box path. They have no business on
    // the or-sync request, and the same refusal covers them.
    const exporters = spyExporters();

    await expect(
      exportOrSyncKeysFor({ provider_type: "quiltt", is_stealth: false }, exporters),
    ).rejects.toThrow(/routes to "bank"/);

    expect(exporters.exportOrCredsKey).not.toHaveBeenCalled();
    expect(exporters.exportOrTxnsKey).not.toHaveBeenCalled();
  });

  it("refuses a private connection carrying a bank provider too", async () => {
    // planSyncRoute answers "bank" first for this shape, so the connection is
    // refused either way. Pinned so a future reordering of that precedence
    // cannot quietly turn this shape into an allowed or-sync export.
    const exporters = spyExporters();

    await expect(
      exportOrSyncKeysFor({ provider_type: "quiltt", is_stealth: true }, exporters),
    ).rejects.toThrow(/Refusing to export vault keys/);

    expect(exporters.exportOrCredsKey).not.toHaveBeenCalled();
    expect(exporters.exportOrTxnsKey).not.toHaveBeenCalled();
  });

  it("cannot be given the kill switch as an input", () => {
    // The connection and the exporters, and nothing else. A third parameter
    // here would mean the switch could select a path again rather than gate
    // one, which is OWM-T0530 restored in a new place. No value assertion can
    // catch that; the signature can.
    expect(exportOrSyncKeysFor.length).toBe(2);
  });
});
