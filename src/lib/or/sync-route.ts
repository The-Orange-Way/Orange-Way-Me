/**
 * Which sync path a single connection takes when the user presses Sync.
 *
 * WHY THIS IS A MODULE AND NOT AN `if` IN THE HANDLER (OWM-T0530). The handler
 * used to decide the private wallet branch with
 * `isStealthSyncEnabled() && conn.is_stealth`. That ANDs the kill switch into
 * the ROUTING decision rather than using it as a gate inside the route. With
 * the switch OFF and the connection private, the condition is false, so control
 * fell through to the ordinary or-sync branch, which exports the Orange Rails
 * credentials key and the transactions key and posts both. Orange Rails then
 * answers 400 "stealth connections cannot be synced via this endpoint",
 * observed on production 2026-08-18 with the network recorded. That rejection
 * arrives after the request body carrying both keys has already left the
 * browser, so it is not a defence.
 *
 * The bulk path never had this defect: planSyncAll in sync-all.ts excludes
 * private connections on `conn.is_stealth === true` alone, with no reference to
 * the flag. So the single and bulk paths disagreed about whether a private
 * connection may be handed to or-sync, and they disagreed exactly when the kill
 * switch was off, which is the state the switch exists to make safe.
 *
 * THE RULE THIS ENCODES. Where a connection is synced is a property of the
 * connection, not of a feature flag. A private wallet is scanned by the OR
 * widget in this browser and is not in the `connections` table that or-sync
 * selects from, so or-sync cannot act on it in any flag state. The flag decides
 * refuse-or-scan INSIDE the private wallet handler, which re-reads it at the
 * press and shows the designed refusal before any key is exported.
 *
 * THE SIGNATURE IS THE POINT. This function takes no flag argument and must not
 * be given one. Folding the switch back into the route would mean changing the
 * signature, which the test pins deliberately.
 */

/** The subset of a connection row this decision needs. */
export interface SyncRouteCandidate {
  /** "quiltt" for a bank connection. Anything else is a Bitcoin source. */
  provider_type?: string | null;
  /** Optional on the wire. Absent must read as ordinary, never as private. */
  is_stealth?: boolean | null;
}

export type SyncRoute =
  /** Bank (Quiltt): the OPK sealed-box path, handled by the bank sync dialog. */
  | "bank-dialog"
  /** Private wallet: scanned by the OR widget in this browser, gated at the press. */
  | "private-wallet"
  /** Ordinary Bitcoin source: the or-sync edge function. */
  | "or-sync";

export function chooseSyncRoute(conn: SyncRouteCandidate): SyncRoute {
  // Bank first. A Quiltt connection is never private, but ordering it first
  // keeps the rule readable as "the provider that owns this sync gets it".
  if (conn.provider_type === "quiltt") return "bank-dialog";
  // `=== true`, not a truthiness check, and the same reasoning as planSyncAll:
  // an absent field is an older response shape and must route to the ordinary
  // path. A missing field silently reclassifying a connection is the bug next
  // door, in the other direction.
  if (conn.is_stealth === true) return "private-wallet";
  return "or-sync";
}
