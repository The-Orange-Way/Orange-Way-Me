/**
 * start-household-rekey-job — Supabase Edge Function (Phase 4.5).
 *
 * Household-Owner-initiated entry point for a household refresh.
 * Validates authorization, ensures no other active job exists for the
 * household, counts rows across shared tables, and inserts a
 * `household_key_rotation_jobs` row in status `pending`. Returns the
 * job id + row count + time estimate for the 7-step safety dialog.
 *
 * DOES NOT perform any crypto — the client drives every stage after
 * this. DOES NOT advance the job past `pending`; the client calls
 * `advance_household_rotation_job` as it progresses.
 *
 * Request body (JSON):
 *   {
 *     "household_id": "<uuid>",
 *     "trigger_type": "first_time_setup" | "manual" | "post_revoke",
 *     "refresh_mode": "quick" | "deep"
 *   }
 *
 * Response (200):
 *   { job_id, rows_total, estimated_seconds,
 *     new_dek_key_version, previous_dek_key_version }
 *
 * Authorization: caller must be the household Owner (households.owner_id
 * match). We deliberately skip capability keys — Orange Way uses simpler
 * household role-based permissions per the Phase 4.1 schema.
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

const VALID_TRIGGERS = new Set(["first_time_setup", "manual", "post_revoke"]);
const VALID_MODES = new Set(["quick", "deep"]);

// Tables we count rows for when estimating. Must match
// household-rekey.ts BUSINESS_TABLES — if a table exists in one place
// but not the other the estimate is off but the job still runs
// correctly.
const COUNTABLE_TABLES = [
  "transactions",
  "accounts",
  "categories",
  "budgets",
  "goals",
  "rules",
] as const;

// Rough estimate — 600 rows/sec for decrypt+encrypt round trip (Deep).
// Quick mode is much faster (just a version bump) but we keep the
// estimate conservative so the dialog copy doesn't under-promise.
const ROWS_PER_SECOND_DEEP = 600;
const ROWS_PER_SECOND_QUICK = 4000;

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
    if (raw === null) {
      return jsonResponse({ error: "Request body too large" }, 413, cors);
    }
    let body: { household_id?: unknown; trigger_type?: unknown; refresh_mode?: unknown };
    try {
      body = JSON.parse(raw || "{}");
    } catch {
      return jsonResponse({ error: "Invalid JSON" }, 400, cors);
    }

    const householdId = typeof body.household_id === "string" ? body.household_id.trim() : "";
    const triggerType = typeof body.trigger_type === "string" ? body.trigger_type.trim() : "";
    const refreshMode = typeof body.refresh_mode === "string" ? body.refresh_mode.trim() : "quick";
    if (!householdId || !UUID_RE.test(householdId)) {
      return jsonResponse({ error: "household_id is required" }, 400, cors);
    }
    if (!VALID_TRIGGERS.has(triggerType)) {
      return jsonResponse(
        { error: "trigger_type must be first_time_setup, manual, or post_revoke" },
        400,
        cors,
      );
    }
    if (!VALID_MODES.has(refreshMode)) {
      return jsonResponse({ error: "refresh_mode must be quick or deep" }, 400, cors);
    }

    // Caller must be the household Owner.
    const { data: hh, error: hhErr } = await adminClient
      .from("households")
      .select("id, owner_id")
      .eq("id", householdId)
      .maybeSingle();
    if (hhErr || !hh) {
      return jsonResponse({ error: "Household not found" }, 404, cors);
    }
    if ((hh as { owner_id: string }).owner_id !== caller.id) {
      return jsonResponse(
        { error: "Only the household Owner can refresh household security." },
        403,
        cors,
      );
    }

    // Reject if an active job already exists for this household.
    const { data: activeJob } = await adminClient
      .from("household_key_rotation_jobs")
      .select("id, status")
      .eq("household_id", householdId)
      .not("status", "in", "(complete,aborted,rolled_back)")
      .maybeSingle();
    if (activeJob) {
      return jsonResponse(
        {
          error: "A household refresh is already running.",
          existing_job_id: (activeJob as { id: string }).id,
        },
        409,
        cors,
      );
    }

    // Look up the current active DEK version. Defaults to 1 if the
    // household_active_key_versions row doesn't exist yet (pre-backfill).
    const { data: active } = await adminClient
      .from("household_active_key_versions")
      .select("active_dek_key_version")
      .eq("household_id", householdId)
      .maybeSingle();
    const currentDekVersion =
      (active as { active_dek_key_version?: number } | null)?.active_dek_key_version ?? 1;
    const newDekVersion = currentDekVersion + 1;

    // For first-time-setup, previous_* is NULL — the baseline is
    // placeholder wraps, not a real prior DEK. For manual / post_revoke,
    // previous_* is the pre-refresh version (used by emergency rollback).
    const prevDekVersion = triggerType === "first_time_setup" ? null : currentDekVersion;

    // Row count estimate across shared tables. Each table is an
    // independent count(*) — keeps DoS pressure bounded.
    let rowsTotal = 0;
    for (const table of COUNTABLE_TABLES) {
      try {
        const { count } = await adminClient
          .from(table)
          .select("*", { count: "exact", head: true })
          .eq("household_id", householdId);
        rowsTotal += count ?? 0;
      } catch (err) {
        console.warn(`start-household-rekey-job: count failed for ${table}:`, err);
      }
    }

    const { data: inserted, error: insertErr } = await adminClient
      .from("household_key_rotation_jobs")
      .insert({
        household_id: householdId,
        status: "pending",
        trigger_type: triggerType,
        refresh_mode: refreshMode,
        started_by: caller.id,
        new_dek_key_version: newDekVersion,
        previous_dek_key_version: prevDekVersion,
        rows_total: rowsTotal,
      })
      .select("id")
      .single();
    if (insertErr || !inserted) {
      console.error("start-household-rekey-job insert failed:", insertErr);
      return jsonResponse({ error: "Could not start the household refresh." }, 500, cors);
    }

    // Audit event — captures the SEED of the job (advance_household_
    // rotation_job writes a separate status_changed event on every
    // transition).
    try {
      await adminClient.from("vault_security_events").insert({
        user_id: caller.id,
        event: "household_rekey.started",
        metadata: {
          job_id: (inserted as { id: string }).id,
          household_id: householdId,
          trigger_type: triggerType,
          refresh_mode: refreshMode,
          rows_total: rowsTotal,
          new_dek_key_version: newDekVersion,
        },
      });
    } catch (err) {
      console.warn("start-household-rekey-job audit insert threw:", err);
    }

    const rowsPerSecond = refreshMode === "deep" ? ROWS_PER_SECOND_DEEP : ROWS_PER_SECOND_QUICK;
    const estimatedSeconds = Math.max(30, Math.ceil(rowsTotal / rowsPerSecond));

    return jsonResponse(
      {
        job_id: (inserted as { id: string }).id,
        rows_total: rowsTotal,
        estimated_seconds: estimatedSeconds,
        new_dek_key_version: newDekVersion,
        previous_dek_key_version: prevDekVersion,
        refresh_mode: refreshMode,
      },
      200,
      cors,
    );
  } catch (err) {
    console.error("start-household-rekey-job error:", err);
    return jsonResponse({ error: "Internal error" }, 500, cors);
  }
});
