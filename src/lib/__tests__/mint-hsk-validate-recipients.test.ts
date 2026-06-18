/**
 * @vitest-environment node
 *
 * Recipient validation for the mint-household-signing-key edge function.
 *
 * The helper lives in `supabase/functions/mint-household-signing-key/
 * validate-recipients.ts` so it has no Deno-specific imports and can be
 * exercised from the project vitest suite.
 *
 * Security-critical paths:
 *   - reject a wrap targeting a user_id that is not an active household member
 *   - accept wraps that target only active members
 *   - reject duplicate recipients in the same request
 *   - reject an empty wraps array
 */

import { describe, it, expect } from "vitest";
import { validateRecipients } from "../../../supabase/functions/mint-household-signing-key/validate-recipients";

const OWNER = "11111111-1111-1111-1111-111111111111";
const PARTNER = "22222222-2222-2222-2222-222222222222";
const ADVISOR = "33333333-3333-3333-3333-333333333333";
const OUTSIDER = "99999999-9999-9999-9999-999999999999";

describe("validateRecipients", () => {
  it("accepts a single wrap targeting an active member (owner-only mint)", () => {
    const result = validateRecipients([OWNER], [OWNER]);
    expect(result.ok).toBe(true);
  });

  it("accepts wraps targeting every active member", () => {
    const result = validateRecipients([OWNER, PARTNER, ADVISOR], [OWNER, PARTNER, ADVISOR]);
    expect(result.ok).toBe(true);
  });

  it("accepts a subset of members (partial-wrap mint)", () => {
    // Mint covering only owner + partner is fine — advisor just won't
    // have a wrap row yet. The validation only rejects wraps that aim
    // OUTSIDE the active member set, not those that omit members.
    const result = validateRecipients([OWNER, PARTNER], [OWNER, PARTNER, ADVISOR]);
    expect(result.ok).toBe(true);
  });

  it("rejects a wrap targeting a non-member user_id", () => {
    const result = validateRecipients([OWNER, OUTSIDER], [OWNER, PARTNER]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.error).toMatch(/invalid recipient/i);
      expect(result.error).toContain(OUTSIDER);
      expect(result.offendingUserId).toBe(OUTSIDER);
    }
  });

  it("rejects a wrap targeting only an outsider", () => {
    const result = validateRecipients([OUTSIDER], [OWNER, PARTNER]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.offendingUserId).toBe(OUTSIDER);
    }
  });

  it("rejects when there are no active members at all", () => {
    const result = validateRecipients([OWNER], []);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/invalid recipient/i);
    }
  });

  it("rejects an empty wraps array", () => {
    const result = validateRecipients([], [OWNER, PARTNER]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.error).toMatch(/at least one/i);
    }
  });

  it("rejects duplicate recipients", () => {
    const result = validateRecipients([OWNER, PARTNER, PARTNER], [OWNER, PARTNER]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.error).toMatch(/duplicate recipient/i);
      expect(result.offendingUserId).toBe(PARTNER);
    }
  });

  it("treats UUID casing as equivalent (defense in depth)", () => {
    const result = validateRecipients([OWNER.toUpperCase()], [OWNER]);
    expect(result.ok).toBe(true);
  });

  it("includes only UUIDs in the error message (no PII leak)", () => {
    const result = validateRecipients([OUTSIDER], [OWNER]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // Sanity: error must not echo arbitrary fields. Only the UUID
      // and the fixed-string prefix should appear.
      expect(result.error).toBe(
        `invalid recipient: ${OUTSIDER} is not an active member of this household`,
      );
    }
  });
});
