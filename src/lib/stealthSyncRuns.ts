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

// Mirrors the CHECK constraint on stealth_sync_runs.error_code: a short
// code only, never a message. Applied here too so a widget code that does
// not fit (too long, or carrying anything other than [A-Za-z0-9_]) fails
// closed to a fixed placeholder instead of failing the whole insert, and
// so this column can never carry an address, a txid, or free text even if
// the widget's own code vocabulary changes upstream.
const ERROR_CODE_MAX_LEN = 32;
const ERROR_CODE_PATTERN = /^[A-Za-z0-9_]+$/;

function normalizeErrorCode(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const truncated = raw.slice(0, ERROR_CODE_MAX_LEN);
  return ERROR_CODE_PATTERN.test(truncated) ? truncated : "UNRECOGNIZED";
}

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
