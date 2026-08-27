/**
 * Durable run records for client stealth sync executions (DL-1447).
 *
 * Every call to handleStealthSync (manual Sync click or a user-initiated
 * retry) writes one row to public.stealth_sync_runs: a "started" row when
 * the widget launches, updated to "success" or "error" when the widget
 * reports a terminal outcome. This makes a stealth sync verifiable from
 * our own database instead of inferred from Orange Rails coverage state.
 *
 * ZKA: only pass counts, a connection id, and a short error code. Never
 * pass an address, a txid, a decrypted label, or anything else that
 * identifies a wallet or its contents.
 *
 * Non-fatal by design: a write failure here must never interrupt or fail
 * the sync it is trying to record. Errors are logged to console and
 * swallowed, same pattern as src/lib/audit.ts.
 */

import { supabase } from "@/integrations/supabase/client";

export type StealthSyncRunStatus = "success" | "error";

/**
 * Insert the "started" row for one stealth sync execution. Returns the
 * new row's id (to pass to finishStealthSyncRun), or null if the insert
 * failed — callers must treat null as "no record for this run" and carry
 * on with the sync regardless.
 */
export async function startStealthSyncRun(
  userId: string,
  connectionId: string,
): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from("stealth_sync_runs")
      .insert({ user_id: userId, connection_id: connectionId, status: "started" })
      .select("id")
      .single();
    if (error || !data) {
      console.warn("[StealthSyncRuns] insert rejected:", error);
      return null;
    }
    return data.id;
  } catch (err) {
    console.warn("[StealthSyncRuns] failed to write started row:", err);
    return null;
  }
}

/**
 * Mark a run row as finished. runId may be null (the started insert
 * already failed) — in that case there is nothing to update and this is
 * a no-op, not a retry of the insert, so we never lose the fact that the
 * original write failed.
 */
export async function finishStealthSyncRun(
  runId: string | null,
  outcome: {
    status: StealthSyncRunStatus;
    rowsAttempted?: number;
    rowsWritten?: number;
    errorCode?: string;
  },
): Promise<void> {
  if (!runId) return;
  try {
    const { error } = await supabase
      .from("stealth_sync_runs")
      .update({
        finished_at: new Date().toISOString(),
        status: outcome.status,
        rows_attempted: outcome.rowsAttempted ?? null,
        rows_written: outcome.rowsWritten ?? null,
        error_code: outcome.errorCode ?? null,
      })
      .eq("id", runId);
    if (error) {
      console.warn("[StealthSyncRuns] update rejected:", error);
    }
  } catch (err) {
    console.warn("[StealthSyncRuns] failed to write finished row:", err);
  }
}
