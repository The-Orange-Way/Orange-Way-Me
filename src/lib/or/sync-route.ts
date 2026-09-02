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

/**
 * What a Sync press DOES once the route is known: one arm per route, all three
 * required.
 *
 * OWM-T0544, and this is the point of the interface rather than an
 * optional-callback bag. The routing rule above was tested and the CALL to it
 * was not: deleting the four lines in ConnectionsPage.handleSync that sent a
 * private connection to the private path failed nothing anywhere in the repo,
 * because every test here exercises planSyncRoute directly and none of them
 * goes through the click handler. A rule defended only in a module the defect
 * never lived in is not defended.
 *
 * Making the arms a required object moves that from untested to uncompilable.
 * A call site missing the private arm is a type error, so it fails
 * `bunx tsc --noEmit` in the Lint + build job, which is the only check in this
 * repository that reads ConnectionsPage.tsx at all.
 *
 * The honest limit: this counts the arms, it does not judge them. Wiring the
 * private arm to the or-sync work would still typecheck. What it removes is
 * the failure that actually happened, which was an arm going missing.
 */
export interface SyncPressActions {
  /** Bank (Quiltt) connection. Opens the BankSyncDialog. Exports no or-sync key. */
  bank: () => void | Promise<void>;
  /**
   * Private (stealth) connection. Hands the press to handleStealthSync, which
   * owns the kill switch and refuses ABOVE any key export when it is off.
   */
  private: () => void | Promise<void>;
  /**
   * Ordinary Bitcoin source. THE ONLY ARM THAT EXPORTS VAULT KEYS. Nothing
   * that is not routed "or-sync" may reach it.
   */
  orSync: () => void | Promise<void>;
}

/**
 * Route the press, then run exactly one arm and wait for it.
 *
 * Takes the connection and the arms, and NOTHING ELSE. No kill switch
 * parameter, for the same reason planSyncRoute has none: a switch that selects
 * between paths can move a private connection onto the key-exporting path,
 * which is the defect this pair of functions exists to make unwriteable. The
 * switch decides refuse-or-scan once the press has arrived at the private arm.
 *
 * Returns the route it took, so a caller or a test can assert the decision and
 * the effect separately rather than inferring one from the other.
 */
export async function dispatchSyncPress(
  conn: SyncRouteCandidate,
  actions: SyncPressActions,
): Promise<SyncRoute> {
  const route = planSyncRoute(conn);

  if (route === "bank") {
    await actions.bank();
    return route;
  }

  if (route === "private") {
    await actions.private();
    return route;
  }

  await actions.orSync();
  return route;
}
