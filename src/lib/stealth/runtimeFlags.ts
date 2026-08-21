import { supabase } from "@/integrations/supabase/client";

/**
 * Runtime override for the stealth-sync kill switch (DL-1378).
 *
 * STEALTH_SYNC_ENABLED is derived from VITE_STEALTH_SYNC_ENABLED at build
 * time, so changing it needs a rebuild + redeploy. This module reads the live
 * value from public.app_flags once at boot and lets it override the build-time
 * constant, giving operations a kill switch that needs no redeploy.
 *
 * FAILS CLOSED (DL-1466). This module used to fall back to the build-time
 * constant, which was `true` on prod, so the gate read true until the row
 * resolved and stayed true forever if the read failed. Measured on production:
 * a 507ms window on a cold load, unbounded on a query error. A kill switch that
 * resurrects a disabled feature when infrastructure hiccups is not a kill
 * switch, and the old comment calling that "conservative" had the polarity
 * backwards for a switch whose whole job is to turn something OFF.
 *
 * The rule now has no exceptions: the gate is false unless a successful read
 * returned a row that says otherwise.
 *   - Before the read resolves: false.
 *   - Query FAILS (table absent, network, throw): false.
 *   - Query SUCCEEDS with no row: false (matches the seed migration).
 *   - Query SUCCEEDS with a row: that row is authoritative, both ways.
 *
 * Note this makes the build-time constant irrelevant to the gate. Turning
 * stealth on is now a database change and nothing else, on every environment.
 */

let stealthSyncEnabled = false;
let loaded = false;

/**
 * The effective stealth-sync gate. Read at the call site instead of the
 * build-time constant so the runtime override applies.
 */
export function isStealthSyncEnabled(): boolean {
  return stealthSyncEnabled;
}

/**
 * Read the runtime flag once at boot. Safe to call more than once; only the
 * first call hits the network. Never throws.
 */
export async function loadRuntimeFlags(): Promise<void> {
  if (loaded) return;
  loaded = true;
  try {
    // app_flags was added by the DL-1394 migration and the generated Supabase
    // types have not been regenerated to include it, so a typed .from() call
    // fails the build. Query it through an untyped handle until the types are
    // regenerated; the runtime row shape ({ enabled: boolean }) is stable.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any)
      .from("app_flags")
      .select("enabled")
      .eq("key", "stealth_sync_enabled")
      .maybeSingle();
    if (error) {
      // Query failed (table absent, network). Fail closed, do not inherit a
      // build-time default that may be true.
      stealthSyncEnabled = false;
      return;
    }
    // Query succeeded. A present row is authoritative; an absent row folds to
    // false because the flag is undefined server-side.
    stealthSyncEnabled = data?.enabled === true;
  } catch {
    // Same reasoning as the error branch: an unreadable flag is an off flag.
    stealthSyncEnabled = false;
  }
}
