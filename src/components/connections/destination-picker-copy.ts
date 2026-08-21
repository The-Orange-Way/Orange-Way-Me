/**
 * What the destination picker says when a search finds nothing, and what it
 * pre-fills into the create-account dialog.
 *
 * DL-1427. A beta tester on a phone could not create an account: the only
 * control was a bare "+" glyph with its label hidden at that width, and when a
 * search returned nothing the picker said "No accounts yet" with nothing to
 * act on. The founder's scope note made the fix behavioural rather than copy:
 * a search that finds nothing must offer to create what was typed, pre-filled,
 * so nobody types the same name twice.
 *
 * These are pure so they can be tested. Vitest runs in the node environment
 * with no DOM here, so the JSX around them cannot be mounted in a unit test.
 */

/** The line shown when the account list comes back empty. */
export function emptyStateMessage(search: string): string {
  const typed = search.trim();
  return typed ? `No account matches "${typed}".` : "No accounts yet.";
}

/** The label on the button that opens the create-account dialog. */
export function createButtonLabel(search: string): string {
  const typed = search.trim();
  return typed ? `+ Create "${typed}"` : "+ Create a new account";
}

/**
 * The name the create dialog opens with.
 *
 * What the customer typed wins over the wallet-derived default. She was
 * looking for an account by that name and did not find one; offering her a
 * different name back would be ignoring what she just said.
 */
export function suggestedAccountName(search: string, walletFallback: string): string {
  const typed = search.trim();
  return typed || walletFallback.trim();
}
