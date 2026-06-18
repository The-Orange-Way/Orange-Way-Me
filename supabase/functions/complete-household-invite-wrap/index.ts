/**
 * complete-household-invite-wrap — Supabase Edge Function (Phase 4.3).
 *
 * Second-stage handler for the pending household invite pipeline. When
 * the recipient publishes their first user_public_keys row, the
 * link_pending_household_invites trigger flips the matching invite to
 * status='ready_to_wrap'. The Owner's client (subscribed via realtime)
 * produces the hybrid-KEM wrap and calls this function to commit.
 *
 *   1. household_keys row UPSERT
 *   2. household_members row UPSERT (status=active)
 *   3. household_invites.status = 'wrapped'
 *   4. vault_security_events ('household_member.wrap_completed')
 *
 * Authorization: caller must be the household Owner.
 *
 * Request body:
 *   {
 *     "invite_id":   "<uuid>",
 *     "wrapped_dek": {
 *       "enc_household_dek": "<base64>",
 *       "wrap_algo":         "hybrid_x25519_mlkem768"
 *     }
 *   }
 *
 * Response (200):
 *   { ok: true, household_id, recipient_user_id }
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

const ALLOWED_WRAP_ALGOS = new Set<string>(["hybrid_x25519_mlkem768"]);

interface WrappedDekPayload {
  enc_household_dek: string;
  wrap_algo: string;
}

function isValidWrapPayload(v: unknown): v is WrappedDekPayload {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.enc_household_dek === "string" &&
    o.enc_household_dek.length > 0 &&
    o.enc_household_dek.length < 8192 &&
    BASE64_RE.test(o.enc_household_dek) &&
    typeof o.wrap_algo === "string" &&
    ALLOWED_WRAP_ALGOS.has(o.wrap_algo)
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
    let body: { invite_id?: unknown; wrapped_dek?: unknown };
    try {
      body = JSON.parse(raw || "{}");
    } catch {
      return jsonResponse({ error: "Invalid JSON" }, 400, cors);
    }
    const inviteId = typeof body.invite_id === "string" ? body.invite_id.trim() : "";
    if (!inviteId || !UUID_RE.test(inviteId)) {
      return jsonResponse({ error: "invite_id must be a UUID" }, 400, cors);
    }
    if (!isValidWrapPayload(body.wrapped_dek)) {
      return jsonResponse({ error: "Invalid wrapped_dek payload" }, 400, cors);
    }
    const wrapPayload: WrappedDekPayload = body.wrapped_dek;

    const { data: invite, error: inviteErr } = await adminClient
      .from("household_invites")
      .select("id, household_id, email, recipient_user_id, role, status, expires_at")
      .eq("id", inviteId)
      .maybeSingle();
    if (inviteErr) {
      console.error("complete-household-invite-wrap fetch failed:", inviteErr);
      return jsonResponse({ error: "Failed to load invite" }, 500, cors);
    }
    if (!invite) {
      return jsonResponse({ error: "Invite not found" }, 404, cors);
    }
    const inv = invite as {
      id: string;
      household_id: string;
      email: string | null;
      recipient_user_id: string | null;
      role: string;
      status: string;
      expires_at: string;
    };
    if (inv.status !== "ready_to_wrap") {
      return jsonResponse(
        { error: `Invite is in state '${inv.status}' — expected ready_to_wrap` },
        409,
        cors,
      );
    }
    if (new Date(inv.expires_at).getTime() < Date.now()) {
      await adminClient.from("household_invites").update({ status: "expired" }).eq("id", inv.id);
      return jsonResponse({ error: "Invite has expired" }, 410, cors);
    }
    if (!inv.recipient_user_id) {
      return jsonResponse(
        {
          error: "Invite has no recipient_user_id — trigger may have lost the link",
        },
        500,
        cors,
      );
    }

    // Owner-only: caller must be the household's owner.
    const { data: hh, error: hhErr } = await adminClient
      .from("households")
      .select("id, owner_id")
      .eq("id", inv.household_id)
      .maybeSingle();
    if (hhErr) {
      console.error("complete-household-invite-wrap households lookup failed:", hhErr);
      return jsonResponse({ error: "Failed to load household" }, 500, cors);
    }
    if (!hh || (hh as { owner_id: string }).owner_id !== caller.id) {
      return jsonResponse(
        { error: "You don't have permission to complete this invite." },
        403,
        cors,
      );
    }

    const targetUserId = inv.recipient_user_id;
    const householdId = inv.household_id;

    // Phase 4.5: detect active key version + placeholder status.
    const { data: active } = await adminClient
      .from("household_active_key_versions")
      .select("active_dek_key_version")
      .eq("household_id", householdId)
      .maybeSingle();
    const activeKv =
      (active as { active_dek_key_version?: number } | null)?.active_dek_key_version ?? 1;
    const { data: realProbe } = await adminClient
      .from("household_keys")
      .select("id")
      .eq("household_id", householdId)
      .eq("key_version", activeKv)
      .eq("is_placeholder", false)
      .limit(1)
      .maybeSingle();
    const isPlaceholder = realProbe ? false : true;

    // 1) household_keys upsert.
    const { error: keyErr } = await adminClient.from("household_keys").upsert(
      {
        household_id: householdId,
        user_id: targetUserId,
        enc_household_dek: wrapPayload.enc_household_dek,
        wrap_algo: wrapPayload.wrap_algo,
        key_version: activeKv,
        is_placeholder: isPlaceholder,
        wrapped_by: caller.id,
      },
      { onConflict: "household_id,user_id,key_version" },
    );
    if (keyErr) {
      console.error("complete-household-invite-wrap household_keys upsert failed:", keyErr);
      return jsonResponse({ error: "Failed to record household key" }, 500, cors);
    }

    // 2) household_members upsert.
    const { error: memberErr } = await adminClient.from("household_members").upsert(
      {
        household_id: householdId,
        user_id: targetUserId,
        role: inv.role,
        status: "active",
        joined_at: new Date().toISOString(),
      },
      { onConflict: "household_id,user_id" },
    );
    if (memberErr) {
      console.error("complete-household-invite-wrap household_members upsert failed:", memberErr);
      return jsonResponse({ error: "Failed to add member" }, 500, cors);
    }

    // 3) Flip invite to wrapped.
    const { error: statusErr } = await adminClient
      .from("household_invites")
      .update({
        status: "wrapped",
        wrapped_at: new Date().toISOString(),
      })
      .eq("id", inv.id);
    if (statusErr) {
      console.warn("complete-household-invite-wrap status update failed:", statusErr);
    }

    // 4) Audit.
    try {
      await adminClient.from("vault_security_events").insert({
        user_id: targetUserId,
        event: "household_member.wrap_completed",
        metadata: {
          actor_user_id: caller.id,
          target_user_id: targetUserId,
          household_id: householdId,
          role: inv.role,
          wrap_algo: wrapPayload.wrap_algo,
          invite_id: inv.id,
        },
      });
    } catch (err) {
      console.warn("complete-household-invite-wrap audit insert threw:", err);
    }

    return jsonResponse(
      {
        ok: true,
        household_id: householdId,
        recipient_user_id: targetUserId,
      },
      200,
      cors,
    );
  } catch (err) {
    console.error("complete-household-invite-wrap error:", err);
    return jsonResponse({ error: "Internal error" }, 500, cors);
  }
});
