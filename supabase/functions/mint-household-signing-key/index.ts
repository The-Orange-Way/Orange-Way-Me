/**
 * mint-household-signing-key — Supabase Edge Function (Phase 4.4).
 *
 * Accepts a client-generated ML-DSA-65 Household Signing Key (HSK) and
 * its per-writer wraps, and records both on the server:
 *
 *   - Insert one `household_signing_keys` row (household_id, key_version,
 *     public_key_b64, algorithm, created_by = caller).
 *   - Insert one `household_member_osk_wraps` row per entry in wraps[],
 *     keyed on (user_id, household_id, key_version).
 *   - Write a vault_security_events row for `household.signing_key_minted`.
 *
 * The keypair itself is generated client-side. This function NEVER sees
 * the private half — only the per-recipient hybrid-KEM wraps — and
 * NEVER accepts a raw secret from the caller.
 *
 * Authorization: caller must be the household Owner (households.owner_id).
 *
 * Request body (JSON):
 *   {
 *     "household_id":   "<uuid>",
 *     "public_key_b64": "<base64>",  // ML-DSA-65 public key
 *     "key_version":    1,
 *     "algorithm"?:     "ml-dsa-65",
 *     "wraps": [
 *       { "user_id": "<uuid>", "wrapped_private_key": "<base64>",
 *         "iv": "<base64>", "wrap_algo": "hybrid_x25519_mlkem768",
 *         "key_version": 1 }
 *     ]
 *   }
 *
 * Response (200):
 *   { ok: true, household_id, key_version, wrap_count }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildCorsHeaders, jsonResponse, readBoundedText } from "../_shared/http.ts";
import { validateRecipients } from "./validate-recipients.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BASE64_RE = /^[A-Za-z0-9+/=]+$/;

const MAX_WRAPS_PER_MINT = 200;

interface OskWrapInput {
  user_id: string;
  wrapped_private_key: string;
  iv: string;
  wrap_algo: string;
  key_version: number;
}

function isValidWrap(v: unknown): v is OskWrapInput {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.user_id === "string" &&
    UUID_RE.test(o.user_id) &&
    typeof o.wrapped_private_key === "string" &&
    o.wrapped_private_key.length > 0 &&
    o.wrapped_private_key.length < 16384 &&
    BASE64_RE.test(o.wrapped_private_key) &&
    typeof o.iv === "string" &&
    o.iv.length > 0 &&
    o.iv.length < 64 &&
    BASE64_RE.test(o.iv) &&
    typeof o.wrap_algo === "string" &&
    o.wrap_algo.length < 64 &&
    typeof o.key_version === "number" &&
    Number.isInteger(o.key_version) &&
    o.key_version > 0
  );
}

serve(async (req) => {
  const cors = buildCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
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
    let body: {
      household_id?: unknown;
      public_key_b64?: unknown;
      key_version?: unknown;
      algorithm?: unknown;
      wraps?: unknown;
    };
    try {
      body = JSON.parse(raw || "{}");
    } catch {
      return jsonResponse({ error: "Invalid JSON" }, 400, cors);
    }

    const householdId = typeof body.household_id === "string" ? body.household_id.trim() : "";
    if (!householdId || !UUID_RE.test(householdId)) {
      return jsonResponse({ error: "household_id is required" }, 400, cors);
    }

    const publicKeyB64 = typeof body.public_key_b64 === "string" ? body.public_key_b64 : "";
    if (!publicKeyB64 || !BASE64_RE.test(publicKeyB64) || publicKeyB64.length < 100) {
      return jsonResponse(
        { error: "public_key_b64 must be a base64 ML-DSA-65 public key" },
        400,
        cors,
      );
    }

    const keyVersion = typeof body.key_version === "number" ? body.key_version : 1;
    if (!Number.isInteger(keyVersion) || keyVersion < 1) {
      return jsonResponse({ error: "key_version must be a positive integer" }, 400, cors);
    }

    const algorithm =
      typeof body.algorithm === "string" && body.algorithm.length > 0
        ? body.algorithm
        : "ml-dsa-65";

    if (!Array.isArray(body.wraps)) {
      return jsonResponse({ error: "wraps must be an array" }, 400, cors);
    }
    if (body.wraps.length === 0) {
      return jsonResponse({ error: "wraps must contain at least one entry" }, 400, cors);
    }
    if (body.wraps.length > MAX_WRAPS_PER_MINT) {
      return jsonResponse({ error: `Too many wraps (max ${MAX_WRAPS_PER_MINT})` }, 400, cors);
    }
    const wraps: OskWrapInput[] = [];
    for (let i = 0; i < body.wraps.length; i++) {
      if (!isValidWrap(body.wraps[i])) {
        return jsonResponse({ error: `wraps[${i}] failed validation` }, 400, cors);
      }
      const w = body.wraps[i] as OskWrapInput;
      if (w.key_version !== keyVersion) {
        return jsonResponse(
          {
            error: `wraps[${i}].key_version must match the top-level key_version (${keyVersion})`,
          },
          400,
          cors,
        );
      }
      wraps.push(w);
    }

    // Owner-only.
    const { data: hh, error: hhErr } = await adminClient
      .from("households")
      .select("id, owner_id")
      .eq("id", householdId)
      .maybeSingle();
    if (hhErr) {
      console.error("mint-household-signing-key households lookup failed:", hhErr);
      return jsonResponse({ error: "Failed to load household" }, 500, cors);
    }
    if (!hh || (hh as { owner_id: string }).owner_id !== caller.id) {
      return jsonResponse(
        { error: "You don't have permission to mint the Household Signing Key." },
        403,
        cors,
      );
    }

    // Cross-check every wraps[i].user_id against the household's active
    // member set BEFORE inserting any wrap rows.
    // Without this check, a compromised owner script could plant a wrap
    // row for an outside user_id, which would then satisfy the
    // `household_member_osk_wraps_select_own` RLS policy and hand the
    // wrapped HSK private key to a non-member.
    //
    // ZKA: this lookup pulls UUIDs only — no encrypted columns are
    // selected, and the error response echoes UUIDs only (no PII).
    const { data: memberRows, error: memberErr } = await adminClient
      .from("household_members")
      .select("user_id")
      .eq("household_id", householdId)
      .eq("status", "active");
    if (memberErr) {
      console.error("mint-household-signing-key members lookup failed:", memberErr);
      return jsonResponse({ error: "Failed to load household members" }, 500, cors);
    }
    const activeMemberIds = (memberRows ?? [])
      .map((r) => (r as { user_id: string | null }).user_id)
      .filter((u): u is string => typeof u === "string" && u.length > 0);
    const recipientCheck = validateRecipients(
      wraps.map((w) => w.user_id),
      activeMemberIds,
    );
    if (!recipientCheck.ok) {
      return jsonResponse({ error: recipientCheck.error }, recipientCheck.status, cors);
    }

    // Reject if a row already exists at this key_version.
    const { data: existingKey } = await adminClient
      .from("household_signing_keys")
      .select("key_version")
      .eq("household_id", householdId)
      .eq("key_version", keyVersion)
      .maybeSingle();
    if (existingKey) {
      return jsonResponse(
        {
          error: `A Household Signing Key already exists at key_version ${keyVersion}. Use a new version to rotate.`,
        },
        409,
        cors,
      );
    }

    const { error: keyInsertErr } = await adminClient.from("household_signing_keys").insert({
      household_id: householdId,
      key_version: keyVersion,
      public_key_b64: publicKeyB64,
      algorithm,
      created_by: caller.id,
    });
    if (keyInsertErr) {
      console.error("mint-household-signing-key insert public key failed:", keyInsertErr);
      return jsonResponse({ error: "Failed to record signing key" }, 500, cors);
    }

    const wrapRows = wraps.map((w) => ({
      user_id: w.user_id,
      household_id: householdId,
      key_version: w.key_version,
      wrapped_private_key: w.wrapped_private_key,
      wrap_algo: w.wrap_algo,
      iv: w.iv,
    }));

    const { error: wrapInsertErr } = await adminClient
      .from("household_member_osk_wraps")
      .upsert(wrapRows, { onConflict: "user_id,household_id,key_version" });
    if (wrapInsertErr) {
      console.error("mint-household-signing-key insert wraps failed:", wrapInsertErr);
      await adminClient
        .from("household_signing_keys")
        .delete()
        .eq("household_id", householdId)
        .eq("key_version", keyVersion);
      return jsonResponse({ error: "Failed to record wrapped signing keys" }, 500, cors);
    }

    try {
      await adminClient.from("vault_security_events").insert({
        user_id: caller.id,
        event: "household.signing_key_minted",
        metadata: {
          household_id: householdId,
          key_version: keyVersion,
          algorithm,
          wrap_count: wraps.length,
        },
      });
    } catch (err) {
      console.warn("mint-household-signing-key audit insert threw:", err);
    }

    return jsonResponse(
      {
        ok: true,
        household_id: householdId,
        key_version: keyVersion,
        wrap_count: wraps.length,
      },
      200,
      cors,
    );
  } catch (err) {
    console.error("mint-household-signing-key error:", err);
    return jsonResponse({ error: "Internal error" }, 500, cors);
  }
});
