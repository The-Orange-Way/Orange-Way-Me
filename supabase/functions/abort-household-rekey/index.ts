/**
 * abort-household-rekey — Supabase Edge Function (Phase 4.5).
 *
 * Two modes, chosen via the `mode` field:
 *
 *   1. `abort_in_flight` — stop a job that hasn't finalized yet.
 *      - Deletes new wraps (household_keys) at the new key_version.
 *      - household_active_key_versions unchanged.
 *      - Rows that were partially re-keyed: this function does NOT
 *        revert them itself — the client is expected to decrypt with
 *        the new DEK, re-encrypt with the old DEK, and POST the
 *        revert batch back through household-rekey-batch. Until that
 *        revert batch runs, the row is readable under the NEW
 *        dek_key_version + NEW DEK, which is still the "additive"
 *        state pre-finalize. household_active_key_versions still
 *        points at the OLD version, so other readers see corrupted
 *        rows until the revert completes. For safety the abort flow
 *        in the UI wizard blocks until revert completes (Deep mode
 *        only; Quick mode rekey is safe to abort without revert).
 *      - Job status → 'aborted'.
 *
 *   2. `rollback_after_complete` — emergency rollback after finalize,
 *      within the 30-day rollback window.
 *      - household_active_key_versions flipped back to
 *        previous_dek_key_version.
 *      - Job status → 'rolled_back'.
 *      - New wraps are left on disk for audit.
 *      - Rows at the new dek_key_version are NOT reverted (the
 *        rollback window deliberately keeps both versions readable —
 *        new writes after rollback go to the restored active version,
 *        old rows stay decryptable under their recorded
 *        dek_key_version).
 *
 * Request body:
 *   { "job_id": "<uuid>",
 *     "mode": "abort_in_flight" | "rollback_after_complete",
 *     "reason"?: "string" }
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
    let body: { job_id?: unknown; mode?: unknown; reason?: unknown };
    try {
      body = JSON.parse(raw || "{}");
    } catch {
      return jsonResponse({ error: "Invalid JSON" }, 400, cors);
    }
    const jobId = typeof body.job_id === "string" ? body.job_id.trim() : "";
    const mode = typeof body.mode === "string" ? body.mode : "";
    const reason = typeof body.reason === "string" ? body.reason.slice(0, 512) : null;
    if (!jobId || !UUID_RE.test(jobId)) {
      return jsonResponse({ error: "job_id is required" }, 400, cors);
    }
    if (mode !== "abort_in_flight" && mode !== "rollback_after_complete") {
      return jsonResponse(
        { error: "mode must be abort_in_flight or rollback_after_complete" },
        400,
        cors,
      );
    }

    const { data: jobRow, error: jobErr } = await adminClient
      .from("household_key_rotation_jobs")
      .select(
        "id, household_id, status, new_dek_key_version, previous_dek_key_version, rollback_expires_at, started_by",
      )
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
      previous_dek_key_version: number | null;
      rollback_expires_at: string | null;
      started_by: string;
    };

    const { data: hh } = await adminClient
      .from("households")
      .select("owner_id")
      .eq("id", job.household_id)
      .maybeSingle();
    if (!hh || (hh as { owner_id: string }).owner_id !== caller.id) {
      return jsonResponse(
        { error: "You don't have permission to stop this household refresh." },
        403,
        cors,
      );
    }

    if (mode === "abort_in_flight") {
      if (job.status === "complete" || job.status === "aborted" || job.status === "rolled_back") {
        return jsonResponse(
          { error: `Job is already in status '${job.status}' — cannot abort.` },
          409,
          cors,
        );
      }

      // Delete new wraps at the new version. Old wraps at the previous
      // version (or at v1 for first-time-setup) stay untouched.
      const { error: delErr } = await adminClient
        .from("household_keys")
        .delete()
        .eq("household_id", job.household_id)
        .eq("key_version", job.new_dek_key_version);
      if (delErr) {
        console.warn("abort-household-rekey delete household_keys failed:", delErr);
      }

      const { error: advErr } = await adminClient.rpc("advance_household_rotation_job", {
        p_job_id: job.id,
        p_new_status: "aborted",
      });
      if (advErr) {
        console.error("abort-household-rekey advance failed:", advErr);
        return jsonResponse({ error: "Could not record abort state." }, 500, cors);
      }
      if (reason) {
        await adminClient
          .from("household_key_rotation_jobs")
          .update({ abort_reason: reason })
          .eq("id", job.id);
      }

      try {
        await adminClient.from("vault_security_events").insert({
          user_id: caller.id,
          event: "household_rekey.aborted",
          metadata: { job_id: job.id, household_id: job.household_id, reason },
        });
      } catch {
        /* non-fatal */
      }

      return jsonResponse({ ok: true, status: "aborted" }, 200, cors);
    }

    // mode === 'rollback_after_complete'
    if (job.status !== "complete") {
      return jsonResponse(
        { error: `Emergency rollback requires status='complete'; got '${job.status}'.` },
        409,
        cors,
      );
    }
    if (!job.rollback_expires_at || new Date(job.rollback_expires_at) < new Date()) {
      return jsonResponse(
        { error: "The rollback window has expired. The previous keys were purged after 30 days." },
        410,
        cors,
      );
    }
    if (job.previous_dek_key_version === null) {
      return jsonResponse(
        {
          error:
            "This household refresh has no previous version to roll back to (first-time setup).",
        },
        409,
        cors,
      );
    }

    // Flip household_active_key_versions back to the previous version.
    const { error: activeErr } = await adminClient
      .from("household_active_key_versions")
      .update({
        active_dek_key_version: job.previous_dek_key_version,
        last_rotated_at: new Date().toISOString(),
      })
      .eq("household_id", job.household_id);
    if (activeErr) {
      console.error("abort-household-rekey rollback active update failed:", activeErr);
      return jsonResponse({ error: "Could not roll back the active key pointer." }, 500, cors);
    }

    const { error: advErr } = await adminClient.rpc("advance_household_rotation_job", {
      p_job_id: job.id,
      p_new_status: "rolled_back",
    });
    if (advErr) {
      console.error("abort-household-rekey advance rolled_back failed:", advErr);
      return jsonResponse({ error: "Could not record rollback state." }, 500, cors);
    }
    if (reason) {
      await adminClient
        .from("household_key_rotation_jobs")
        .update({ abort_reason: reason })
        .eq("id", job.id);
    }

    try {
      await adminClient.from("vault_security_events").insert({
        user_id: caller.id,
        event: "household_rekey.rolled_back",
        metadata: {
          job_id: job.id,
          household_id: job.household_id,
          reason,
          restored_dek_key_version: job.previous_dek_key_version,
        },
      });
    } catch {
      /* non-fatal */
    }

    return jsonResponse(
      {
        ok: true,
        status: "rolled_back",
        active_dek_key_version: job.previous_dek_key_version,
      },
      200,
      cors,
    );
  } catch (err) {
    console.error("abort-household-rekey error:", err);
    return jsonResponse({ error: "Internal error" }, 500, cors);
  }
});
