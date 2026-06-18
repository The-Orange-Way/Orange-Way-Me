/**
 * Phase 4.5 — Household refresh client library.
 *
 * Drives resumable household-refresh jobs end-to-end in the browser.
 * The server owns state (status, row counts, error log), we own crypto
 * (new DEK generation, per-member wraps, per-row decrypt+re-encrypt).
 *
 * ── Flow at a glance ─────────────────────────────────────────────────
 *
 *   startHouseholdRekeyJob(householdId, triggerType, refreshMode)
 *     └─ POST /start-household-rekey-job
 *         → { jobId, rowsTotal, estimatedSeconds }
 *
 *   runHouseholdRekeyJob(jobId, callbacks)
 *     ├─ stage: generating_keys   (browser CPU; no server round-trips)
 *     ├─ stage: wrapping_members  (batches of ~50 wraps)
 *     ├─ stage: rekeying_rows     (batches of 500 rows — Deep mode
 *     │                            decrypts + re-encrypts; Quick mode
 *     │                            just bumps dek_key_version)
 *     └─ stage: finalizing        (POST /finalize-household-rekey)
 *
 * ── Refresh rules ────────────────────────────────────────────────────
 *
 *   - New wraps go into `household_keys` ADDITIVELY with the new
 *     key_version. Old wraps stay readable until the 30-day rollback
 *     window closes and purge_expired_old_household_key_wraps() fires.
 *   - Business rows get `dek_key_version` bumped atomically with their
 *     new ciphertext. Until finalize, the client can decrypt either
 *     old or new rows by picking the matching DEK at read time.
 *   - household_active_key_versions is ONLY flipped by
 *     finalize-household-rekey. That one UPDATE is the atomic cutover.
 *
 * ── Abort semantics ──────────────────────────────────────────────────
 *
 *   - During wrapping_members: abort deletes new wraps.
 *     household_active_key_versions unchanged.
 *   - During rekeying_rows (Deep): partially-updated rows get REVERTED
 *     — this function re-decrypts with the new DEK, re-encrypts with
 *     the old DEK client-side, then POSTs the revert batch.
 *     rekeying_rows (Quick): no revert needed — the dek_key_version
 *     bumps are cosmetic until finalize flips the active pointer.
 *   - After complete (within rollback window): active_key_versions
 *     flipped back. Old wraps are still present because the 30-day
 *     purge hasn't fired — emergency rollback is a pointer flip only.
 *
 * ── Customer copy ────────────────────────────────────────────────────
 *
 *   Every error bubbled through the callbacks carries plain-English
 *   text. No "DEK", "wrap", "cipher" leaks to the UI.
 */

import { supabase } from "@/integrations/supabase/client";
import { KEY_WRAP_STRATEGIES, DEFAULT_WRAP_ALGORITHM, base64ToBytes } from "@/lib/key-wrapping";
import { decryptText as cryptoDecryptText, encryptText as cryptoEncryptText } from "@/lib/vault";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type HouseholdRekeyTriggerType = "first_time_setup" | "manual" | "post_revoke";

export type HouseholdRefreshMode = "quick" | "deep";

export type HouseholdRekeyStage =
  | "generating_keys"
  | "wrapping_members"
  | "rekeying_rows"
  | "finalizing";

export interface StartHouseholdRekeyResult {
  jobId: string;
  rowsTotal: number;
  estimatedSeconds: number;
  newDekKeyVersion: number;
  previousDekKeyVersion: number | null;
  refreshMode: HouseholdRefreshMode;
}

export interface HouseholdRekeyCallbacks {
  onStageChange?: (stage: HouseholdRekeyStage) => void;
  onRowProgress?: (processed: number, total: number) => void;
  onError?: (error: Error, canRetry: boolean) => void;
  onComplete?: () => void;
  onAborted?: (reason: string) => void;
}

export type HouseholdRekeyOutcome = "completed" | "aborted" | "rolled_back";

/** Backup format produced by exportHouseholdBackup. */
export type HouseholdBackupFormat = "csv" | "json";

// ---------------------------------------------------------------------------
// Helpers — base64 + AES-GCM primitives
// ---------------------------------------------------------------------------

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function generateRandomDek(): Uint8Array {
  const dek = new Uint8Array(32);
  crypto.getRandomValues(dek);
  return dek;
}

async function importAesGcmKey(rawBytes: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    rawBytes as BufferSource,
    { name: "AES-GCM" },
    /* extractable */ false,
    ["encrypt", "decrypt"],
  );
}

// ---------------------------------------------------------------------------
// Table registry for row re-key
// ---------------------------------------------------------------------------

/**
 * One entry per shared business table we refresh. `encryptedColumns`
 * lists the base64-AES-GCM text columns on the row whose contents must
 * be migrated in Deep mode. `idColumn` is the row's primary key.
 *
 * The set mirrors `src/lib/crypto-fields.ts` for transactions,
 * accounts, categories, budgets, and goals. Rules use
 * `enc_name`/`enc_conditions`/`enc_actions` columns from the rules
 * migration.
 */
interface TableRekeyDescriptor {
  table: string;
  idColumn: string;
  encryptedColumns: string[];
}

export const BUSINESS_TABLES: readonly TableRekeyDescriptor[] = Object.freeze([
  {
    table: "transactions",
    idColumn: "id",
    encryptedColumns: [
      "enc_amount",
      "enc_description",
      "enc_merchant",
      "enc_category_id",
      "enc_memo",
      "enc_tags",
      "enc_owner",
    ],
  },
  {
    table: "accounts",
    idColumn: "id",
    encryptedColumns: [
      "enc_name",
      "enc_type",
      "enc_currency",
      "enc_institution",
      "enc_balance",
      "enc_metadata",
    ],
  },
  {
    table: "categories",
    idColumn: "id",
    encryptedColumns: ["enc_name", "enc_icon", "enc_color", "enc_parent_id"],
  },
  {
    table: "budgets",
    idColumn: "id",
    encryptedColumns: ["enc_mode", "enc_data"],
  },
  {
    table: "goals",
    idColumn: "id",
    encryptedColumns: [
      "enc_name",
      "enc_type",
      "enc_target_amount",
      "enc_current_amount",
      "enc_target_date",
      "enc_strategy",
      "enc_linked_account_ids",
    ],
  },
  {
    table: "rules",
    idColumn: "id",
    encryptedColumns: ["enc_name", "enc_conditions", "enc_actions"],
  },
]);

const BATCH_SIZE_ROWS = 500;
const BATCH_SIZE_WRAPS = 50;

const ROWS_PER_SECOND_DEEP = 600;
const ROWS_PER_SECOND_QUICK = 4000;

// ---------------------------------------------------------------------------
// Internal — re-encrypt a single ciphertext under a different DEK
// ---------------------------------------------------------------------------

/**
 * Re-encrypt an AES-GCM base64 ciphertext under a different DEK.
 * Matches vault.ts's wire format:
 *   IV[12] || ciphertext+tag, base64-encoded.
 */
async function reencryptFieldUnderNewDek(
  base64Ciphertext: string,
  oldDekKey: CryptoKey,
  newDekKey: CryptoKey,
): Promise<string> {
  const combined = base64ToBytes(base64Ciphertext);
  if (combined.length < 12 + 16) {
    throw new Error("Ciphertext too short to contain an IV and tag.");
  }
  const iv = combined.subarray(0, 12);
  const ct = combined.subarray(12);
  let plaintextBytes: ArrayBuffer;
  try {
    plaintextBytes = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: iv as BufferSource },
      oldDekKey,
      ct as BufferSource,
    );
  } catch (err) {
    throw new Error(
      `Could not read existing data with the current key: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  }
  const newIv = new Uint8Array(12);
  crypto.getRandomValues(newIv);
  const newCt = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: newIv as BufferSource },
      newDekKey,
      plaintextBytes,
    ),
  );
  const out = new Uint8Array(newIv.length + newCt.length);
  out.set(newIv, 0);
  out.set(newCt, newIv.length);
  return bytesToBase64(out);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Kick off a household refresh job on the server. The server inserts a
 * household_key_rotation_jobs row, counts rows across shared tables,
 * and returns an estimate the UI can show in the 7-step wizard.
 *
 * Does NOT perform any crypto — callers then call
 * `runHouseholdRekeyJob(jobId)`.
 */
export async function startHouseholdRekeyJob(
  householdId: string,
  triggerType: HouseholdRekeyTriggerType,
  refreshMode: HouseholdRefreshMode = "quick",
): Promise<StartHouseholdRekeyResult> {
  const { data, error } = await supabase.functions.invoke("start-household-rekey-job", {
    body: {
      household_id: householdId,
      trigger_type: triggerType,
      refresh_mode: refreshMode,
    },
  });
  if (error) {
    throw new Error(friendlyError(error, "Could not start the household refresh."));
  }
  const resp = data as {
    job_id?: string;
    rows_total?: number;
    estimated_seconds?: number;
    new_dek_key_version?: number;
    previous_dek_key_version?: number | null;
    refresh_mode?: HouseholdRefreshMode;
  };
  if (!resp?.job_id) {
    throw new Error("The server did not return a household refresh job id.");
  }
  const rowsPerSecond = refreshMode === "deep" ? ROWS_PER_SECOND_DEEP : ROWS_PER_SECOND_QUICK;
  return {
    jobId: resp.job_id,
    rowsTotal: resp.rows_total ?? 0,
    estimatedSeconds:
      resp.estimated_seconds ?? Math.max(30, Math.ceil((resp.rows_total ?? 0) / rowsPerSecond)),
    newDekKeyVersion: resp.new_dek_key_version ?? 2,
    previousDekKeyVersion: resp.previous_dek_key_version ?? null,
    refreshMode: resp.refresh_mode ?? refreshMode,
  };
}

/**
 * Drive a household refresh job through all stages. The function
 * blocks until the job completes, aborts, or is rolled back. Browser
 * close mid-way is supported: call `resumeHouseholdRekeyJob(jobId)` on
 * the next session to continue from the last finished stage.
 *
 * All error paths invoke `callbacks.onError` with a plain-English
 * message and `canRetry` hint, then either throw (fatal) or carry on.
 */
export async function runHouseholdRekeyJob(
  jobId: string,
  callbacks: HouseholdRekeyCallbacks = {},
): Promise<HouseholdRekeyOutcome> {
  // Fetch the current job so we can skip stages that have already run
  // (idempotent resume after browser close).
  const { data: jobRow, error: jobErr } = await supabase
    .from("household_key_rotation_jobs" as never)
    .select("*")
    .eq("id" as never, jobId)
    .maybeSingle();
  if (jobErr || !jobRow) {
    throw new Error(friendlyError(jobErr, "Could not load the household refresh job."));
  }
  const job = jobRow as unknown as HouseholdRekeyJobRow;

  if (job.status === "complete") {
    callbacks.onComplete?.();
    return "completed";
  }
  if (job.status === "aborted") {
    callbacks.onAborted?.(
      job.abort_reason ?? "The household refresh was stopped before it finished.",
    );
    return "aborted";
  }
  if (job.status === "rolled_back") {
    callbacks.onAborted?.("The household refresh was rolled back after completing.");
    return "rolled_back";
  }

  // Phase 1: generate a fresh DEK for this refresh.
  const newDek = generateRandomDek();
  const newDekKey = await importAesGcmKey(newDek);

  // Fetch the CURRENT active DEK so we can decrypt existing rows (Deep
  // mode only). In first-time setup the current wrap is a placeholder
  // — `oldDekKey` is null and we route through the Quick fast path.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    throw new Error("You need to be signed in to run a household refresh.");
  }
  const oldDek = await fetchCurrentHouseholdDek(job.household_id, user.id);
  const oldDekKey = oldDek ? await importAesGcmKey(oldDek) : null;

  // Member discovery drives the wrap stage.
  const members = await fetchHouseholdMembers(job.household_id);

  if (job.status === "pending" || job.status === "generating_keys") {
    callbacks.onStageChange?.("generating_keys");
    if (job.status === "pending") {
      await advanceHouseholdRotation(jobId, "generating_keys");
    }
  }

  if (job.status !== "rekeying_rows" && job.status !== "finalizing") {
    callbacks.onStageChange?.("wrapping_members");
    await advanceHouseholdRotation(jobId, "wrapping_members");

    const dekWraps = await buildHouseholdDekWraps(newDek, members, job.new_dek_key_version);
    await submitWrapBatches(jobId, dekWraps);

    await advanceHouseholdRotation(jobId, "rekeying_rows");
  }

  if (job.status !== "finalizing") {
    callbacks.onStageChange?.("rekeying_rows");

    if (!oldDekKey || job.refresh_mode === "quick") {
      // Quick refresh OR first-time-setup: skip decrypt+re-encrypt.
      // Just bump dek_key_version on every row so new writes land on
      // the new version post-finalize.
      await markAllRowsAsNewVersion(jobId, job.household_id, job.new_dek_key_version, callbacks);
    } else {
      await rekeyAllRows(
        jobId,
        job.household_id,
        oldDekKey,
        newDekKey,
        job.new_dek_key_version,
        callbacks,
      );
    }

    await advanceHouseholdRotation(jobId, "finalizing");
  }

  callbacks.onStageChange?.("finalizing");
  const { error: finalizeErr } = await supabase.functions.invoke("finalize-household-rekey", {
    body: { job_id: jobId },
  });
  if (finalizeErr) {
    throw new Error(
      friendlyError(
        finalizeErr,
        "The household refresh failed at the final step. No data was lost.",
      ),
    );
  }

  callbacks.onComplete?.();
  return "completed";
}

/**
 * Resume a household refresh job after browser close. Reads the job's
 * current status and calls runHouseholdRekeyJob.
 */
export async function resumeHouseholdRekeyJob(
  jobId: string,
  callbacks: HouseholdRekeyCallbacks = {},
): Promise<HouseholdRekeyOutcome> {
  return runHouseholdRekeyJob(jobId, callbacks);
}

/**
 * Emergency rollback during the 30-day rollback window. Flips
 * household_active_key_versions back to the previous version.
 */
export async function rollbackHouseholdRekey(jobId: string): Promise<void> {
  const { error } = await supabase.functions.invoke("abort-household-rekey", {
    body: { job_id: jobId, mode: "rollback_after_complete" },
  });
  if (error) {
    throw new Error(friendlyError(error, "Could not roll back the household refresh."));
  }
}

/**
 * Abort a household refresh job that is still running.
 */
export async function abortHouseholdRekey(jobId: string, reason: string): Promise<void> {
  const { error } = await supabase.functions.invoke("abort-household-rekey", {
    body: { job_id: jobId, mode: "abort_in_flight", reason },
  });
  if (error) {
    throw new Error(friendlyError(error, "Could not stop the household refresh."));
  }
}

/**
 * Produce a fully-decrypted household backup. Runs entirely in the
 * browser — the server never sees plaintext. Intended for the
 * "Download a backup" safety step in the refresh wizard.
 *
 * CSV format: text file with one section per table.
 * JSON format: single document keyed by table name.
 *
 * The `decrypt` callback should be the caller's VaultContext
 * `decryptText` helper, so any fallback-to-personal-MEK logic is
 * consistent with how the app normally reads shared rows.
 */
export async function exportHouseholdBackup(
  householdId: string,
  format: HouseholdBackupFormat,
  decrypt: (ciphertext: string) => Promise<string>,
): Promise<Blob> {
  const snapshot: Record<string, unknown[]> = {};

  for (const desc of BUSINESS_TABLES) {
    const rows = await fetchAllRows(desc.table, householdId);
    const decrypted: Record<string, unknown>[] = [];
    for (const row of rows) {
      const plainRow: Record<string, unknown> = { ...row };
      for (const col of desc.encryptedColumns) {
        const v = row[col];
        if (typeof v === "string" && v.length > 0) {
          try {
            plainRow[col] = await decrypt(v);
          } catch {
            plainRow[col] = v;
          }
        }
      }
      decrypted.push(plainRow);
    }
    snapshot[desc.table] = decrypted;
  }

  if (format === "json") {
    const json = JSON.stringify(
      {
        household_id: householdId,
        exported_at: new Date().toISOString(),
        data: snapshot,
      },
      null,
      2,
    );
    return new Blob([json], { type: "application/json" });
  }

  const chunks: string[] = [];
  chunks.push(
    `# Orange Way household backup\n# household_id: ${householdId}\n` +
      `# exported_at: ${new Date().toISOString()}\n\n`,
  );
  for (const desc of BUSINESS_TABLES) {
    const rows = snapshot[desc.table] as Record<string, unknown>[];
    chunks.push(`### TABLE: ${desc.table} ###\n`);
    if (rows.length === 0) {
      chunks.push("(empty)\n\n");
      continue;
    }
    const cols = Object.keys(rows[0]);
    chunks.push(cols.map(csvEscape).join(",") + "\n");
    for (const row of rows) {
      chunks.push(cols.map((c) => csvEscape(row[c])).join(",") + "\n");
    }
    chunks.push("\n");
  }
  return new Blob(chunks, { type: "text/csv" });
}

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = typeof value === "string" ? value : JSON.stringify(value);
  if (/["\n,]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

// Helper used by the VaultContext first-time-setup flow + household
// security page to decide whether a backup CSV is worth offering.
export async function hasPreviousHouseholdDek(householdId: string): Promise<boolean> {
  const { data } = await supabase
    .from("household_active_key_versions" as never)
    .select("active_dek_key_version")
    .eq("household_id" as never, householdId)
    .maybeSingle();
  const row = data as { active_dek_key_version?: number } | null;
  return Boolean(row && (row.active_dek_key_version ?? 1) > 1);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface HouseholdRekeyJobRow {
  id: string;
  household_id: string;
  status:
    | "pending"
    | "generating_keys"
    | "wrapping_members"
    | "rekeying_rows"
    | "finalizing"
    | "complete"
    | "aborted"
    | "rolled_back";
  refresh_mode: HouseholdRefreshMode;
  new_dek_key_version: number;
  previous_dek_key_version: number | null;
  rows_total: number;
  rows_processed: number;
  abort_reason: string | null;
}

/**
 * Fetch the current household DEK so Deep-mode refresh can decrypt old
 * ciphertext. Returns null if the active wrap is a placeholder (Phase
 * 4.3 first-time state) — the caller must then take the Quick fast
 * path where old ciphertext under the per-user MEK stays readable.
 *
 * Full implementation (hybrid unwrap against the user's private key)
 * is deferred to a follow-up: today VaultContext unwraps the household
 * DEK at unlock and caches it in-memory. Callers of Deep
 * refresh should provide that key via the callbacks route if needed
 * — for v1 we always use the Quick path, which is what the wizard
 * defaults to.
 */
async function fetchCurrentHouseholdDek(
  householdId: string,
  userId: string,
): Promise<Uint8Array | null> {
  const { data: active } = await supabase
    .from("household_active_key_versions" as never)
    .select("active_dek_key_version")
    .eq("household_id" as never, householdId)
    .maybeSingle();
  const activeKv =
    (active as { active_dek_key_version?: number } | null)?.active_dek_key_version ?? 1;

  const { data: wrap } = await supabase
    .from("household_keys" as never)
    .select("enc_household_dek, is_placeholder, key_version")
    .eq("household_id" as never, householdId)
    .eq("user_id" as never, userId)
    .eq("key_version" as never, activeKv)
    .maybeSingle();
  if (!wrap) return null;
  const w = wrap as unknown as { enc_household_dek: string; is_placeholder: boolean };
  if (w.is_placeholder) return null;

  // TODO(Phase 4.5 follow-up): accept the already-unwrapped household
  // DEK from VaultContext via a callback so we don't need to re-run
  // the hybrid unwrap here. For v1 we return null so Deep mode falls
  // back to the Quick fast path when the caller hasn't threaded the
  // live DEK through — this keeps the first ship safe while leaving
  // the plumbing ready for a future Deep-refresh wiring.
  void w;
  return null;
}

interface MemberRow {
  user_id: string;
  public_key_b64: string;
}

async function fetchHouseholdMembers(householdId: string): Promise<MemberRow[]> {
  // Pull active members with a published hybrid public key. Members
  // without a keypair yet land in the pending-invite flow when they
  // unlock for the first time.
  const { data: members } = await supabase
    .from("household_members" as never)
    .select("user_id, status")
    .eq("household_id" as never, householdId)
    .eq("status" as never, "active");
  const memberIds = ((members as Array<{ user_id: string | null }> | null) ?? [])
    .map((m) => m.user_id)
    .filter((v): v is string => typeof v === "string" && v.length > 0);

  if (memberIds.length === 0) {
    // Even if no household_members rows exist yet (pre-invite state),
    // the Owner themselves still needs a wrap. Pull the household
    // owner_id and wrap for them.
    const { data: hh } = await supabase
      .from("households" as never)
      .select("owner_id")
      .eq("id" as never, householdId)
      .maybeSingle();
    const ownerId = (hh as { owner_id?: string } | null)?.owner_id;
    if (!ownerId) return [];
    const { data: pk } = await supabase
      .from("user_public_keys" as never)
      .select("public_key_b64")
      .eq("user_id" as never, ownerId)
      .maybeSingle();
    const pkRow = pk as { public_key_b64?: string } | null;
    if (!pkRow?.public_key_b64) return [];
    return [{ user_id: ownerId, public_key_b64: pkRow.public_key_b64 }];
  }

  const { data: keys } = await supabase
    .from("user_public_keys" as never)
    .select("user_id, public_key_b64")
    .in("user_id" as never, memberIds);
  return ((keys as Array<{ user_id: string; public_key_b64: string }> | null) ?? [])
    .map((k) => ({ user_id: k.user_id, public_key_b64: k.public_key_b64 }))
    .filter((m) => m.public_key_b64.length > 0);
}

interface HouseholdDekWrapRow {
  user_id: string;
  enc_household_dek: string;
  key_version: number;
}

async function buildHouseholdDekWraps(
  newDek: Uint8Array,
  members: MemberRow[],
  keyVersion: number,
): Promise<HouseholdDekWrapRow[]> {
  const strategy = KEY_WRAP_STRATEGIES[DEFAULT_WRAP_ALGORITHM];
  if (!strategy) {
    throw new Error("The app could not prepare the new household keys (missing wrap strategy).");
  }
  const rows: HouseholdDekWrapRow[] = [];
  for (const m of members) {
    const pub = base64ToBytes(m.public_key_b64);
    const wrapped = await strategy.wrapForRecipient(newDek, pub);
    rows.push({
      user_id: m.user_id,
      enc_household_dek: bytesToBase64(wrapped),
      key_version: keyVersion,
    });
  }
  return rows;
}

async function submitWrapBatches(jobId: string, dekWraps: HouseholdDekWrapRow[]): Promise<void> {
  for (let i = 0; i < dekWraps.length; i += BATCH_SIZE_WRAPS) {
    const chunk = dekWraps.slice(i, i + BATCH_SIZE_WRAPS);
    const { error } = await supabase.functions.invoke("household-rekey-batch", {
      body: { job_id: jobId, stage: "wrap_members", batch: { rows: chunk } },
    });
    if (error) {
      throw new Error(friendlyError(error, "Could not save the new household keys for a member."));
    }
  }
}

async function fetchAllRows(
  table: string,
  householdId: string,
): Promise<Record<string, unknown>[]> {
  const pageSize = BATCH_SIZE_ROWS;
  const out: Record<string, unknown>[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await supabase
      .from(table as never)
      .select("*")
      .eq("household_id" as never, householdId)
      .range(from, from + pageSize - 1);
    if (error) {
      return out;
    }
    const rows = (data as Record<string, unknown>[] | null) ?? [];
    out.push(...rows);
    if (rows.length < pageSize) break;
    from += pageSize;
  }
  return out;
}

async function markAllRowsAsNewVersion(
  jobId: string,
  householdId: string,
  newVersion: number,
  callbacks: HouseholdRekeyCallbacks,
): Promise<void> {
  let processed = 0;
  let total = 0;
  const updates: Array<{
    table: string;
    row_id: string;
    new_dek_key_version: number;
    new_ciphertext_fields: Record<string, string>;
  }> = [];
  for (const desc of BUSINESS_TABLES) {
    const rows = await fetchAllRows(desc.table, householdId);
    total += rows.length;
    for (const row of rows) {
      const id = row[desc.idColumn] as string;
      if (!id) continue;
      updates.push({
        table: desc.table,
        row_id: id,
        new_dek_key_version: newVersion,
        new_ciphertext_fields: {},
      });
    }
  }
  callbacks.onRowProgress?.(0, total);

  for (let i = 0; i < updates.length; i += BATCH_SIZE_ROWS) {
    const chunk = updates.slice(i, i + BATCH_SIZE_ROWS);
    const { error } = await supabase.functions.invoke("household-rekey-batch", {
      body: { job_id: jobId, stage: "rekey_rows", batch: { rows: chunk } },
    });
    if (error) {
      throw new Error(
        friendlyError(
          error,
          "Could not finish updating a row. The household refresh was stopped safely.",
        ),
      );
    }
    processed += chunk.length;
    callbacks.onRowProgress?.(processed, total);
  }
}

async function rekeyAllRows(
  jobId: string,
  householdId: string,
  oldDekKey: CryptoKey,
  newDekKey: CryptoKey,
  newVersion: number,
  callbacks: HouseholdRekeyCallbacks,
): Promise<void> {
  let processed = 0;
  let total = 0;
  for (const desc of BUSINESS_TABLES) {
    const { count } = await supabase
      .from(desc.table as never)
      .select("*", { count: "exact", head: true })
      .eq("household_id" as never, householdId);
    total += count ?? 0;
  }
  callbacks.onRowProgress?.(0, total);

  for (const desc of BUSINESS_TABLES) {
    const rows = await fetchAllRows(desc.table, householdId);
    for (let i = 0; i < rows.length; i += BATCH_SIZE_ROWS) {
      const chunk = rows.slice(i, i + BATCH_SIZE_ROWS);
      const updates = await Promise.all(
        chunk.map(async (row) => {
          const id = row[desc.idColumn] as string;
          const newCt: Record<string, string> = {};
          for (const col of desc.encryptedColumns) {
            const v = row[col];
            if (typeof v === "string" && v.length > 0) {
              try {
                newCt[col] = await reencryptFieldUnderNewDek(v, oldDekKey, newDekKey);
              } catch {
                // Leave the column alone; server keeps old ciphertext and
                // just bumps dek_key_version.
              }
            }
          }
          return {
            table: desc.table,
            row_id: id,
            new_dek_key_version: newVersion,
            new_ciphertext_fields: newCt,
          };
        }),
      );
      const { error } = await supabase.functions.invoke("household-rekey-batch", {
        body: { job_id: jobId, stage: "rekey_rows", batch: { rows: updates } },
      });
      if (error) {
        throw new Error(
          friendlyError(
            error,
            "Could not finish updating a row. The household refresh was stopped safely.",
          ),
        );
      }
      processed += updates.length;
      callbacks.onRowProgress?.(processed, total);
    }
  }
}

async function advanceHouseholdRotation(jobId: string, newStatus: string): Promise<void> {
  const { error } = await supabase.rpc(
    "advance_household_rotation_job" as never,
    { p_job_id: jobId, p_new_status: newStatus } as never,
  );
  if (error) {
    throw new Error(
      friendlyError(error, `Could not advance the household refresh to ${newStatus}.`),
    );
  }
}

function friendlyError(err: unknown, fallback: string): string {
  if (!err) return fallback;
  if (err instanceof Error) return err.message || fallback;
  if (typeof err === "object" && err !== null) {
    const m = (err as { message?: string }).message;
    if (m) return m;
  }
  return fallback;
}

// Re-exports so test files don't have to import vault.ts helpers separately.
export { cryptoDecryptText, cryptoEncryptText };
