import { describe, expect, it } from "vitest";

import {
  readOrMaterialEvidence,
  shouldRecordPreRecoverySalt,
  type OrMaterialEvidence,
  type OrMaterialEvidenceReads,
} from "../or-material-evidence";

const NO_PROFILE_ROW = () => Promise.resolve({ data: null, error: null });
const NO_SUBACCOUNT = () => Promise.resolve({ data: { or_subaccount_id: null }, error: null });
const HAS_SUBACCOUNT = () => Promise.resolve({ data: { or_subaccount_id: "s" }, error: null });

const NO_SYNC_EVENTS = () => Promise.resolve({ data: [] as unknown[], error: null });
const ONE_SYNC_EVENT = () => Promise.resolve({ data: [{ id: 1 }] as unknown[], error: null });

/** A read that failed the way supabase-js reports a failure. */
const READ_ERRORED = () => Promise.resolve({ data: null, error: { message: "boom" } });
/** A read that blew up rather than resolving. Same fact, different exit. */
const READ_THREW = () => Promise.reject(new Error("network"));

/** Shapes neither read is supposed to produce, so neither may be interpreted. */
const ODD_ROW = () => Promise.resolve({ data: { or_subaccount_id: 42 } as never, error: null });
const ODD_EVENTS = () => Promise.resolve({ data: { count: 0 } as never, error: null });

function reads(over: Partial<OrMaterialEvidenceReads>): OrMaterialEvidenceReads {
  const base = { subaccountId: NO_SUBACCOUNT, syncEvents: NO_SYNC_EVENTS };
  return { ...base, ...over } as OrMaterialEvidenceReads;
}

async function evidenceFrom(over: Partial<OrMaterialEvidenceReads>): Promise<OrMaterialEvidence> {
  return readOrMaterialEvidence(reads(over));
}

describe("readOrMaterialEvidence", () => {
  it("reports present when the user has an Orange Rails subaccount", async () => {
    expect(await evidenceFrom({ subaccountId: HAS_SUBACCOUNT })).toBe("present");
  });

  it("reports present when the user has at least one sync event", async () => {
    expect(await evidenceFrom({ syncEvents: ONE_SYNC_EVENT })).toBe("present");
  });

  it("reports absent only when both reads succeeded and both said no", async () => {
    expect(await evidenceFrom({})).toBe("absent");
  });

  it("treats a missing profile row as a real no, not as a failure", async () => {
    expect(await evidenceFrom({ subaccountId: NO_PROFILE_ROW })).toBe("absent");
  });

  it("reports unknown when the profile read errors", async () => {
    expect(await evidenceFrom({ subaccountId: READ_ERRORED })).toBe("unknown");
  });

  it("reports unknown when the profile read throws", async () => {
    expect(await evidenceFrom({ subaccountId: READ_THREW })).toBe("unknown");
  });

  it("reports unknown when the sync_events read errors", async () => {
    expect(await evidenceFrom({ syncEvents: READ_ERRORED })).toBe("unknown");
  });

  it("reports unknown when the sync_events read throws", async () => {
    expect(await evidenceFrom({ syncEvents: READ_THREW })).toBe("unknown");
  });

  it("reports unknown when the profile read returns an unexpected shape", async () => {
    expect(await evidenceFrom({ subaccountId: ODD_ROW })).toBe("unknown");
  });

  it("reports unknown when sync_events returns something not an array", async () => {
    expect(await evidenceFrom({ syncEvents: ODD_EVENTS })).toBe("unknown");
  });

  it("prefers present over a later failure: a subaccount ends it", async () => {
    const over = { subaccountId: HAS_SUBACCOUNT, syncEvents: READ_THREW };
    expect(await evidenceFrom(over)).toBe("present");
  });
});

describe("shouldRecordPreRecoverySalt", () => {
  function mark(evidence: OrMaterialEvidence, hadNone = true): boolean {
    return shouldRecordPreRecoverySalt({ hadNoOrMaterialBeforeRecovery: hadNone, evidence });
  }

  it("does not mark a row that already carries Orange Rails material", () => {
    for (const e of ["present", "absent", "unknown"] as OrMaterialEvidence[]) {
      expect(mark(e, false)).toBe(false);
    }
  });

  it("marks an unpinned row when the account has Orange Rails evidence", () => {
    expect(mark("present")).toBe(true);
  });

  it("MARKS an unpinned row when the evidence could not be read", () => {
    expect(mark("unknown")).toBe(true);
  });

  it("skips the mark only for an unpinned row with no material at all", () => {
    expect(mark("absent")).toBe(false);
  });
});
