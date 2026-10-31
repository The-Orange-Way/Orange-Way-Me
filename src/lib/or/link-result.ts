/**
 * What to say after the OR connect widget reports success.
 *
 * THE DEFECT THIS REPLACES. A user pastes an extended public key they have
 * already added. Orange Rails is right to deduplicate: the same key is the same
 * wallet, so `or-stealth-connection-create` answers
 *
 *     200 {"connection_id":"<the existing one>","already_existed":true}
 *
 * The widget then closes and posts back only
 *
 *     {"type":"or-link-success","connection_id":"<the existing one>","source_wallets":[]}
 *
 * `already_existed` is dropped on the way. The app therefore renders nothing: no
 * toast, no new row, no explanation. Observed end to end on the deployed dev
 * site, where the connections list was byte identical before and after. Every
 * report of "I added a wallet and nothing happened" is this.
 *
 * Note what is NOT the fix: waiting for Orange Rails to forward the flag. That
 * change is worth making and is filed separately, but this app does not need it.
 * The app already knows which connections it was showing a moment ago, so it can
 * tell "this is new" from "you already had this" on its own, and a fix that
 * depends on nobody else shipping is the one that reaches the user.
 *
 * Pure and exported so both branches are testable. The old behaviour was an
 * unexamined `await refresh()` in a click handler, which is how silence became
 * the product's answer to a successful action.
 */

/** The subset of the widget's success payload this decision needs. */
export interface LinkSuccessLike {
  connection_id: string;
  /** Present in the type OR publishes, empty in practice for stealth links. */
  source_wallets?: ReadonlyArray<unknown>;
  /**
   * Only set when OR forwards it. Absent today. Treated as authoritative when
   * present so this keeps working, and improves, the moment OR ships it.
   */
  already_existed?: boolean;
}

export type LinkOutcome = "created" | "already-existed" | "unknown";

export interface LinkResultReport {
  outcome: LinkOutcome;
  toast: { level: "success" | "info" | "warning"; message: string };
  /** Connection to scroll to and highlight, so the claim is visible. */
  highlightConnectionId: string | null;
}

export function describeLinkResult(args: {
  result: LinkSuccessLike;
  /** Connection ids on screen immediately BEFORE the widget was opened. */
  knownConnectionIdsBefore: ReadonlyArray<string>;
  /** Ids returned by the refresh AFTER the widget closed. */
  connectionIdsAfter: ReadonlyArray<string>;
}): LinkResultReport {
  const id = args.result.connection_id;
  const wasKnown = args.knownConnectionIdsBefore.includes(id);

  // OR's own flag is useful context, but it is not a read-back. The refreshed
  // list must contain the id before this function names either outcome.
  const flag = args.result.already_existed;
  const existed = typeof flag === "boolean" ? flag : wasKnown;

  const listed = args.connectionIdsAfter.includes(id);
  if (!listed) {
    return {
      outcome: "unknown",
      toast: {
        level: "warning",
        message: "We refreshed your connections, but couldn't confirm that connection is listed.",
      },
      highlightConnectionId: null,
    };
  }

  if (existed) {
    return {
      outcome: "already-existed",
      toast: {
        level: "info",
        message:
          "You already have this wallet connected, so nothing new was added. We've highlighted it below.",
      },
      highlightConnectionId: id,
    };
  }

  return {
    outcome: "created",
    toast: {
      level: "success",
      message: "New connection is listed.",
    },
    highlightConnectionId: id,
  };
}
