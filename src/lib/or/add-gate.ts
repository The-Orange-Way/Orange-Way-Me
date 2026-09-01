/**
 * Which add-connection entry points may be offered, and why.
 *
 * OWM-T0478. `stealth_sync_enabled` is the stealth kill switch. Until now it
 * closed one door: ConnectionsPage consulted it on SYNC. The ADD path never
 * did, so with the switch off a customer could still add an xpub or a Sparrow
 * wallet, and every one of those seals another envelope under the
 * credentials-namespace key. One flag, both doors.
 *
 * WHY THIS IS ALL-OR-NOTHING ON THE BITCOIN-SOURCE ROUTE, and not a per-slug
 * filter. The source catalogue (exchanges, Lightning services, xpub, Sparrow)
 * is rendered by the connect provider on its own hosted page, not by us. Our
 * only lever on it is the `provider` query parameter built in
 * src/lib/or/widget.ts, and that lever is all-or-one: omit it and the whole
 * catalogue appears, name one and the catalogue is skipped entirely. There is
 * no "catalogue minus these two slugs" available from this side. So while the
 * switch is off, the only honest thing we can do with our own hands is not
 * open the catalogue at all. That cost is real and it is deliberate: adding an
 * exchange or a Lightning service is closed for as long as the switch is off.
 *
 * WHY THE BANK ROUTE IS EXEMT BY CONSTRUCTION, which is the property that must
 * not break. Bank connect never goes near the catalogue. It builds its own URL
 * in src/lib/or/bank-connect.ts and opens the provider's bank page directly at
 * /connect/quiltt with a pre-minted session bundle; its only fallback names
 * `provider=quiltt` explicitly. It never calls openOrConnect, so no path
 * through it can reach a stealth slug. Verified by reading both files at dev,
 * 2026-08-31.
 *
 * FAILS CLOSED by construction: every input must be true for the route to be
 * offered, and the runtime flag itself is false unless a successful read said
 * otherwise (see src/lib/stealth/runtimeFlags.ts, which fails closed on a
 * missing row, a query error and a throw).
 */

export type AddEntryPoint = "bank" | "bitcoin-source";

export interface AddGateFlags {
  /** VITE_OR_CONNECT_ENABLED, fixed at build time. */
  orConnectBuildEnabled: boolean;
  /** The live app_flags kill switch, i.e. isStealthSyncEnabled(). */
  stealthSyncEnabled: boolean;
}

/**
 * True when this entry point may be offered to the customer.
 *
 * Taken as arguments rather than read from the modules that own them, for the
 * same reason buildPickerConnectors takes its flag: import.meta.env is fixed
 * at module load and the runtime flag is a module singleton, so neither can be
 * driven from a test if this function reads them itself.
 */
export function isAddEntryPointOffered(entry: AddEntryPoint, flags: AddGateFlags): boolean {
  // The bank route does not consult the stealth switch, and it must not start
  // doing so: it cannot create a stealth connection. See the note above.
  if (entry === "bank") return true;
  return flags.orConnectBuildEnabled === true && flags.stealthSyncEnabled === true;
}

/**
 * The refusal copy, in one place so the button, the click handler and the
 * widget cannot drift into three different explanations of the same state.
 * It names the route that still works, because a dead end with no way forward
 * is what makes someone email support.
 */
export const BITCOIN_SOURCE_UNAVAILABLE_MESSAGE =
  "Connecting a Bitcoin source is temporarily unavailable. You can still connect a bank.";
