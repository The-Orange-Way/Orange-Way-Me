/**
 * Which endpoint disconnects a given connection, and with what payload.
 *
 * There are two connection stores behind this app and they are scoped
 * differently. Ordinary connections live in `connections`, scoped by
 * subaccount. Private (stealth) connections live in their own store, scoped by
 * app user. `or-connection-delete` selects from the first one only, so calling
 * it for a private connection looks in a table that row is not in and answers
 * 404 "Connection not found in this subaccount". Every private connection was
 * therefore undeletable, and the page reported it as "Couldn't disconnect.
 * Give it a moment and try again", which invited a retry that could never
 * work.
 *
 * This is a pure function so the choice can be tested. It was a bare `if`
 * inside a click handler with no test, which is how it went unnoticed.
 *
 * Note what is NOT here: the owner. `or-stealth-connection-delete` deletes by
 * row id, so the caller's identity is the only thing stopping one user from
 * deleting another's connection by guessing an id. That is forced to the
 * authenticated user inside `ow-or-proxy` and must never be sent from the
 * browser.
 */

export interface DeletePlan {
  endpoint: "or-connection-delete" | "or-stealth-connection-delete";
  payload: Record<string, unknown>;
}

export function buildDeletePlan(args: {
  isStealth: boolean | undefined;
  connectionId: string;
  subaccountId: string;
}): DeletePlan {
  if (args.isStealth) {
    return {
      endpoint: "or-stealth-connection-delete",
      payload: { connection_id: args.connectionId },
    };
  }
  return {
    endpoint: "or-connection-delete",
    payload: { subaccount_id: args.subaccountId, connection_id: args.connectionId },
  };
}
