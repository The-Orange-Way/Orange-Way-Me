/**
 * The ADD door of the stealth kill switch.
 *
 * The runtime flag has always closed exactly one door: the sync launch path in
 * ConnectionsPage, which reads isStealthSyncEnabled() before it will start a
 * private-wallet scan. The ADD path never consulted it. So with the switch off
 * a customer could still open the connect catalogue, pick a private-wallet
 * source, and have another credential envelope sealed on the provider's side.
 * Everyone reading "the flag is off" believed the feature was off; half of it
 * was still open.
 *
 * One flag, both doors. This module is the decision half of the second door.
 * It is a pure function on purpose: the gate can then be tested with no
 * browser, no popup, and no live flag row, and the wiring at the call site is
 * one line a reviewer can check at a glance.
 *
 * REFUSES EVERY ADD WHILE THE SWITCH IS OFF, NAMED SLUG OR NOT (OWM-T0506).
 * An earlier version of this gate let a named slug through whenever it was
 * not one of the three hardcoded private-wallet slugs below, a deny list.
 * The module said it "fails closed" and that was true for the unnamed case
 * and false for the named one, in the same file. Two things made the deny
 * list wrong rather than merely incomplete:
 *   1. We do not host the connect provider's catalogue, so there is no
 *      source of truth here for "every slug that is not a private wallet".
 *      A deny list can only ever be as complete as whoever remembers to
 *      update it, and a rename or a new provider entry slips past silently.
 *   2. It had no current beneficiary. The one production call site
 *      (ConnectionsPage.handleAddConnection) never names a slug. The bank
 *      connect flow (AddBankDialog) does not call this gate at all: it is a
 *      fully separate component. So the bypass was pure attack surface with
 *      nothing legitimate standing behind it today.
 * If a future caller genuinely needs a named slug to pass while the switch
 * is off, that is a real product decision (which slug, on what evidence it
 * is not a private-wallet route) to make explicitly at that call site, not a
 * default this shared gate should carry for a case nobody is using.
 *
 * WHY AN ADD WITH NO NAMED SLUG IS A REFUSAL, unchanged from before. We do
 * not host the catalogue. The connect provider renders its own searchable
 * source list and the private-wallet entries live inside it, so there is no
 * filter this side can apply to remove them. The only slug we ever know in
 * advance is one we name ourselves, and naming none means the user can reach
 * any entry in that list, private wallets included. An add that can reach a
 * gated slug is treated as reaching one, and now so is an add that names any
 * other slug: this side cannot tell "not private" from "private, just not on
 * our list".
 *
 * FAILS CLOSED, the same rule runtimeFlags.ts already follows for the read of
 * the flag itself. `stealthSyncEnabled` is typed `unknown` deliberately: a
 * caller that hands us undefined, null, or the string "true" out of an env var
 * gets a refusal rather than a pass on a truthiness check. An unreadable kill
 * switch is not an open one.
 *
 * WHEN THIS COMES OFF: it does not. When the key handoff is corrected, the
 * flag goes true and both doors open together. Nothing here has to be torn
 * out to do that, which is why the gate reads the flag rather than hard-coding
 * a state of the world.
 */

/**
 * The catalogue slugs that open a private-wallet (stealth) flow on the connect
 * provider's side. Kept as data, not because planCatalogueAdd consults it to
 * decide what is ALLOWED any more (it does not, see OWM-T0506 above), but
 * because it is still the one place a reviewer can check "is this slug
 * private", and the pin test below still catches a rename or an addition
 * this list has not kept up with.
 */
export const STEALTH_CATALOGUE_SLUGS: readonly string[] = Object.freeze([
  "xpub",
  "xpub_stealth",
  "sparrow",
]);

/**
 * Collapse hyphen/underscore variants, whitespace-padding and case before
 * comparing, so "xpub-stealth", "XPUB_STEALTH" and "xpub_stealth" are the
 * same slug. The concrete failure this guards: a rename that only swaps the
 * separator must not stop matching.
 */
function normalizeSlug(slug: string): string {
  return slug.trim().toLowerCase().replace(/[-_]+/g, "_");
}

/** True when this slug opens a private-wallet flow on the provider's side. */
export function isStealthCatalogueSlug(slug: string | null | undefined): boolean {
  if (typeof slug !== "string") return false;
  const key = normalizeSlug(slug);
  if (key === "") return false;
  return STEALTH_CATALOGUE_SLUGS.some((gated) => normalizeSlug(gated) === key);
}

/**
 * What the customer is told when the gate refuses. Plain, temporary, and
 * explicit that nothing they already have is affected, because the first
 * question anyone asks on seeing this is whether their existing connections
 * just went away.
 */
export const STEALTH_ADD_DISABLED_MESSAGE =
  "Connecting a new Bitcoin source is temporarily unavailable. Your existing connections are not affected.";

export type CatalogueAddDecision =
  | { allowed: true }
  | { allowed: false; reason: "stealth-disabled"; message: string };

/**
 * Decide whether an add may proceed.
 *
 * @param slug               the provider slug, when the caller names one.
 *                           Unused while the switch is off (OWM-T0506): a
 *                           named slug and an unnamed one are refused alike,
 *                           because this side cannot positively vouch for
 *                           any slug it does not host.
 * @param stealthSyncEnabled the effective runtime flag. Anything that is not
 *                           the boolean `true` is treated as off.
 */
export function planCatalogueAdd(args: {
  slug?: string | null;
  stealthSyncEnabled: unknown;
}): CatalogueAddDecision {
  if (args.stealthSyncEnabled === true) return { allowed: true };

  return {
    allowed: false,
    reason: "stealth-disabled",
    message: STEALTH_ADD_DISABLED_MESSAGE,
  };
}
