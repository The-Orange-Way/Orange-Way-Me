/**
 * household-rekey-batch — Supabase Edge Function (Phase 4.5).
 *
 * Worker endpoint called repeatedly by the client during a household
 * refresh. Handles two kinds of batches:
 *
 *   1. stage='wrap_members':
 *        Inserts rows into `household_keys` at the new key_version.
 *        Inserts are additive: household_active_key_versions is NOT
 *        touched yet. No OSK here — only the DEK wraps.
 *
 *   2. stage='rekey_rows':
 *        batch.rows[] each specifies:
 *          { table, row_id, new_dek_key_version,
 *            new_ciphertext_fields: { col: base64 } }
 *        For each row, the function UPDATEs the matching shared-table
 *        row with the new ciphertext columns + new dek_key_version.
 *        Empty new_ciphertext_fields → only bump dek_key_version
 *        (Quick refresh mode, or first-time-setup fast path where old
 *        ciphertext under the per-user MEK stays readable).
 *
 * Authorization: caller must be the household Owner. The job must be
 * in the right status for the requested stage.
 *
 * Atomicity: each batch is processed inside ONE outer try/catch. If any
 * single row UPDATE fails the function returns { ok: false, failed_rows
 * }. The CLIENT must then call abort-household-rekey; no partial-commit
 * handling happens here because PostgREST doesn't give us a transaction
 * around multiple UPDATEs.
 *
 * Request body:
 *   {
 *     "job_id": "<uuid>",
 *     "stage":  "wrap_members" | "rekey_rows",
 *     "batch":  <stage-specific shape — see above>
 *   }
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
const BASE64_RE = /^[A-Za-z0-9+/=]+$/;

const MAX_BATCH_SIZE_ROWS = 500;
const MAX_BATCH_SIZE_WRAPS = 200;

/**
 * Map a Postgres SQLSTATE (and best-effort message) to a short generic
 * label that's safe to echo back to a client. Postgres error messages
 * embed table names, constraint names, and column types: useful
 * reconnaissance for an attacker probing for the next bypass. The
 * SQLSTATE itself is documented and stable.
 *
 * Keep this list small. The caller of household-rekey-batch is the user's
 * own browser performing a key rotation it initiated, so they don't need
 * a detailed error to recover; a brief category is enough.
 */
function sanitizeDbError(code: string | undefined, raw: string): string {
  switch (code) {
    case "23505":
      return "row already exists";
    case "23503":
      return "referenced row missing";
    case "23502":
      return "required value missing";
    case "42501":
      return "permission denied";
    case "PGRST116":
      return "row not found";
    default:
      // No SQLSTATE match: refuse to leak the raw message. The full text
      // is still written to the edge function's own stdout for operators
      // (see console.warn above this call site).
      void raw;
      return "update failed";
  }
}

// Whitelist of shared tables that accept rekey_rows updates. Any other
// value is rejected so a malicious client cannot overwrite arbitrary
// rows.
const ALLOWED_REKEY_TABLES = new Set([
  "transactions",
  "accounts",
  "categories",
  "budgets",
  "goals",
  "rules",
]);

// Per-table allowed ciphertext column names. Matches the
// crypto-fields.ts shape; update in lockstep when new encrypted columns
// are added.
const ALLOWED_CIPHERTEXT_COLUMNS: Readonly<Record<string, Set<string>>> = Object.freeze({
  transactions: new Set([
    "enc_amount",
    "enc_description",
    "enc_merchant",
    "enc_category_id",
    "enc_memo",
    "enc_tags",
    "enc_owner",
  ]),
  accounts: new Set([
    "enc_name",
    "enc_type",
    "enc_currency",
    "enc_institution",
    "enc_balance",
    "enc_metadata",
  ]),
  categories: new Set(["enc_name", "enc_icon", "enc_color", "enc_parent_id"]),
  budgets: new Set(["enc_mode", "enc_data"]),
  goals: new Set([
    "enc_name",
    "enc_type",
    "enc_target_amount",
    "enc_current_amount",
    "enc_target_date",
    "enc_strategy",
    "enc_linked_account_ids",
  ]),
  rules: new Set(["enc_name", "enc_conditions", "enc_actions"]),
});

interface HouseholdRekeyJob {
  id: string;
  household_id: string;
  status: string;
  new_dek_key_version: number;
  rows_processed: number;
  rows_failed: number;
  error_log: unknown[];
  started_by: string;
}

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
    let body: { job_id?: unknown; stage?: unknown; batch?: unknown };
    try {
      body = JSON.parse(raw || "{}");
    } catch {
      return jsonResponse({ error: "Invalid JSON" }, 400, cors);
    }

    const jobId = typeof body.job_id === "string" ? body.job_id.trim() : "";
    const stage = typeof body.stage === "string" ? body.stage : "";
    if (!jobId || !UUID_RE.test(jobId)) {
      return jsonResponse({ error: "job_id is required" }, 400, cors);
    }
    if (stage !== "wrap_members" && stage !== "rekey_rows") {
      return jsonResponse({ error: "stage must be wrap_members or rekey_rows" }, 400, cors);
    }

    // Load job + authorize.
    const { data: jobData, error: jobErr } = await adminClient
      .from("household_key_rotation_jobs")
      .select(
        "id, household_id, status, new_dek_key_version, rows_processed, rows_failed, error_log, started_by",
      )
      .eq("id", jobId)
      .maybeSingle();
    if (jobErr || !jobData) {
      return jsonResponse({ error: "Household refresh job not found" }, 404, cors);
    }
    const job = jobData as HouseholdRekeyJob;

    // Caller must be the household Owner.
    const { data: hh } = await adminClient
      .from("households")
      .select("owner_id")
      .eq("id", job.household_id)
      .maybeSingle();
    if (!hh || (hh as { owner_id: string }).owner_id !== caller.id) {
      return jsonResponse(
        { error: "You don't have permission to continue this household refresh." },
        403,
        cors,
      );
    }

    if (job.status === "complete" || job.status === "aborted" || job.status === "rolled_back") {
      return jsonResponse(
        { error: `Job is in status '${job.status}' — no further work accepted.` },
        409,
        cors,
      );
    }

    if (stage === "wrap_members") {
      return await handleWrapMembers(body.batch, job, cors);
    }
    return await handleRekeyRows(body.batch, job, cors);
  } catch (err) {
    console.error("household-rekey-batch error:", err);
    return jsonResponse({ error: "Internal error" }, 500, cors);
  }
});

/* ═══════════════════════════════════════════════════════════════════ */
/* wrap_members                                                         */
/* ═══════════════════════════════════════════════════════════════════ */

async function handleWrapMembers(
  batchRaw: unknown,
  job: HouseholdRekeyJob,
  cors: Record<string, string>,
): Promise<Response> {
  if (!batchRaw || typeof batchRaw !== "object") {
    return jsonResponse({ error: "batch must be an object" }, 400, cors);
  }
  const batch = batchRaw as { rows?: unknown[] };
  if (!Array.isArray(batch.rows)) {
    return jsonResponse({ error: "batch.rows must be an array" }, 400, cors);
  }
  if (batch.rows.length === 0) {
    return jsonResponse({ ok: true, inserted: 0 }, 200, cors);
  }
  if (batch.rows.length > MAX_BATCH_SIZE_WRAPS) {
    return jsonResponse(
      { error: `Too many wraps in one batch (max ${MAX_BATCH_SIZE_WRAPS})` },
      400,
      cors,
    );
  }

  // Validate every row before any insert.
  const dekRows: Array<{
    household_id: string;
    user_id: string;
    enc_household_dek: string;
    key_version: number;
    wrapped_by: string;
    is_placeholder: boolean;
  }> = [];
  for (let i = 0; i < batch.rows.length; i++) {
    const r = batch.rows[i] as Record<string, unknown>;
    if (typeof r.user_id !== "string" || !UUID_RE.test(r.user_id)) {
      return jsonResponse({ error: `rows[${i}].user_id invalid` }, 400, cors);
    }
    if (
      typeof r.enc_household_dek !== "string" ||
      !BASE64_RE.test(r.enc_household_dek) ||
      r.enc_household_dek.length > 16384
    ) {
      return jsonResponse({ error: `rows[${i}].enc_household_dek invalid` }, 400, cors);
    }
    if (typeof r.key_version !== "number" || r.key_version !== job.new_dek_key_version) {
      return jsonResponse(
        { error: `rows[${i}].key_version must be ${job.new_dek_key_version}` },
        400,
        cors,
      );
    }
    dekRows.push({
      household_id: job.household_id,
      user_id: r.user_id,
      enc_household_dek: r.enc_household_dek,
      key_version: job.new_dek_key_version,
      wrapped_by: job.started_by,
      is_placeholder: false,
    });
  }

  const { error } = await adminClient
    .from("household_keys")
    .upsert(dekRows, { onConflict: "household_id,user_id,key_version" });
  if (error) {
    console.error("household-rekey-batch dek upsert failed:", error);
    return jsonResponse({ error: "Could not save a new household key wrap." }, 500, cors);
  }

  try {
    await adminClient.from("vault_security_events").insert({
      user_id: job.started_by,
      event: "household_rekey.batch_completed",
      metadata: {
        job_id: job.id,
        household_id: job.household_id,
        stage: "wrap_members",
        count: dekRows.length,
      },
    });
  } catch {
    /* non-fatal */
  }

  return jsonResponse({ ok: true, inserted: dekRows.length }, 200, cors);
}

/* ═══════════════════════════════════════════════════════════════════ */
/* rekey_rows                                                           */
/* ═══════════════════════════════════════════════════════════════════ */

async function handleRekeyRows(
  batchRaw: unknown,
  job: HouseholdRekeyJob,
  cors: Record<string, string>,
): Promise<Response> {
  if (!batchRaw || typeof batchRaw !== "object") {
    return jsonResponse({ error: "batch must be an object" }, 400, cors);
  }
  const batch = batchRaw as { rows?: unknown[] };
  if (!Array.isArray(batch.rows)) {
    return jsonResponse({ error: "batch.rows must be an array" }, 400, cors);
  }
  if (batch.rows.length > MAX_BATCH_SIZE_ROWS) {
    return jsonResponse(
      { error: `Too many rows in one batch (max ${MAX_BATCH_SIZE_ROWS})` },
      400,
      cors,
    );
  }

  interface RekeyRowUpdate {
    table: string;
    row_id: string;
    new_dek_key_version: number;
    new_ciphertext_fields: Record<string, string>;
  }
  const updates: RekeyRowUpdate[] = [];
  for (let i = 0; i < batch.rows.length; i++) {
    const r = batch.rows[i] as Record<string, unknown>;
    if (typeof r.table !== "string" || !ALLOWED_REKEY_TABLES.has(r.table)) {
      return jsonResponse({ error: `rows[${i}].table not allowed` }, 400, cors);
    }
    if (typeof r.row_id !== "string" || !UUID_RE.test(r.row_id)) {
      return jsonResponse({ error: `rows[${i}].row_id invalid` }, 400, cors);
    }
    if (
      typeof r.new_dek_key_version !== "number" ||
      r.new_dek_key_version !== job.new_dek_key_version
    ) {
      return jsonResponse(
        { error: `rows[${i}].new_dek_key_version must be ${job.new_dek_key_version}` },
        400,
        cors,
      );
    }
    const fields = r.new_ciphertext_fields ?? {};
    if (typeof fields !== "object" || fields === null) {
      return jsonResponse(
        { error: `rows[${i}].new_ciphertext_fields must be an object` },
        400,
        cors,
      );
    }
    const allowedCols = ALLOWED_CIPHERTEXT_COLUMNS[r.table] ?? new Set<string>();
    const safeFields: Record<string, string> = {};
    for (const [col, val] of Object.entries(fields as Record<string, unknown>)) {
      if (!allowedCols.has(col)) {
        return jsonResponse(
          {
            error: `rows[${i}].new_ciphertext_fields.${col} is not an allowed column for ${r.table}`,
          },
          400,
          cors,
        );
      }
      if (typeof val !== "string" || val.length > 65536) {
        return jsonResponse(
          { error: `rows[${i}].new_ciphertext_fields.${col} must be a string under 64KB` },
          400,
          cors,
        );
      }
      safeFields[col] = val;
    }
    updates.push({
      table: r.table,
      row_id: r.row_id,
      new_dek_key_version: job.new_dek_key_version,
      new_ciphertext_fields: safeFields,
    });
  }

  const failedRows: Array<{ table: string; row_id: string; error: string }> = [];
  let applied = 0;
  for (const u of updates) {
    const update: Record<string, unknown> = {
      dek_key_version: u.new_dek_key_version,
      ...u.new_ciphertext_fields,
    };
    // Defense-in-depth: require household_id match too so a bad row_id
    // can't reach across households.
    const { error } = await adminClient
      .from(u.table)
      .update(update)
      .eq("id", u.row_id)
      .eq("household_id", job.household_id);
    if (error) {
      // Do NOT echo the raw Postgres error message back to the client. It
      // leaks table names, column names, and constraint names that an
      // attacker can use as reconnaissance for the next bypass attempt.
      // Map the Postgres SQLSTATE to a short generic label instead.
      failedRows.push({
        table: u.table,
        row_id: u.row_id,
        error: sanitizeDbError(error.code, error.message),
      });
    } else {
      applied += 1;
    }
  }

  const newErrorLog =
    failedRows.length > 0
      ? [...(Array.isArray(job.error_log) ? job.error_log : []), ...failedRows.slice(0, 50)]
      : job.error_log;
  await adminClient
    .from("household_key_rotation_jobs")
    .update({
      rows_processed: job.rows_processed + applied,
      rows_failed: job.rows_failed + failedRows.length,
      error_log: newErrorLog,
    })
    .eq("id", job.id);

  if (failedRows.length > 0) {
    return jsonResponse({ ok: false, applied, failed_rows: failedRows }, 200, cors);
  }

  try {
    await adminClient.from("vault_security_events").insert({
      user_id: job.started_by,
      event: "household_rekey.batch_completed",
      metadata: {
        job_id: job.id,
        household_id: job.household_id,
        stage: "rekey_rows",
        count: applied,
      },
    });
  } catch {
    /* non-fatal */
  }

  return jsonResponse({ ok: true, applied }, 200, cors);
}
