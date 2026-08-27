/**
 * What to tell a customer after an import run (DL-1506).
 *
 * Why this exists as its own module rather than as string building inside the
 * connections page.
 *
 * When a vault's password is changed or the vault is recovered, the salt
 * rotates, every Orange Rails subkey derived from it changes, and rows sealed
 * under the previous keys can no longer be opened by anyone, including us.
 * The rows are intact in the database; the key is gone.
 *
 * That situation used to reach the customer as:
 *
 *     Wallet ledger: 14 undecryptable.
 *
 * which is not silent, but is not information either. It uses a word people do
 * not use, it does not say what happened, it does not say whether the money is
 * affected, and it does not say the state is permanent. A customer reading it
 * cannot tell it apart from a transient glitch worth retrying, so the most
 * likely response is to press Sync again, which cannot help.
 *
 * The distinction that carries the meaning is whether ANY row opened. A few
 * unreadable rows among many is usually an envelope version this build does not
 * understand. NONE of them opening is the signature of a rotated key, because a
 * key either opens this connection's rows or it opens none of them.
 *
 * This is deliberately a pure function over counts: the wording is the part
 * most likely to be argued with and revised, and it should be arguable without
 * standing up a connections page to see it.
 */

export interface ImportCounts {
  /** Sealed rows fetched for this connection, both bank and stealth. */
  attempted: number;
  /** Rows that opened and parsed. */
  opened: number;
  imported: number;
  unmapped: number;
  untagged: number;
  errored: number;
  /** Rows that failed to open, or opened and failed to parse. */
  unreadable: number;
  /**
   * DL-1424 / DEV-0064. Balance credits refused because the transaction's
   * amount unit did not match the destination account's currency. The row
   * still imported; only the stored balance was not updated for it. Must be
   * told to the customer, because otherwise a transaction appears in the
   * ledger while the account balance silently does not reflect it.
   */
  unitMismatch: number;
}

export type ImportOutcomeLevel = "success" | "info" | "warning";

export interface ImportOutcome {
  level: ImportOutcomeLevel;
  message: string;
  /**
   * True when rows were fetched and not one of them opened. The caller uses
   * this to decide whether anything else is worth saying; it is also the
   * condition worth alerting on, because it is the shape of key loss.
   */
  allUnreadable: boolean;
  /** True when there is nothing at all to report and no toast should show. */
  silent: boolean;
}

/**
 * The sentence for the case where nothing opened.
 *
 * Three things it must do, in this order, because that is the order the
 * customer needs them:
 *
 *   1. Say plainly that the transactions could not be opened. Not
 *      "undecryptable", not "failed", and no count without a subject.
 *   2. Name the likely cause in the customer's own terms, so that someone who
 *      did change their password recognises themselves in it.
 *   3. Say the bitcoin is unaffected. This is the question a customer actually
 *      has on reading the first sentence, and leaving it unanswered turns a
 *      records problem into a panic.
 *
 * It says "usually" rather than asserting the cause, because this code cannot
 * see which key sealed a row and must not claim a diagnosis it did not make.
 */
function allUnreadableMessage(count: number): string {
  const subject = count === 1 ? "the 1 saved transaction" : `all ${count} saved transactions`;
  return (
    `We could not open ${subject} for this wallet. ` +
    "This usually means the vault password was changed, or the vault was recovered, " +
    "after they were saved, and that cannot be reversed. " +
    "Your bitcoin is not affected and nothing was removed from your wallet."
  );
}

/**
 * Turn the counts from one import run into the one thing to say about it.
 *
 * Ordering is deliberate: the all-unreadable case is checked before the
 * per-count summary, because a summary that reads "0 imported, 14 unreadable"
 * is technically complete and tells the customer nothing.
 */
export function describeImportOutcome(counts: ImportCounts): ImportOutcome {
  const { attempted, opened, imported, unmapped, untagged, errored, unreadable, unitMismatch } =
    counts;

  const nothingHappened =
    imported === 0 &&
    unmapped === 0 &&
    untagged === 0 &&
    errored === 0 &&
    unreadable === 0 &&
    unitMismatch === 0;
  if (nothingHappened) {
    return { level: "info", message: "", allUnreadable: false, silent: true };
  }

  const allUnreadable = attempted > 0 && opened === 0 && unreadable === attempted;
  if (allUnreadable) {
    return {
      level: "warning",
      message: allUnreadableMessage(unreadable),
      allUnreadable: true,
      silent: false,
    };
  }

  const parts: string[] = [];
  if (imported > 0) parts.push(`${imported} imported`);
  if (unmapped > 0) parts.push(`${unmapped} unmapped`);
  if (untagged > 0) parts.push(`${untagged} untagged`);
  // "could not be opened" rather than "undecryptable". Same count, same
  // position in the list, a word the reader already owns.
  if (unreadable > 0) {
    parts.push(`${unreadable} could not be opened`);
  }
  if (errored > 0) parts.push(`${errored} errored`);

  const level: ImportOutcomeLevel =
    errored > 0 || unreadable > 0 ? "warning" : unmapped > 0 || untagged > 0 ? "info" : "success";

  return {
    level,
    message: `Wallet ledger: ${parts.join(", ")}.`,
    allUnreadable: false,
    silent: false,
  };
}
