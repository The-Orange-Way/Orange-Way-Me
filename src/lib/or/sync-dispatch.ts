/**
 * Acting on the sync route (OWM-T0544, out of OWM-T0530).
 *
 * `planSyncRoute` decides WHERE a Sync press goes and is covered by its own
 * tests. This module is the other half: it CALLS the handler that route names.
 *
 * Why the two halves are separate files, and why this one exists at all. The
 * call was four lines inside a 130 line click handler in a component no test
 * renders. Deleting the private arm from it left the entire suite green and
 * restored the original defect in full: a private connection falling into the
 * branch that exports the credentials key and the transactions key and puts
 * both into an or-sync request body. A rule that is tested and a call site
 * that is not adds up to an untested rule.
 *
 * There is no kill switch parameter here, on purpose. Where a press goes is
 * decided by the connection alone. The switch decides refuse-or-scan after the
 * press has arrived at the private handler, above any key export. That
 * separation is the whole fix from OWM-T0530: a switch that is OFF must refuse
 * a private connection, never redirect it onto the path that exports keys.
 *
 * Honest limit, stated so nobody reads more into this than it gives. This
 * defends the dispatch, not the component. A future edit could still call the
 * or-sync effect directly and bypass this function, and no test here would
 * see it. What it removes is the case that actually happened: an arm inside a
 * long handler that nothing anywhere referred to.
 */

import { planSyncRoute, type SyncRoute, type SyncRouteCandidate } from "./sync-route";

/**
 * The three things a Sync press can do, named by what owns them.
 *
 * `orSync` is the only one that exports vault key material, which is why the
 * tests assert its ABSENCE for a private connection rather than asserting the
 * presence of the private call. "The right handler ran" and "the dangerous
 * handler did not" are different claims and only the second one is the
 * property that matters.
 */
export interface SyncDispatchHandlers<C> {
  /** Quiltt bank connection: the bank dialog owns it. */
  bank: (conn: C) => void | Promise<void>;
  /** Private (stealth) connection: the private handler owns it, kill switch included. */
  private: (conn: C) => void | Promise<void>;
  /** Ordinary Bitcoin source: the or-sync request. Exports the two vault keys. */
  orSync: (conn: C) => void | Promise<void>;
}

/**
 * Route the press and run exactly one handler. Returns the route it took so a
 * caller (or a test) can assert on the decision as well as the effect.
 */
export async function dispatchSync<C extends SyncRouteCandidate>(
  conn: C,
  handlers: SyncDispatchHandlers<C>,
): Promise<SyncRoute> {
  const route = planSyncRoute(conn);

  if (route === "bank") {
    await handlers.bank(conn);
    return route;
  }

  if (route === "private") {
    await handlers.private(conn);
    return route;
  }

  // An exhaustiveness pin, not an else. If a fourth route is ever added to
  // SyncRoute, this assignment stops compiling and whoever added it has to say
  // where the new route goes. An else would hand it silently to the one
  // handler that exports key material, and "the unknown case falls into the
  // dangerous path" is exactly the shape of the defect this file came from.
  const ordinary: "or-sync" = route;
  await handlers.orSync(conn);
  return ordinary;
}
