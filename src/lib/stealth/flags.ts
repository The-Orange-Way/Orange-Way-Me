/**
 * Kill switch for the stealth (private-connection) sync entry (DL-1047, PR #259).
 *
 * The sync entry ships DARK. handleSync routes a stealth connection to the OR
 * widget only when this is true. Default off, so the merged code cannot open
 * the widget regardless of what is_stealth reports. While it is off, a stealth
 * connection falls through to the honest or-sync no-op path below the guard,
 * exactly as before this entry existed.
 *
 * Flipping this to true is a separate one-line PR, gated on the OR-side sync
 * mode confirmed live (the sync app mode implemented and its resume routes
 * wired) plus a wire observation of is_stealth on the or-connection-list
 * response.
 *
 * Typed as boolean, not the literal false, so the call-site guard reads as a
 * real runtime switch and is not folded away by control-flow narrowing.
 */
export const STEALTH_SYNC_ENABLED: boolean = false;
