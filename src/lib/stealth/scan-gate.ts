/**
 * The SCAN door of the stealth kill switch.
 *
 * The runtime flag (public.app_flags, read by runtimeFlags.ts) has been read
 * at exactly one entry to the private-wallet scan: the branch in
 * ConnectionsPage.handleSync that routes a private row to the widget instead
 * of the server-side sync path. That is not the only entry. The failure toast
 * raised by a scan carries a "Try again" action that calls the scan handler
 * directly, and the handler itself reads no flag, so that second entry was
 * never covered.
 *
 * THE HOLE THIS CLOSES, concretely. The scan handler itself consulted no flag,
 * so every entry other than that one routed branch reached the widget with no
 * check: the "Try again" action on the failure toast today, and whatever gets
 * wired to the handler tomorrow. The gate runs in the handler and again in the
 * launcher, above the call that carries the credentials key, so a refusal is
 * above the point the key would cross to the provider origin whatever the
 * entry.
 *
 * WHAT THE SWITCH REACHES, so nobody reads more into it than is there. The
 * flag is read from public.app_flags once at application start and cached for
 * the life of the page (runtimeFlags.ts), so turning it off changes what a NEW
 * page load sees and not what an already-open tab sees. No redeploy: true. No
 * reload: not true. That is why the retry scenario above is stated as a hole
 * in the code rather than as an incident that can happen today, and bounding
 * the staleness is OWM-T0504.
 *
 * WHY A PURE FUNCTION AND NOT AN INLINE CONDITION. The same reason the add
 * door has one. The gate can be tested with no browser, no popup and no live
 * flag row, both doors state the rule in the same words, and the wiring at
 * each call site is one line a reviewer can check at a glance.
 *
 * FAILS CLOSED, the rule runtimeFlags.ts already follows for the read of the
 * flag itself. `stealthSyncEnabled` is typed `unknown` deliberately: a caller
 * that hands over undefined, null, or the string "true" out of an env var gets
 * a refusal rather than a pass on a truthiness check.
 *
 * WHAT THIS IS NOT. It is not a replacement for the retry button. The button
 * and its caveat are load-bearing: describeStealthFailure decides whether a
 * retry is offered at all, and removing it would lose a real recovery path for
 * the ordinary case where the switch is on and a scan simply failed. This
 * refuses the press while the switch is off, and says so, rather than leaving
 * a button that does nothing.
 */

/**
 * What the customer is told when the scan gate refuses.
 *
 * Deliberately temporary in tone and explicit that nothing they already have
 * is affected, because the first thing anyone assumes on seeing a refusal is
 * that their wallet or its history has gone. Same shape as the add door's
 * message so the two never contradict each other on screen.
 */
export const STEALTH_SCAN_DISABLED_MESSAGE =
  "Scanning a private wallet is temporarily unavailable. Your existing connections and history are not affected.";

export type StealthScanDecision =
  | { allowed: true }
  | { allowed: false; reason: "stealth-disabled"; message: string };

/**
 * Decide whether a private-wallet scan may start.
 *
 * @param stealthSyncEnabled the effective runtime flag. Anything that is not
 *                           the boolean `true` is treated as off.
 */
export function planStealthScan(args: { stealthSyncEnabled: unknown }): StealthScanDecision {
  if (args.stealthSyncEnabled === true) return { allowed: true };
  return {
    allowed: false,
    reason: "stealth-disabled",
    message: STEALTH_SCAN_DISABLED_MESSAGE,
  };
}

/**
 * Thrown by the launcher when a scan is asked for with the switch off.
 *
 * The launcher refuses as well as the handler, and both are deliberate. The
 * handler's check is what the customer sees: it runs before the vault key is
 * exported and before the run record is opened, so a refused press costs
 * nothing and says something. The launcher's check is what a future caller
 * cannot get past: `startStealthSync` is the one function that opens the
 * widget, so a refusal there covers every entry that exists today and every
 * one somebody adds later without reading this file.
 *
 * A distinct class rather than a bare Error so a caller can tell a refusal
 * from a popup that was blocked, and so the message shown for it is chosen
 * here rather than assembled from whatever string reached the catch.
 */
export class StealthScanDisabledError extends Error {
  readonly reason = "stealth-disabled" as const;

  constructor(message: string = STEALTH_SCAN_DISABLED_MESSAGE) {
    super(message);
    this.name = "StealthScanDisabledError";
  }
}
