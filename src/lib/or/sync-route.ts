/**
 * Where a single "Sync" press goes, decided in one place.
 *
 * THE DEFECT THIS REPLACES. `handleSync` chose its route with
 * `isStealthSyncEnabled() && conn.is_stealth`. That reads like a gated
 * private branch and is not one: it ANDs the kill switch into the ROUTING
 * decision. With the switch OFF the condition short-circuits, `is_stealth` is
 * never consulted, and a private connection falls through to the ordinary
 * `or-sync` branch, which exports the credentials key and the transactions key
 * and posts both in the request body. Observed on production 2026-08-18 with
 * the network recorded, `or-sync` answers that request 400 "stealth
 * connections cannot be synced via this endpoint". So the two keys are
 * transmitted and the request is then rejected. Nothing is gained.
 *
 * THE RULE, and it is the one `planSyncAll` in ./sync-all.ts already applies
 * to the bulk path: a private connection is NEVER sent to `or-sync`, in any
 * state of anything. Whether it is private is a property of the row.
 *
 * THE SWITCH IS DELIBERATELY NOT AN INPUT HERE. It decides scan or refuse, and
 * that decision belongs at the door, in `handleStealthSync`, which reads the
 * flag at the press with a forced refresh and refuses there. Consulting the
 * switch again in this function would give one state two refusal sentences,
 * and this copy would be the staler of the two, because routing reads the
 * cached answer while the door forces a read. Routing answers exactly one
 * question: is this connection private.
 *
 * Pure and exported so the decision can be tested. The original was a stack of
 * inline conditions in a click handler with no test, which is exactly how a
 * condition that looks right at a glance survives a review.
 */

/** The subset of a connection row this decision needs. */
export interface SyncRouteCandidate {
  /** Optional on the wire. Absent must read as ordinary, never as private. */
  is_stealth?: boolean;
  provider_type?: string | null;
}

export type SyncRoute =
  /** Bank (Quiltt): the OPK sealed-box path, handled by the bank dialog. */
  | { kind: "bank" }
  /**
   * Private wallet. Goes to the widget scan entry, which is the gated door:
   * it re-reads the kill switch at the press and refuses there if it is off.
   * Never `or-sync`, in any state.
   */
  | { kind: "private" }
  /** Ordinary Bitcoin source: the only kind `or-sync` can act on. */
  | { kind: "or-sync" };

export function planSyncRoute(conn: SyncRouteCandidate): SyncRoute {
  // Bank connections are routed on provider alone. Settled first so the rest
  // of the function does not have to carry the case.
  if (conn.provider_type === "quiltt") return { kind: "bank" };

  // `=== true`, not a truthiness check, and deliberately identical to
  // planSyncAll: an absent field is an older response shape and must route to
  // the ordinary path. A missing field silently reclassifying a connection is
  // the bug next door.
  if (conn.is_stealth === true) return { kind: "private" };

  return { kind: "or-sync" };
}
