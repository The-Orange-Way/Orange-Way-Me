/**
 * mint-household-signing-key — recipient validation helper.
 *
 * Pulled out into its own module so it has no Deno-specific imports and
 * can be exercised by the project's vitest suite (`src/**\/__tests__`).
 *
 * Defense-in-depth: the edge function used to insert any
 * `wraps[i].user_id` the caller posted into `household_member_osk_wraps`
 * without verifying the recipient was actually an active member of the
 * household. Because the RLS policy `household_member_osk_wraps_select_own`
 * lets `auth.uid() = user_id` read its own wrap, planting a row for an
 * outside user_id would let that user fetch the wrapped HSK private key
 * — a confused-deputy escalation behind a compromised owner script.
 *
 * This module exposes a single pure function, `validateRecipients`, that
 * takes the requested recipient user_ids and the household's current
 * active-member user_ids and returns either { ok: true } or
 * { ok: false, error, status, offendingUserId? }. The caller (the edge
 * function) owns the DB lookup, so the helper stays pure + trivially
 * testable.
 *
 * ZKA invariant: this helper never touches plaintext or wrap material.
 * It compares UUIDs only.
 */

export interface ValidationOk {
  ok: true;
}

export interface ValidationErr {
  ok: false;
  /** Human-readable error suitable for an HTTP response body. UUIDs only — no PII. */
  error: string;
  /** Suggested HTTP status (400 for bad input). */
  status: number;
  /** The first user_id that failed validation, if applicable. */
  offendingUserId?: string;
}

export type ValidationResult = ValidationOk | ValidationErr;

/**
 * Validate that every recipient user_id in `requestedUserIds` is in
 * `activeMemberUserIds`, and that there are no duplicate recipients.
 *
 * Both inputs are treated as sets of UUIDs. Comparison is
 * case-insensitive on the assumption Postgres normalises uuid casing,
 * but we never mutate the inputs.
 *
 * Errors:
 *   - duplicate recipient — one user_id appears twice in the request.
 *     Defense-in-depth: the DB upsert would collapse duplicates, but a
 *     well-behaved caller never sends them.
 *   - non-member recipient — a requested user_id is not in the active
 *     member set.
 */
export function validateRecipients(
  requestedUserIds: readonly string[],
  activeMemberUserIds: readonly string[],
): ValidationResult {
  if (requestedUserIds.length === 0) {
    return {
      ok: false,
      error: "wraps must contain at least one entry",
      status: 400,
    };
  }

  const normalisedMembers = new Set(activeMemberUserIds.map((u) => u.toLowerCase()));
  const seen = new Set<string>();

  for (const raw of requestedUserIds) {
    const u = raw.toLowerCase();
    if (seen.has(u)) {
      return {
        ok: false,
        error: `duplicate recipient: ${raw} appears more than once in wraps`,
        status: 400,
        offendingUserId: raw,
      };
    }
    seen.add(u);
    if (!normalisedMembers.has(u)) {
      return {
        ok: false,
        error: `invalid recipient: ${raw} is not an active member of this household`,
        status: 400,
        offendingUserId: raw,
      };
    }
  }

  return { ok: true };
}
