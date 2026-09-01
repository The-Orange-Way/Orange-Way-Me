/**
 * The or-sync request, and the one place the vault keys are handed over.
 *
 * or-sync is the ONLY path in this app that exports the Orange Rails
 * credentials key and the transactions key out of the vault and puts them in a
 * request body. Everything else about a "Sync" press is a routing decision.
 * So this module owns two things that belong together and used to be apart:
 * the check that says this connection may go to or-sync at all, and the export
 * that hands the keys to it.
 *
 * WHY THE CHECK IS IN HERE AND NOT IN THE CALLER (OWM-T0544, OWM-T0511).
 * The rule "a private connection never goes to or-sync" was correct and tested
 * in both callers: planSyncRoute for a single press, planSyncAll for the bulk
 * press. Neither protected the key export, because the export lived in the
 * caller, below the check, inside a click handler that no test renders.
 * Deleting the private arm from that handler restored OWM-T0530 in full, sent
 * both keys for a connection or-sync answers with a 400, and left every test in
 * the repo green.
 *
 * A guard whose call site nothing checks lasts exactly as long as nobody edits
 * the file. So the guard moved to where the keys actually leave. This function
 * asks planSyncRoute itself and refuses before the first export, which means a
 * caller that forgets the check gets a refusal rather than a key handover.
 *
 * WHAT THIS IS NOT. It is not the kill switch and it has no parameter for one.
 * The switch decides refuse-or-scan once a press has arrived at the private
 * path, inside handleStealthSync, above that path's own key export. Routing
 * asks only what the connection IS. Feeding the switch into either decision is
 * the original defect (OWM-T0530): it made an off switch move a private
 * connection ONTO the key-exporting path instead of refusing it.
 */

import { planSyncRoute, type SyncRoute, type SyncRouteCandidate } from "./sync-route";

/** A connection as this request needs it: enough to route it, plus its id. */
export interface OrSyncConnection extends SyncRouteCandidate {
  id: string;
}

/** What or-sync answers with. Narrowed to the fields both callers read. */
export interface OrSyncResponse {
  synced: number;
  connections: Array<{ connection_id: string; synced: number; error?: string }>;
}

/**
 * The key handover, injected rather than imported.
 *
 * The exports come from the vault context, which is a React hook and cannot be
 * reached from a module. Injecting them is what lets a test assert the thing
 * that actually matters: that on a refused route these were NEVER CALLED. An
 * assertion that some other function was called instead would pass just as
 * happily while a key was still being exported alongside it.
 */
export interface OrSyncKeyHandover {
  /** Vault export of the Orange Rails credentials subkey, raw base64. */
  exportCredentialsKey(): Promise<string>;
  /** Vault export of the Orange Rails transactions subkey, raw base64. */
  exportTransactionsKey(): Promise<string>;
  /** The ow-or-proxy call. Endpoint and payload, exactly as the caller's own. */
  callProxy(endpoint: string, payload: Record<string, unknown>): Promise<unknown>;
}

/**
 * Raised when a connection that must not go to or-sync was handed to it.
 *
 * This is a programming error reaching a safety net, not a condition a user
 * can cause: both callers route correctly today. It carries the route and the
 * connection id so the console line names the cause, and its message is
 * plain enough to survive being shown to someone if a caller surfaces it.
 */
export class OrSyncRouteRefusal extends Error {
  readonly route: SyncRoute;
  readonly connectionId: string;

  constructor(route: SyncRoute, connectionId: string) {
    super("This connection is not synced through this path, so it was not sent.");
    this.name = "OrSyncRouteRefusal";
    this.route = route;
    this.connectionId = connectionId;
  }
}

/**
 * Ask or-sync to sync these connections, exporting the vault keys for the
 * request. Refuses, before exporting anything, if any connection does not
 * belong on this path.
 *
 * The whole list is checked before the first export rather than per item.
 * Exporting a key and then discovering the list was bad would defeat the
 * point: the key is out of the vault by then, and the only question left is
 * whether it also reached the network.
 *
 * @throws OrSyncRouteRefusal before any key export, if a connection routes
 *         anywhere other than or-sync.
 */
export async function requestOrSync(
  subaccountId: string,
  connections: readonly OrSyncConnection[],
  handover: OrSyncKeyHandover,
): Promise<OrSyncResponse> {
  for (const conn of connections) {
    const route = planSyncRoute(conn);
    if (route !== "or-sync") {
      throw new OrSyncRouteRefusal(route, conn.id);
    }
  }

  const credentials_key = await handover.exportCredentialsKey();
  const transactions_key = await handover.exportTransactionsKey();

  return (await handover.callProxy("or-sync", {
    subaccount_id: subaccountId,
    connection_ids: connections.map((c) => c.id),
    credentials_key,
    transactions_key,
  })) as OrSyncResponse;
}
