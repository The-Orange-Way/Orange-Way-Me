import { describe, expect, it } from "vitest";

import {
  readOrMaterialEvidence,
  shouldRecordPreRecoverySalt,
  type OrMaterialEvidence,
  type OrMaterialEvidenceReads,
} from "../or-material-evidence";

const NO_PROFILE_ROW = () => Promise.resolve({ data: null, error: null });
const NO_SUBACCOUNT = () => Promise.resolve({ data: { or_subaccount_id: null }, error: null });
const HAS_SUBACCOUNT = () => Promise.resolve({ data: { or_subaccount_id: "sub_123" }, error: null });

const NO_SYNC_EVENTS = () => Promise.resolve({ data: [] as unknown[], error: null });
const ONE_SYNC_EVENT = () => Promise.resolve({ data: [{ id: 1 }] as unknown[], error: null });

/** A read that failed the way supabase-js reports a failure. */
const READ_ERRORED = () => Promise.resolve({ data: null, error: { message: "boom" } });
/** A read that blew up rather than resolving. Same fact, different exit. */
const READ_THREW = () => Promise.reject(new Error("network"));

function reads(over: Partial<OrMaterialEvidenceReads> = {}): OrMaterialEvidenceReads {
  return {
    subaccountId: NO_SUBACCOUNT,
    syncEvents: NO_SYNC_EVENTS,
    ...over,
  } as OrMaterialEvidenceReads;
}

async function evidenceFrom(over: Partial<OrMaterialEvidenceReads>): Promise<OrMaterialEvidence> {
  return readOrMaterialEvidence(reads(over));
}

describe("readOrMaterialEvidence", () => {
  it("reports present when the user has an Orange Rails subaccount", async () => {
    await expect(evidenceFrom({ subaccountId: HAS_SUBACCOUNT })).resolves.toBe("present");
  });

  it("reports present when the user has at least one sync event", async () => {
    await expect(evidenceFrom({ syncEvents: ONE_SYNC_EVENT })).resolves.toBe("present");
  });

  it("reports absent only when both reads succeeded and both said no", async () => {
    await expect(evidenceFrom({})).resolves.toBe("absent");
  });

  it("treats a missing profile row as a real no, not as a failure", async () => {
    await expect(evidenceFrom({ subaccountId: NO_PROFILE_ROW })).resolves.toBe("absent");
  });

  it("reports unknown when the profile read errors", async () => {
    await expect(evidenceFrom({ subaccountId: READ_ERRORED })).resolves.toBe("unknown");
  });

  it("reports unknown when the profile read throws", async () => {
    await expect(evidenceFrom({ subaccountId: READ_THREW })).resolves.toBe("unknown");
  });

  it("reports unknown when the sync_events read errors", async () => {
    await expect(evidenceFrom({ syncEvents: READ_ERRORED })).resolves.toBe("unknown");
  });

  it("reports unknown when the sync_events read throws", async () => {
    await expect(evidenceFrom({ syncEvents: READ_THREW })).resolves.toBe("unknown");
  });

  it("reports unknown when the profile read returns a shape we did not expect", async () => {
    const weird = () =>
      Promise.resolve({ data: { or_subaccount_id: 42 } as never, error: null });
    await expect(evidenceFrom({ subaccountId: weird })).resolves.toBe("unknown");
  });

  it("reports unknown when sync_events returns something that is not an array", async () => {
    const weird = () => Promise.resolve({ data: { count: 0 } as never, error: null });
    await expect(evidenceFrom({ syncEvents: weird })).resolves.toBe("unknown");
  });

  it("prefers present over a later failure: a subaccount ends the question", async () => {
    await expect(
      evidenceFrom({ subaccountId: HAS_SUBACCOUNT, syncEvents: READ_THREW }),
    ).resolves.toBe("present");
  });
});

describe("shouldRecordPreRecoverySalt", () => {
  it("does not mark a row that already carries Orange Rails material", () => {
    for (const evidence of ["present", "absent", "unknown"] as OrMaterialEvidence[]) {
      expect(
        shouldRecordPreRecoverySalt({ hadNoOrMaterialBeforeRecovery: false, evidence }),
      ).toBe(false);
    }
  });

  it("marks an unpinned row when the account has Orange Rails evidence", () => {
    expect(
      shouldRecordPreRecoverySalt({
        hadNoOrMaterialBeforeRecovery: true,
        evidence: "present",
      }),
    ).toBe(true);
  });

  it("MARKS an unpinned row when the evidence could not be read (fail closed)", () => {
    expect(
      shouldRecordPreRecoverySalt({
        hadNoOrMaterialBeforeRecovery: true,
        evidence: "unknown",
      }),
    ).toBe(true);
  });

  it("skips the mark only for an unpinned row with no Orange Rails material at all", () => {
    expect(
      shouldRecordPreRecoverySalt({
        hadNoOrMaterialBeforeRecovery: true,
        evidence: "absent",
      }),
    ).toBe(false);
  });
});
