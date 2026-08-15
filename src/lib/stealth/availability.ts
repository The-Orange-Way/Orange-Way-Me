/**
 * DL-1113. The connection list tells us its private-wallet arm failed, and
 * until now nobody read it.
 *
 * `or-connection-list` unions two stores: the ordinary `connections` table and
 * the stealth store. When the stealth arm fails, the endpoint does NOT error.
 * It returns 200 with whatever the other arm produced, plus a top-level
 * `stealth_unavailable: true` to say so. Every private wallet therefore
 * disappears from the list with no error, no banner and no retry, and the page
 * is byte-identical to one belonging to a user who has no private wallets.
 *
 * The dangerous case is the empty one. A user whose ONLY connections are
 * private wallets sees "No connections yet" and an invitation to add one. If
 * they take that invitation they create a duplicate, and while DL-1079 is open
 * they cannot delete it again. So the degraded copy has to actively tell them
 * not to re-add, which is why this returns different detail text depending on
 * whether anything else survived.
 *
 * Honest limit, stated here rather than discovered later: nobody has observed
 * this flag true on dev. This reads a field the API sends on every list
 * response today (as `false`), and the parser is written from that observed
 * shape. It is not written from a recorded degradation, so the copy below has
 * never been seen on a screen. See DL-1114 for why that distinction is worth
 * writing down rather than glossing.
 */

/** What to put on screen when the stealth arm is down. */
export interface StealthAvailabilityNotice {
  headline: string;
  detail: string;
  retryLabel: string;
}

/**
 * Read the flag off a raw `or-connection-list` response.
 *
 * Strict `=== true` on purpose, and the two rejected cases are rejected for
 * different reasons:
 *
 *   - ABSENT means available. A response predating the union carries no flag,
 *     and treating a missing field as "degraded" would put a permanent scare
 *     banner on every user of an older backend.
 *   - NON-BOOLEAN means available too. This drives user-visible alarm copy, so
 *     the cheaper failure direction is to stay quiet: the worst case then is
 *     the silence we already have today, whereas a truthy stray value would
 *     tell a healthy user their wallets are missing while they are on screen.
 */
export function readStealthUnavailable(res: unknown): boolean {
  if (!res || typeof res !== "object") return false;
  return (res as { stealth_unavailable?: unknown }).stealth_unavailable === true;
}

/**
 * Decide what the Connections page should say about a degraded stealth arm.
 *
 * Returns null when there is nothing to say, which is the overwhelmingly
 * common case, so the caller can render this unconditionally.
 *
 * `connectionCount` is the number of rows that DID come back. It changes the
 * advice, not just the wording:
 *
 *   - some rows survived, so the list is incomplete and the visible rows are fine
 *   - no rows survived, so the page looks empty and is not, which is the case
 *     where the user has to be told explicitly not to re-add anything
 */
export function describeStealthAvailability(input: {
  stealthUnavailable: boolean;
  connectionCount: number;
}): StealthAvailabilityNotice | null {
  if (!input.stealthUnavailable) return null;

  // Deliberately not "error", not red, no "failed". Nothing is lost when this
  // fires: the wallets and their history are held elsewhere and come back when
  // the arm does. Alarming copy would push people toward exactly the
  // destructive recovery (delete, then re-add) that they must not attempt.
  const headline = "Your private wallets aren't showing right now";

  const detail =
    input.connectionCount > 0
      ? "We couldn't reach the service that holds them, so this list is incomplete. " +
        "Nothing is lost, and the connections below are working normally."
      : "We couldn't reach the service that holds them, so this page looks emptier than it is. " +
        "Nothing is lost. If you have already added a private wallet, please don't add it " +
        "again. It will come back on its own once this clears.";

  return { headline, detail, retryLabel: "Try again" };
}
