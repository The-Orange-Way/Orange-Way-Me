/**
 * Which sync path a single connection takes when the user presses "Sync".
 *
 * DL-1047. A stored stealth connection has no other entry point once the add
 * widget closes: the only way to re-scan it is this Sync action routing to the
 * OR widget. Before that entry existed a stealth row fell through to `or-sync`,
 * which selects from the `connections` table, does not see the stealth store,
 * and honestly returned { synced: 0 } -- so the connection could never be
 * scanned again. This function is that routing decision, lifted out of the
 * click handler so the entry point is covered by a test rather than by a human
 * clicking a dev deployment (which no CI seat in this org can do).
 *
 * The order matters and mirrors the handler it replaced:
 *   1. Quiltt (bank) connections use the OPK sealed-box BankSyncDialog.
 *   2. A stealth connection, ONLY while this app's kill switch is on, opens the
 *      OR widget in this browser. While the switch is off it ships dark and
 *      falls through to `orSync`, exactly as before the entry existed.
 *   3. Everything else (Bitcoin sources: Blink/Strike/etc.) uses `or-sync`.
 *
 * Pure and exported so both the routing and its dark-ship guard can be tested.
 */

/** The subset of a connection row this decision needs. */
export interface SyncRouteCandidate {
  provider_type: string;
  /** Absent must read as ordinary, never as stealth. */
  is_stealth?: boolean;
}

export type SyncRoute = "bank" | "stealth" | "orSync";

export function resolveSyncRoute(
  conn: SyncRouteCandidate,
  stealthSyncEnabled: boolean,
): SyncRoute {
  if (conn.provider_type === "quiltt") return "bank";
  if (stealthSyncEnabled && conn.is_stealth === true) return "stealth";
  return "orSync";
}
