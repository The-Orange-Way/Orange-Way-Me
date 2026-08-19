import { supabase } from "@/integrations/supabase/client";
import { STEALTH_SYNC_ENABLED } from "./flags";

/**
 * Runtime override for the stealth-sync kill switch (DL-1378).
 *
 * STEALTH_SYNC_ENABLED is derived from VITE_STEALTH_SYNC_ENABLED at build
 * time, so changing it needs a rebuild + redeploy. This module reads the live
 * value from public.app_flags once at boot and lets it override the build-time
 * constant, giving operations a kill switch that needs no redeploy.
 *
 * Fallback is deliberately conservative so infra problems never change
 * behavior on their own:
 *   - Until the read resolves, and if the query itself FAILS (table absent,
 *     network error), we keep the build-time value. A transient failure must
 *     not kill a live feature.
 *   - If the query SUCCEEDS with no row, the flag is undefined server-side and
 *     folds to false (matches the seed migration).
 *   - If the query SUCCEEDS with a row, that row is authoritative.
 */

let stealthSyncEnabled: boolean = STEALTH_SYNC_ENABLED;
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
    const { data, error } = await supabase
      .from("app_flags")
      .select("enabled")
      .eq("key", "stealth_sync_enabled")
      .maybeSingle();
    if (error) {
      // Query failed (table absent, network). Keep the build-time fallback.
      return;
    }
    // Query succeeded. A present row is authoritative; an absent row folds to
    // false because the flag is undefined server-side.
    stealthSyncEnabled = data?.enabled === true;
  } catch {
    // Keep the build-time fallback.
  }
}
