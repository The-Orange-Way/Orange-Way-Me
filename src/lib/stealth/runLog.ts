/**
 * DL-1447. Durable per-execution run record for the client stealth sync.
 *
 * Every stealth scan and the ledger import that follows it used to leave no
 * trace anywhere queryable: the only evidence a run happened was a toast the
 * customer may not have seen and a console line nobody but the browser ever
 * reads. `recordStealthSyncRun` writes exactly one row per execution to
 * `stealth_sync_runs`, so QA (or an operator chasing a support ticket) can
 * confirm from the database that a sync ran, whether it succeeded, and how
 * many rows it touched.
 *
 * ZKA: only counts and status cross this boundary. No address, no txid, no
 * label, nothing that identifies which wallet or which transaction moved.
 *
 * This never throws. A write failure here is a visibility gap, not a reason
 * to fail (or re-report as failed) a sync the customer is already waiting
 * on, so every failure is caught and logged, never surfaced to the caller.
 */

import { supabase } from "@/integrations/supabase/client";

export type StealthSyncRunStatus = "success" | "error";

export interface StealthSyncRunRecord {
  connectionId: string;
  startedAt: string;
  finishedAt: string;
  status: StealthSyncRunStatus;
  rowsAttempted: number;
  rowsWritten: number;
  errorCode?: string | null;
}

export async function recordStealthSyncRun(rec: StealthSyncRunRecord): Promise<void> {
  try {
    const { error } = await supabase.from("stealth_sync_runs").insert({
      connection_id: rec.connectionId,
      started_at: rec.startedAt,
      finished_at: rec.finishedAt,
      status: rec.status,
      rows_attempted: rec.rowsAttempted,
      rows_written: rec.rowsWritten,
      error_code: rec.errorCode ?? null,
    });
    if (error) {
      console.error("[stealth] failed to write sync run record", error.message);
    }
  } catch (err) {
    console.error("[stealth] failed to write sync run record", err);
  }
}
