/**
 * WHO HANDLES a sync press, once planSyncRoute has decided WHERE it goes.
 *
 * planSyncRoute (./sync-route) answers the routing question and is tested.
 * This module answers the next one: given that answer, which handler runs.
 * The two are deliberately separate. The route is a fact about the connection;
 * the handler is a fact about the screen, and only the screen knows what its
 * three handlers are.
 *
 * WHY THIS IS A MODULE AND NOT THREE `if` BLOCKS IN THE CLICK HANDLER
 * (OWM-T0590). It used to be three blocks written out inline in
 * ConnectionsPage.handleSync. Deleting any one of them broke no test in the
 * repository: no test renders that component, and the repository carries no
 * DOM test dependencies, so no unit test of that wiring could exist. The
 * private arm was the expensive one to lose. Before OWM-T0544 its deletion
 * sent a private connection to or-sync and exported two vault keys; since
 * OWM-T0544 requestOrSync refuses above its own export, so the same deletion
 * now costs a generic "Sync failed" toast instead of the private scan. A
 * visible regression rather than a silent key handover, which is why this is
 * worth fixing calmly rather than urgently.
 *
 * The rule the whole file exists to hold: EXACTLY ONE handler runs, and a
 * private connection never reaches the or-sync handler. Both are asserted in
 * __tests__/sync-dispatch.test.ts.
 *
 * THE KILL SWITCH IS NOT AN INPUT HERE, for the same reason it is not an input
 * to planSyncRoute. A switch that selects between two paths sends a private
 * connection down the path that exports keys when it is off, which is worse
 * than no switch at all (OWM-T0530). The switch decides refuse-or-scan once a
 * press has ARRIVED at the private handler, above any key export. The arity of
 * dispatchSync is pinned in the tests so a flag parameter coming back is
 * caught by something, which no value assertion can do.
 *
 * WHAT THIS DOES NOT PROVE, stated so nobody reads more into a green test than
 * is there. Testing this module shows that the mapping is right. It does not
 * show that no key left the browser: that is a claim about a real page in a
 * real browser and only an end to end test can make it. This repository runs
 * no end to end job on pull request CI today.
 */

import type { SyncRoute } from "./sync-route";

/**
 * The three handlers a screen supplies. Named for what they DO rather than for
 * the route string, so a caller reading this list cannot quietly wire the
 * private route to the or-sync handler by matching names.
 */
export interface SyncRouteHandlers {
  /** Quiltt bank connection: hand off to the OPK sealed-box dialog. */
  bank: () => void | Promise<void>;
  /** Private (stealth) connection: the in-browser widget scan, kill switch included. */
  private: () => void | Promise<void>;
  /** Ordinary Bitcoin source: the or-sync request, the only path that exports keys. */
  orSync: () => void | Promise<void>;
}

/**
 * Run the one handler this route belongs to, and await it.
 *
 * Awaiting matters: the caller's `finally` blocks and its loading state depend
 * on knowing when the handler finished, and a fire-and-forget call here would
 * make a failed sync look instantaneous.
 *
 * An unrecognised route THROWS rather than falling through to the or-sync
 * handler. Fail closed: the ordinary path is the one that exports vault keys,
 * so it must never be the destination of a value nobody planned for. The
 * `never` binding makes adding a route to SyncRoute without an arm here a
 * typecheck failure, so the throw is a runtime backstop for data arriving from
 * outside the type system, not the primary defence.
 */
export async function dispatchSync(
  route: SyncRoute,
  handlers: SyncRouteHandlers,
): Promise<void> {
  switch (route) {
    case "bank":
      await handlers.bank();
      return;
    // SCRATCH MUTATION (OWM-T0590). The private arm is deleted, so a private
    // route falls through to the or-sync handler exactly as it did when this
    // was an `if` chain in the click handler. Never merge this.
    case "private":
    case "or-sync":
      await handlers.orSync();
      return;
    default: {
      const unreachable: never = route;
      throw new Error(`dispatchSync: no handler for sync route ${String(unreachable)}`);
    }
  }
}
