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
 * WHY AN ADD WITH NO NAMED SLUG IS A REFUSAL, which is the part to read before
 * changing anything here. We do not host the catalogue. The connect provider
 * renders its own searchable source list and the private-wallet entries live
 * inside it, so there is no filter this side can apply to remove them. The
 * only slug we ever know in advance is one we name ourselves, and naming none
 * means the user can reach any entry in that list, private wallets included.
 * An add that can reach a gated slug is treated as reaching one.
 *
 * FAILS CLOSED, the same rule runtimeFlags.ts already follows for the read of
 * the flag itself. `stealthSyncEnabled` is typed `unknown` deliberately: a
 * caller that hands us undefined, null, or the string "true" out of an env var
 * gets a refusal rather than a pass on a truthiness check. An unreadable kill
 * switch is not an open one.
 *
 * WHEN THIS COMES OFF: it does not. When the key handoff is corrected, the
 * flag goes true and both doors open together. Nothing here has to be torn out
 * to do that, which is why the gate reads the flag rather than hard-coding a
 * state of the world.
 */

/**
 * The catalogue slugs that open a private-wallet (stealth) flow on the connect
 * provider's side. Kept as data rather than a condition so the list is one
 * place, and so a test can pin it: adding a private-wallet source to the
 * catalogue without adding it here is the one way this gate can silently stop
 * covering something.
 */
export const STEALTH_CATALOGUE_SLUGS: readonly string[] = Object.freeze([
  "xpub",
  "xpub_stealth",
  "sparrow",
]);

/** True when this slug opens a private-wallet flow on the provider's side. */
export function isStealthCatalogueSlug(slug: string | null | undefined): boolean {
  if (typeof slug !== "string") return false;
  const key = slug.trim().toLowerCase();
  if (key === "") return false;
  return STEALTH_CATALOGUE_SLUGS.includes(key);
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
 *                           Absent means "open the whole catalogue", which can
 *                           reach a gated slug and is therefore refused while
 *                           the gate is off.
 * @param stealthSyncEnabled the effective runtime flag. Anything that is not
 *                           the boolean `true` is treated as off.
 */
export function planCatalogueAdd(args: {
  slug?: string | null;
  stealthSyncEnabled: unknown;
}): CatalogueAddDecision {
  if (args.stealthSyncEnabled === true) return { allowed: true };

  // The gate is off, or could not be read. A named slug we can positively
  // identify as not private may still proceed: the ruling is to gate the
  // private-wallet slugs and nothing else, and the bank route in particular
  // must keep working untouched while this is off.
  const named = typeof args.slug === "string" ? args.slug.trim() : "";
  if (named !== "" && !isStealthCatalogueSlug(named)) return { allowed: true };

  return {
    allowed: false,
    reason: "stealth-disabled",
    message: STEALTH_ADD_DISABLED_MESSAGE,
  };
}
