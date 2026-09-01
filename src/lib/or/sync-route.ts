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
 * state of the switch. The switch decides whether a private connection is
 * scanned or refused. It does not decide whether the connection is private.
 *
 * Pure and exported so the decision can be tested. The original was four
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
  /** Private wallet, switch on: scanned by the widget in this browser. */
  | { kind: "private-scan" }
  /** Private wallet, switch off: refused here, with nothing sent. */
  | { kind: "private-refused" }
  /** Ordinary Bitcoin source: the only kind `or-sync` can act on. */
  | { kind: "or-sync" };

/**
 * The sentence a customer sees when a private wallet is refused. It is
 * exported so the wording lives beside the rule that produces it, and so a
 * test can pin the refusal without reaching into the component.
 *
 * It matches the voice `privateSkipMessage` already uses for the same state on
 * the bulk path. "Nothing was sent" is not decoration: the whole point of the
 * fix is that no key material leaves the browser on this press, and saying so
 * is the only way a customer or a support conversation can tell this refusal
 * apart from a request that failed after it went out.
 */
export const PRIVATE_SYNC_DISABLED_MESSAGE =
  "This private connection can't be synced here yet. Nothing was sent.";

export function planSyncRoute(
  conn: SyncRouteCandidate,
  opts: { stealthSyncEnabled: boolean },
): SyncRoute {
  // Bank connections are routed on provider alone. They are never private and
  // never touch the private-wallet switch, so this is settled first and the
  // rest of the function does not have to carry the case.
  if (conn.provider_type === "quiltt") return { kind: "bank" };

  // `=== true`, not a truthiness check, and deliberately identical to
  // planSyncAll: an absent field is an older response shape and must route to
  // the ordinary path. A missing field silently reclassifying a connection is
  // the bug next door.
  if (conn.is_stealth === true) {
    return opts.stealthSyncEnabled ? { kind: "private-scan" } : { kind: "private-refused" };
  }

  return { kind: "or-sync" };
}
