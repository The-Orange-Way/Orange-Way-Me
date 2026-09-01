/**
 * The private wallet (stealth sync) kill switch, read server side.
 *
 * WHY THIS EXISTS. public.app_flags key `stealth_sync_enabled` was read only
 * by the browser (src/lib/stealth/runtimeFlags.ts). Nothing on the server ever
 * consulted it, so every server side path trusted the client to have honoured
 * a gate the client itself controls. A kill switch that only the browser reads
 * is a convention, not a control: it stops the app's own buttons and stops
 * nothing else.
 *
 * FAILS CLOSED, with no exceptions. The gate is false unless a successful read
 * returned a row whose `enabled` is exactly boolean true.
 *   - Read returns an error (table absent, network, permission): false.
 *   - Read throws: false.
 *   - Read succeeds with no row: false.
 *   - Read succeeds with a row whose enabled is not exactly true: false.
 *   - Read succeeds with a row whose enabled is true: true.
 * This is the same polarity the browser side settled on, stated once so the
 * two sides cannot drift.
 *
 * NOT CACHED, deliberately. Edge function instances are reused across
 * requests, so a cached `true` would outlive a flip of the row by an unbounded
 * amount. That is the same defect this control exists to remove, moved to the
 * server. The read is one indexed lookup against a single row table and the
 * gated action is rare, so paying for it every time is the cheap side of the
 * trade.
 *
 * The client is duck typed rather than imported from supabase-js so this module
 * stays free of a Deno-only dependency and can be exercised from the Node based
 * vitest suite with a fake that asserts the exact table, column and key read.
 */

/** The table holding non secret runtime configuration. */
export const APP_FLAGS_TABLE = "app_flags";

/** The row key for the private wallet sync kill switch. */
export const STEALTH_SYNC_FLAG_KEY = "stealth_sync_enabled";

/**
 * Stable machine readable code returned when the switch is off. The client
 * matches on this, not on the human sentence, so the sentence can be reworded
 * without breaking the refusal path.
 */
export const STEALTH_SYNC_DISABLED_CODE = "stealth_sync_disabled";

/** Human sentence shown to a customer when the switch is off. */
export const STEALTH_SYNC_DISABLED_ERROR =
  "Private wallet connections are temporarily unavailable. Nothing was issued.";

/**
 * 503, not 403. The customer is not forbidden, the feature is switched off,
 * and 503 is the status that says "try later" without implying the account is
 * at fault.
 */
export const STEALTH_SYNC_DISABLED_STATUS = 503;

export interface AppFlagRow {
  enabled?: unknown;
}

export interface AppFlagQuery {
  maybeSingle(): Promise<{ data: AppFlagRow | null; error: unknown }>;
}

export interface AppFlagFilter {
  eq(column: string, value: string): AppFlagQuery;
}

export interface AppFlagTable {
  select(columns: string): AppFlagFilter;
}

/** The minimum surface of a Supabase client this module needs. */
export interface AppFlagReader {
  from(table: string): AppFlagTable;
}

/**
 * Read the private wallet sync switch. Never throws. Returns true only on a
 * successful read of a row that says true; everything else is false.
 */
export async function readStealthSyncEnabled(client: AppFlagReader): Promise<boolean> {
  try {
    const { data, error } = await client
      .from(APP_FLAGS_TABLE)
      .select("enabled")
      .eq("key", STEALTH_SYNC_FLAG_KEY)
      .maybeSingle();
    if (error) return false;
    return data?.enabled === true;
  } catch {
    return false;
  }
}
