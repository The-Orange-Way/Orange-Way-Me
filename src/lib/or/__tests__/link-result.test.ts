/**
 * What the app says after the connect widget reports success.
 *
 * The sentence these exist to prevent: nothing at all, shown to someone who
 * just added a wallet and is looking at an unchanged list.
 */

import { describe, it, expect } from "vitest";
import { describeLinkResult } from "../link-result";

const EXISTING = "52417f95-4482-403d-abb7-ac4a047fbd40";
const OTHER = "2087812f-8080-4607-aa05-fc6737874e37";
const FRESH = "9f1d2c3b-0000-4000-8000-abcdefabcdef";

describe("describeLinkResult", () => {
  it("names the duplicate when the returned id was already on screen", () => {
    // THE DEFECT, exactly as observed on the deployed site: OR returns the id
    // of the connection the user is already looking at, and the app said nothing.
    const r = describeLinkResult({
      result: { connection_id: EXISTING, source_wallets: [] },
      knownConnectionIdsBefore: [OTHER, EXISTING],
    });
    expect(r.outcome).toBe("already-existed");
    expect(r.toast.message).toMatch(/already have this wallet/i);
    expect(r.highlightConnectionId).toBe(EXISTING);
  });

  it("reports a genuinely new connection as added", () => {
    const r = describeLinkResult({
      result: { connection_id: FRESH, source_wallets: [] },
      knownConnectionIdsBefore: [OTHER, EXISTING],
    });
    expect(r.outcome).toBe("created");
    expect(r.toast.level).toBe("success");
    expect(r.highlightConnectionId).toBe(FRESH);
  });

  it("trusts already_existed from OR over the membership check when sent", () => {
    // OR does not forward this today. When it does, it is authoritative: it
    // knows about rows this browser may never have been shown.
    const r = describeLinkResult({
      result: { connection_id: FRESH, already_existed: true },
      knownConnectionIdsBefore: [],
    });
    expect(r.outcome).toBe("already-existed");
  });

  it("does not call something a duplicate just because OR sent false", () => {
    const r = describeLinkResult({
      result: { connection_id: EXISTING, already_existed: false },
      knownConnectionIdsBefore: [EXISTING],
    });
    expect(r.outcome).toBe("created");
  });

  it("never claims added when the refreshed list still lacks the id", () => {
    // Saying "Wallet added" over a list that does not contain it is the same
    // class of lie as "no new transactions" for work never attempted.
    const r = describeLinkResult({
      result: { connection_id: FRESH },
      knownConnectionIdsBefore: [OTHER],
      connectionIdsAfter: [OTHER],
    });
    expect(r.outcome).toBe("unknown");
    expect(r.toast.level).toBe("warning");
    expect(r.toast.message).toMatch(/isn't showing yet/i);
    expect(r.toast.message).not.toMatch(/^Wallet added\.$/);
    expect(r.highlightConnectionId).toBeNull();
  });

  it("is satisfied when the refreshed list does contain the new id", () => {
    const r = describeLinkResult({
      result: { connection_id: FRESH },
      knownConnectionIdsBefore: [OTHER],
      connectionIdsAfter: [OTHER, FRESH],
    });
    expect(r.outcome).toBe("created");
  });

  it("treats an empty before-list as no evidence of a duplicate", () => {
    const r = describeLinkResult({
      result: { connection_id: FRESH },
      knownConnectionIdsBefore: [],
    });
    expect(r.outcome).toBe("created");
  });

  it("always returns something to say", () => {
    for (const known of [[], [EXISTING]]) {
      const r = describeLinkResult({
        result: { connection_id: EXISTING },
        knownConnectionIdsBefore: known,
      });
      expect(r.toast.message.length).toBeGreaterThan(0);
    }
  });
});
