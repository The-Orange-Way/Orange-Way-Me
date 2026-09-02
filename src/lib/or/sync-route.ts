/**
 * Which path a single "Sync" press takes, decided from the connection alone.
 *
 * THE DEFECT THIS REPLACES (OWM-T0530, OWM-T0528, OWM-T0533). The routing
 * condition in ConnectionsPage.handleSync read:
 *
 *     if (isStealthSyncEnabled() && conn.is_stealth) { handleStealthSync(); }
 *
 * so the private wallet kill switch was ANDed into the choice of PATH. With
 * the switch OFF a private connection failed that test and fell through to the
 * ordinary branch directly below it, which exports the Orange Rails
 * credentials key and the transactions key from the vault and posts both to
 * or-sync. or-sync then answers 400 "stealth connections cannot be synced via
 * this endpoint" (observed on production 2026-08-18, signed in, with the
 * network recorded). So the keys were exported and sent for a request that
 * could never succeed.
 *
 * A kill switch that moves a private connection ONTO the path that exports two
 * vault keys is worse than no switch at all. So the switch is not an input
 * here, and this function has no parameter for it. This answers WHERE a press
 * goes, using only what the connection IS. The switch decides refuse-or-scan
 * once the press has arrived at the private path, inside handleStealthSync,
 * above any key export.
 *
 * This is the same unconditional rule planSyncAll already applies to the bulk
 * path: a private connection is never sent to or-sync in any state of the
 * switch. The single-connection path disagreed with the bulk path, and the
 * bulk path was right.
 *
 * Pure and exported so the rule can be tested. It was inline in a click
 * handler with no test, which is how a switch came to select between two paths
 * instead of gating one.
 */

/** The subset of a connection row this decision needs. */
export interface SyncRouteCandidate {
  /** Bank connections sync through the OPK sealed-box path, not or-sync. */
  provider_type?: string | null;
  /** Optional on the wire. Absent must read as ordinary, never as private. */
  is_stealth?: boolean;
}

export type SyncRoute =
  /** Quiltt bank connection. The BankSyncDialog owns it. */
  | "bank"
  /** Private (stealth) connection. handleStealthSync owns it, switch included. */
  | "private"
  /** Ordinary Bitcoin source. The or-sync request, the only path that exports keys. */
  | "or-sync";

/**
 * Bank first, then private, then ordinary. That order is the order the click
 * handler already used and is preserved deliberately: a row carrying both a
 * bank provider and is_stealth is a shape we have never seen, and inventing a
 * new answer for it here would be a behaviour change smuggled into a fix.
 */
/**
 * Assert, at COMPILE time, that every route except the ordinary one has
 * already been handled and returned before this point.
 *
 * WHY THIS EXISTS, and it is a different hole from the one this file's header
 * describes (OWM-T0544). The routing RULE above is defended: delete the
 * private line in `planSyncRoute` and three tests go red. The CALL to it was
 * not defended at all. The click handler read the route into a variable and
 * then chose with a chain of `if`s, and deleting the four lines
 *
 *     if (route === "private") { await handleStealthSync(conn); return; }
 *
 * left every test in the repository green, raised no type error and no lint
 * error, and restored the original defect in full: the two key exports below
 * it then ran for a private connection. A guard whose call site nothing checks
 * survives exactly as long as nobody edits the file.
 *
 * No unit test can watch that call site, because it is inside a component and
 * nothing in this repository renders one. So the check is handed to the
 * compiler instead, which is stronger here in the one way that counts: it
 * cannot be left un-run, and it cannot be deleted separately from the code it
 * defends. `tsc --noEmit` is a required check on this repository.
 *
 * The parameter type is the entire mechanism. At the call site `route` is
 * `SyncRoute` narrowed by the branches that returned above it, so it is
 * assignable here only when every other member has been dealt with. Delete a
 * branch and the argument is still `"private" | "or-sync"`, which does not
 * fit. Add a fourth route later and every caller fails the same way, which is
 * exactly where you want to be told.
 *
 * THE HONEST LIMIT, so nobody reads more into this than it gives. It pins that
 * each route is handled before the ordinary path is reached. It does NOT stop
 * someone moving a key export up above the routing altogether. Nothing short
 * of driving the real component catches that, and it is tracked separately.
 */
export function assertOrdinaryRoute(route: Extract<SyncRoute, "or-sync">): void {
  // Deliberately does nothing at runtime. Everything this function is for
  // happened in the type checker before the code was built.
  void route;
}

export function planSyncRoute(conn: SyncRouteCandidate): SyncRoute {
  if (conn.provider_type === "quiltt") return "bank";
  // `=== true`, not a truthiness check. An absent field is an older response
  // shape and must route to the ordinary path; a present true routes to the
  // private path whatever else is true of the app. A missing field silently
  // reclassifying a connection is the bug next door, and sync-all.ts carries
  // the same guard for the same reason.
  if (conn.is_stealth === true) return "private";
  return "or-sync";
}
