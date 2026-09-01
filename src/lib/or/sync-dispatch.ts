/**
 * WHERE a single "Sync" press is actually sent, once planSyncRoute has decided
 * where it belongs.
 *
 * WHY THIS MODULE EXISTS, and it is not a matter of taste. planSyncRoute is
 * well tested: deleting `if (conn.is_stealth === true) return "private"` fails
 * three cases in sync-route.test.ts. But the RULE is not what protects the
 * customer. The CALL to the rule is. Before this module, handleSync read:
 *
 *     const route = planSyncRoute(conn);
 *     if (route === "bank")    { setBankSyncConnId(conn.id); return; }
 *     if (route === "private") { await handleStealthSync(conn); return; }
 *     // falls through to the only body in the app that exports vault keys
 *
 * Deleting those four private lines left every test in the repository passing,
 * and the credentials key and transactions key exports at the bottom of
 * handleSync then ran for a private connection again: OWM-T0530 restored in
 * full, with a green board (OWM-T0544). Nothing renders ConnectionsPage in a
 * test and nothing can, because the repository carries no DOM test
 * environment, so no assertion could ever have reached that arm.
 *
 * So the arms moved to where a test can call them. Two separate machines now
 * have to fail before a private connection can reach the key-exporting body:
 *
 *   1. Deleting an arm HERE fails sync-dispatch.test.ts, which asserts that a
 *      private connection reaches the private handler and NEVER the or-sync
 *      one. It also fails the typecheck, on the exhaustiveness check below.
 *   2. Deleting an arm at the CALL SITE is a TypeScript error, because every
 *      member of SyncHandlers is required. There is no fallthrough left to
 *      delete: the or-sync body is reachable only through a property named
 *      orSync, and omitting privateWallet does not silently redirect to it,
 *      it stops the build.
 *
 * That second property is the one the old shape lacked. Sequential `if` arms
 * carry an implicit else, and the implicit else here exported two vault keys
 * to the provider origin.
 *
 * The kill switch is deliberately not an input, here or in planSyncRoute. It
 * decides refuse-or-scan once a press has ARRIVED at the private path, inside
 * handleStealthSync, above any key export. A switch that chooses between two
 * paths is what OWM-T0530 was: switching the feature off moved the connection
 * onto the path that exports keys.
 */
import { planSyncRoute, type SyncRouteCandidate } from "./sync-route";

/**
 * One handler per route, and all three are REQUIRED on purpose. An optional
 * member would restore exactly the silent fallthrough this module exists to
 * remove: the compiler would accept a call site with the private arm missing,
 * which is the deletion OWM-T0544 was filed for.
 *
 * void or Promise<void> so a synchronous destination (opening a dialog) does
 * not have to be written as an async function with nothing to await.
 */
export interface SyncHandlers {
  /** Quiltt bank connection. The BankSyncDialog owns it, via the OPK path. */
  bank: () => void | Promise<void>;
  /**
   * Private (stealth) connection. The kill switch is read INSIDE this one,
   * where an off switch refuses. It is never read to choose between handlers.
   */
  privateWallet: () => void | Promise<void>;
  /**
   * Ordinary Bitcoin source: the or-sync request. THE ONLY handler that
   * exports vault keys, which is why nothing may arrive here by falling off
   * the end of a condition.
   */
  orSync: () => void | Promise<void>;
}

/**
 * Route the connection and hand it to exactly one handler.
 *
 * Takes the connection and the handlers, and nothing else. The arity is part
 * of the contract: a third parameter carrying the kill switch is how the
 * original defect would come back, and no assertion about return values would
 * catch it, because the extra argument would simply be undefined in every
 * existing test and all of them would still pass.
 */
export function dispatchSync(
  conn: SyncRouteCandidate,
  handlers: SyncHandlers,
): void | Promise<void> {
  const route = planSyncRoute(conn);
  switch (route) {
    case "bank":
      return handlers.bank();
    case "private":
      return handlers.privateWallet();
    case "or-sync":
      return handlers.orSync();
  }

  // Exhaustiveness, not defensive padding. Written as an assignment to `never`
  // so that deleting a case above, or adding a fourth SyncRoute member, is a
  // TYPECHECK failure here rather than a function that quietly returns
  // undefined and leaves the press doing nothing at all.
  const unhandled: never = route;
  throw new Error(`Unhandled sync route: ${String(unhandled)}`);
}
