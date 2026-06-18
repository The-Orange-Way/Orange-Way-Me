/**
 * finalize-household-rekey — Supabase Edge Function (Phase 4.5).
 *
 * The atomic cutover. Called once the client has finished
 * wrap_members + rekey_rows stages. Flips
 * `household_active_key_versions` to the new version and marks the
 * job `complete` with a 30-day `rollback_expires_at`.
 *
 * Safety invariants:
 *   - Job must be in status='finalizing' (set by
 *     advance_household_rotation_job at the end of rekey_rows).
 *   - household_active_key_versions UPDATE + job status UPDATE happen
 *     back-to-back. No multi-statement transaction over HTTP, but the
 *     job-row update runs after the active pointer flip, so mid-failure
 *     leaves the pointer updated + job mid-way — recoverable by
 *     retrying finalize.
 *
 * Request body: { "job_id": "<uuid>" }
 * Response: { ok: true, active_dek_key_version, rollback_expires_at }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildCorsHeaders, jsonResponse, readBoundedText } from "../_shared/http.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

serve(async (req) => {
  const cors = buildCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: cors });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405, cors);
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader || !authHeader.toLowerCase().startsWith("bearer ")) {
      return jsonResponse({ error: "Missing Authorization header" }, 401, cors);
    }
    const callerClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user: caller },
      error: authErr,
    } = await callerClient.auth.getUser();
    if (authErr || !caller) {
      return jsonResponse({ error: "Unauthorized" }, 401, cors);
    }

    const raw = await readBoundedText(req);
    if (raw === null) return jsonResponse({ error: "Request body too large" }, 413, cors);
    let body: { job_id?: unknown };
    try {
      body = JSON.parse(raw || "{}");
    } catch {
      return jsonResponse({ error: "Invalid JSON" }, 400, cors);
    }
    const jobId = typeof body.job_id === "string" ? body.job_id.trim() : "";
    if (!jobId || !UUID_RE.test(jobId)) {
      return jsonResponse({ error: "job_id is required" }, 400, cors);
    }

    const { data: jobRow, error: jobErr } = await adminClient
      .from("household_key_rotation_jobs")
      .select("id, household_id, status, new_dek_key_version, started_by")
      .eq("id", jobId)
      .maybeSingle();
    if (jobErr || !jobRow) {
      return jsonResponse({ error: "Household refresh job not found" }, 404, cors);
    }
    const job = jobRow as {
      id: string;
      household_id: string;
      status: string;
      new_dek_key_version: number;
      started_by: string;
    };

    const { data: hh } = await adminClient
      .from("households")
      .select("owner_id")
      .eq("id", job.household_id)
      .maybeSingle();
    if (!hh || (hh as { owner_id: string }).owner_id !== caller.id) {
      return jsonResponse(
        { error: "You don't have permission to finish this household refresh." },
        403,
        cors,
      );
    }

    if (job.status !== "finalizing") {
      return jsonResponse(
        { error: `Job is in status '${job.status}' — must be 'finalizing' to complete.` },
        409,
        cors,
      );
    }

    // Atomic cutover: upsert into household_active_key_versions. Ensures
    // a row exists for households created before the Phase 4.5 migration
    // backfilled (defense-in-depth; the migration's INSERT ... WHERE
    // NOT EXISTS already covered this).
    const { error: activeErr } = await adminClient.from("household_active_key_versions").upsert(
      {
        household_id: job.household_id,
        active_dek_key_version: job.new_dek_key_version,
        last_rotated_at: new Date().toISOString(),
      },
      { onConflict: "household_id" },
    );
    if (activeErr) {
      console.error("finalize-household-rekey active upsert failed:", activeErr);
      return jsonResponse({ error: "Could not finalize the household refresh." }, 500, cors);
    }

    const rollbackExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    // Advance status to complete + record rollback window via
    // advance_household_rotation_job (for audit) + direct UPDATE of
    // rollback_expires_at (the RPC doesn't set it).
    const { error: advErr } = await adminClient.rpc("advance_household_rotation_job", {
      p_job_id: job.id,
      p_new_status: "complete",
    });
    if (advErr) {
      console.error("finalize-household-rekey advance failed:", advErr);
      return jsonResponse({ error: "Could not record final job state." }, 500, cors);
    }
    const { error: rollbackErr } = await adminClient
      .from("household_key_rotation_jobs")
      .update({ rollback_expires_at: rollbackExpiresAt })
      .eq("id", job.id);
    if (rollbackErr) {
      console.warn("finalize-household-rekey rollback_expires_at update failed:", rollbackErr);
      // Non-fatal: the job is already complete; emergency rollback
      // during the window will still work using the 30-day policy
      // calculated at read time.
    }

    try {
      await adminClient.from("vault_security_events").insert({
        user_id: caller.id,
        event: "household_rekey.finalized",
        metadata: {
          job_id: job.id,
          household_id: job.household_id,
          active_dek_key_version: job.new_dek_key_version,
          rollback_expires_at: rollbackExpiresAt,
        },
      });
    } catch {
      /* non-fatal */
    }

    return jsonResponse(
      {
        ok: true,
        active_dek_key_version: job.new_dek_key_version,
        rollback_expires_at: rollbackExpiresAt,
      },
      200,
      cors,
    );
  } catch (err) {
    console.error("finalize-household-rekey error:", err);
    return jsonResponse({ error: "Internal error" }, 500, cors);
  }
});
