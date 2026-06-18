/**
 * admin-update-household-member — Supabase Edge Function (Phase 4.3 + 4.4).
 *
 * Server-side mutations for household member management.
 *
 * Actions:
 *   - soft_revoke (4.3): flip household_members.status='removed', set
 *     revoked_at, delete the member's household_keys rows, and write an
 *     audit event.
 *   - extend_role_expiry (4.4): bump expires_at on a time-boxed
 *     household_members row (auditor or support).
 *   - grant_support_session (4.4): create a 1/6/12/24h customer
 *     support session and the matching household_members 'support' row.
 *   - end_support_session (4.4): end an active support session early;
 *     revokes the support member row.
 *
 * Authorization:
 *   - soft_revoke / extend_role_expiry / grant_support_session: caller
 *     must be the household Owner.
 *   - end_support_session: caller is either the household Owner OR the
 *     support user on the targeted session.
 *
 * Request body:
 *   {
 *     "household_id":   "<uuid>",
 *     "target_user_id"?: "<uuid>",       // required for soft_revoke
 *     "action":         "soft_revoke" | "extend_role_expiry"
 *                       | "grant_support_session" | "end_support_session",
 *     "payload"?: {
 *       "member_id"?: string,             // extend_role_expiry
 *       "new_expires_at"?: string,        // extend_role_expiry (ISO)
 *       "support_email"?: string,         // grant_support_session
 *       "duration_hours"?: 1 | 6 | 12 | 24, // grant_support_session
 *       "session_id"?: string             // end_support_session
 *     }
 *   }
 *
 * Responses:
 *   - soft_revoke           → { ok: true, revoked: true }
 *   - extend_role_expiry    → { ok: true, new_expires_at }
 *   - grant_support_session → { ok: true, session_id, expires_at, support_user_id }
 *   - end_support_session   → { ok: true, ended: true }
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
const EMAIL_RE = /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$/;

type Action =
  | "soft_revoke"
  | "extend_role_expiry"
  | "grant_support_session"
  | "end_support_session";
const VALID_ACTIONS: readonly Action[] = [
  "soft_revoke",
  "extend_role_expiry",
  "grant_support_session",
  "end_support_session",
] as const;

// Actions where the caller can legitimately not be the Owner (the
// support user themselves can end their own session).
const NON_OWNER_FALLBACK_ACTIONS: ReadonlySet<Action> = new Set(["end_support_session"]);

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
      target_user_id?: unknown;
      action?: unknown;
      payload?: {
        member_id?: unknown;
        new_expires_at?: unknown;
        support_email?: unknown;
        duration_hours?: unknown;
        session_id?: unknown;
      };
    };
    try {
      body = JSON.parse(raw || "{}");
    } catch {
      return jsonResponse({ error: "Invalid JSON" }, 400, cors);
    }

    const householdId = typeof body.household_id === "string" ? body.household_id.trim() : "";
    const targetUserId = typeof body.target_user_id === "string" ? body.target_user_id.trim() : "";
    const action = typeof body.action === "string" ? (body.action as Action) : null;
    const payloadMemberId =
      typeof body.payload?.member_id === "string" ? body.payload.member_id.trim() : undefined;
    const payloadNewExpiresAt =
      typeof body.payload?.new_expires_at === "string"
        ? body.payload.new_expires_at.trim()
        : undefined;
    const payloadSupportEmail =
      typeof body.payload?.support_email === "string"
        ? body.payload.support_email.trim()
        : undefined;
    const payloadDurationHours =
      typeof body.payload?.duration_hours === "number" ? body.payload.duration_hours : undefined;
    const payloadSessionId =
      typeof body.payload?.session_id === "string" ? body.payload.session_id.trim() : undefined;

    if (!householdId || !UUID_RE.test(householdId)) {
      return jsonResponse({ error: "household_id must be a UUID" }, 400, cors);
    }
    if (!action || !VALID_ACTIONS.includes(action)) {
      return jsonResponse({ error: "Unknown action" }, 400, cors);
    }
    if (action === "soft_revoke") {
      if (!targetUserId || !UUID_RE.test(targetUserId)) {
        return jsonResponse({ error: "target_user_id must be a UUID" }, 400, cors);
      }
    }

    // Owner check (with fallback for end_support_session).
    const { data: hh, error: hhErr } = await adminClient
      .from("households")
      .select("id, owner_id")
      .eq("id", householdId)
      .maybeSingle();
    if (hhErr) {
      console.error("admin-update-household-member households lookup failed:", hhErr);
      return jsonResponse({ error: "Failed to load household" }, 500, cors);
    }
    if (!hh) {
      return jsonResponse({ error: "Household not found" }, 404, cors);
    }
    const isOwner = (hh as { owner_id: string }).owner_id === caller.id;
    if (!isOwner && !NON_OWNER_FALLBACK_ACTIONS.has(action)) {
      return jsonResponse(
        { error: "You don't have permission to manage this household." },
        403,
        cors,
      );
    }

    if (action === "soft_revoke") {
      if (caller.id === targetUserId) {
        return jsonResponse(
          { error: "You can't remove yourself from your own household." },
          400,
          cors,
        );
      }

      const nowIso = new Date().toISOString();
      const { data: memberRow, error: memberErr } = await adminClient
        .from("household_members")
        .update({
          status: "removed",
          revoked_at: nowIso,
        })
        .eq("household_id", householdId)
        .eq("user_id", targetUserId)
        .select("id")
        .maybeSingle();
      if (memberErr) {
        const { error: fallbackErr } = await adminClient
          .from("household_members")
          .update({ status: "removed" })
          .eq("household_id", householdId)
          .eq("user_id", targetUserId);
        if (fallbackErr) {
          console.error(
            "admin-update-household-member household_members update failed:",
            memberErr,
            fallbackErr,
          );
          return jsonResponse({ error: "Failed to remove member" }, 500, cors);
        }
      }
      void memberRow;

      const { error: keyDelErr } = await adminClient
        .from("household_keys")
        .delete()
        .eq("household_id", householdId)
        .eq("user_id", targetUserId);
      if (keyDelErr) {
        console.error("admin-update-household-member household_keys delete failed:", keyDelErr);
      }

      await adminClient
        .from("household_invites")
        .update({ status: "revoked", revoked_at: nowIso })
        .eq("household_id", householdId)
        .eq("recipient_user_id", targetUserId)
        .in("status", ["awaiting_recipient", "ready_to_wrap"]);

      try {
        await adminClient.from("vault_security_events").insert({
          user_id: targetUserId,
          event: "household_member.revoked",
          metadata: {
            actor_user_id: caller.id,
            target_user_id: targetUserId,
            household_id: householdId,
            hard_rekey: false,
          },
        });
      } catch (err) {
        console.warn("admin-update-household-member audit insert threw:", err);
      }

      return jsonResponse({ ok: true, revoked: true }, 200, cors);
    }

    if (action === "extend_role_expiry") {
      // Extend an auditor (or support) member's expires_at, within
      // (now, now+1y] for auditor. Support sessions are capped at 24h
      // by the support_sessions CHECK constraint — extending a 'support'
      // member here past that cap will be refused below by checking the
      // household_members.source field.
      if (!payloadMemberId || !UUID_RE.test(payloadMemberId)) {
        return jsonResponse({ error: "member_id is required" }, 400, cors);
      }
      if (!payloadNewExpiresAt) {
        return jsonResponse({ error: "new_expires_at is required" }, 400, cors);
      }
      const parsed = Date.parse(payloadNewExpiresAt);
      if (Number.isNaN(parsed)) {
        return jsonResponse({ error: "new_expires_at could not be parsed" }, 400, cors);
      }
      const now = Date.now();
      const oneYear = 365 * 24 * 60 * 60 * 1000;
      if (parsed <= now) {
        return jsonResponse({ error: "new_expires_at must be in the future" }, 400, cors);
      }
      if (parsed > now + oneYear) {
        return jsonResponse(
          { error: "new_expires_at must be at most 1 year from today" },
          400,
          cors,
        );
      }
      const newIso = new Date(parsed).toISOString();

      const { data: member, error: memberReadErr } = await adminClient
        .from("household_members")
        .select("id, household_id, user_id, role, source, expires_at, revoked_at")
        .eq("id", payloadMemberId)
        .maybeSingle();
      if (memberReadErr) {
        console.error("admin-update-household-member extend read failed:", memberReadErr);
        return jsonResponse({ error: "Failed to load member" }, 500, cors);
      }
      const m = member as {
        id: string;
        household_id: string;
        user_id: string;
        role: string;
        source: string;
        expires_at: string | null;
        revoked_at: string | null;
      } | null;
      if (!m || m.household_id !== householdId) {
        return jsonResponse({ error: "Member not found in this household" }, 404, cors);
      }
      if (m.revoked_at) {
        return jsonResponse({ error: "This member has already been revoked." }, 409, cors);
      }
      if (m.source === "support_grant" && parsed > now + 24 * 60 * 60 * 1000) {
        return jsonResponse(
          { error: "Support sessions cannot be extended beyond 24 hours." },
          400,
          cors,
        );
      }

      const { error: updErr } = await adminClient
        .from("household_members")
        .update({ expires_at: newIso })
        .eq("id", payloadMemberId);
      if (updErr) {
        console.error("admin-update-household-member extend update failed:", updErr);
        return jsonResponse({ error: "Failed to update expiry" }, 500, cors);
      }

      try {
        await adminClient.from("vault_security_events").insert({
          user_id: m.user_id,
          event: "role.expiry_extended",
          metadata: {
            actor_user_id: caller.id,
            target_user_id: m.user_id,
            household_id: householdId,
            member_id: payloadMemberId,
            old_expires_at: m.expires_at,
            new_expires_at: newIso,
            source: m.source,
          },
        });
      } catch (err) {
        console.warn("admin-update-household-member extend audit threw:", err);
      }

      return jsonResponse({ ok: true, new_expires_at: newIso }, 200, cors);
    }

    if (action === "grant_support_session") {
      if (!payloadSupportEmail || !EMAIL_RE.test(payloadSupportEmail)) {
        return jsonResponse({ error: "A valid support_email is required" }, 400, cors);
      }
      const VALID_DURATIONS = new Set([1, 6, 12, 24]);
      if (!payloadDurationHours || !VALID_DURATIONS.has(payloadDurationHours)) {
        return jsonResponse({ error: "duration_hours must be 1, 6, 12, or 24" }, 400, cors);
      }
      const supportEmail = payloadSupportEmail.toLowerCase();

      // Look up or invite the support user via the indexed RPC.
      // See public.find_user_id_by_email migration 20260530030000.
      let supportUserId: string | null = null;
      {
        const { data: foundId, error: lookupErr } = await adminClient.rpc("find_user_id_by_email", {
          p_email: supportEmail,
        });
        if (lookupErr) {
          console.error("admin-update-household-member find_user_id_by_email failed:", lookupErr);
        } else if (foundId) {
          supportUserId = foundId as string;
        }
      }
      if (!supportUserId) {
        const { data: invited, error: inviteErr } =
          await adminClient.auth.admin.inviteUserByEmail(supportEmail);
        if (inviteErr || !invited?.user) {
          console.error("admin-update-household-member support invite failed:", inviteErr);
          return jsonResponse({ error: "Failed to invite support user" }, 500, cors);
        }
        supportUserId = invited.user.id;
      }

      const grantedAt = new Date();
      const expiresAt = new Date(grantedAt.getTime() + payloadDurationHours * 60 * 60 * 1000);
      const grantedAtIso = grantedAt.toISOString();
      const expiresAtIso = expiresAt.toISOString();

      // support_sessions row (audit anchor + 24h CHECK).
      const { data: sessionRow, error: sessionErr } = await adminClient
        .from("support_sessions")
        .insert({
          household_id: householdId,
          support_user_id: supportUserId,
          granted_by: caller.id,
          granted_at: grantedAtIso,
          expires_at: expiresAtIso,
        })
        .select("id")
        .single();
      if (sessionErr || !sessionRow) {
        console.error("admin-update-household-member session insert failed:", sessionErr);
        return jsonResponse({ error: "Failed to record support session" }, 500, cors);
      }

      // household_members upsert with role='support' and source='support_grant'.
      // Idempotent on (household_id, user_id).
      const { error: memberErr } = await adminClient.from("household_members").upsert(
        {
          household_id: householdId,
          user_id: supportUserId,
          role: "support",
          status: "active",
          joined_at: grantedAtIso,
          expires_at: expiresAtIso,
          source: "support_grant",
          revoked_at: null,
        },
        { onConflict: "household_id,user_id" },
      );
      if (memberErr) {
        console.error("admin-update-household-member support member upsert failed:", memberErr);
        await adminClient
          .from("support_sessions")
          .delete()
          .eq("id", (sessionRow as { id: string }).id);
        return jsonResponse({ error: "Failed to activate support role" }, 500, cors);
      }

      try {
        await adminClient.from("vault_security_events").insert({
          user_id: supportUserId,
          event: "support.session_granted",
          metadata: {
            actor_user_id: caller.id,
            target_user_id: supportUserId,
            household_id: householdId,
            session_id: (sessionRow as { id: string }).id,
            duration_hours: payloadDurationHours,
            expires_at: expiresAtIso,
          },
        });
      } catch (err) {
        console.warn("admin-update-household-member support grant audit threw:", err);
      }

      return jsonResponse(
        {
          ok: true,
          session_id: (sessionRow as { id: string }).id,
          expires_at: expiresAtIso,
          support_user_id: supportUserId,
        },
        200,
        cors,
      );
    }

    if (action === "end_support_session") {
      if (!payloadSessionId || !UUID_RE.test(payloadSessionId)) {
        return jsonResponse({ error: "session_id is required" }, 400, cors);
      }

      const { data: session, error: sessionReadErr } = await adminClient
        .from("support_sessions")
        .select("id, household_id, support_user_id, granted_by, ended_at")
        .eq("id", payloadSessionId)
        .maybeSingle();
      if (sessionReadErr) {
        console.error("admin-update-household-member end session read failed:", sessionReadErr);
        return jsonResponse({ error: "Failed to load support session" }, 500, cors);
      }
      const s = session as {
        id: string;
        household_id: string;
        support_user_id: string;
        granted_by: string;
        ended_at: string | null;
      } | null;
      if (!s || s.household_id !== householdId) {
        return jsonResponse({ error: "Support session not found in this household" }, 404, cors);
      }
      if (s.ended_at) {
        return jsonResponse({ error: "Support session is already ended." }, 409, cors);
      }

      const isSupportUser = caller.id === s.support_user_id;
      if (!isOwner && !isSupportUser) {
        return jsonResponse(
          { error: "You don't have permission to end this support session." },
          403,
          cors,
        );
      }
      const endReason = isSupportUser ? "support_ended" : "customer_ended";
      const endedAt = new Date().toISOString();

      const { error: sessionUpdErr } = await adminClient
        .from("support_sessions")
        .update({ ended_at: endedAt, end_reason: endReason })
        .eq("id", s.id);
      if (sessionUpdErr) {
        console.error("admin-update-household-member end session update failed:", sessionUpdErr);
        return jsonResponse({ error: "Failed to end support session" }, 500, cors);
      }

      // Revoke the support member row + drop their household_keys.
      const { error: revokeErr } = await adminClient
        .from("household_members")
        .update({ status: "removed", revoked_at: endedAt })
        .eq("household_id", householdId)
        .eq("user_id", s.support_user_id)
        .eq("source", "support_grant")
        .is("revoked_at", null);
      if (revokeErr) {
        console.error("admin-update-household-member end session revoke failed:", revokeErr);
        return jsonResponse({ error: "Failed to revoke support role" }, 500, cors);
      }
      await adminClient
        .from("household_keys")
        .delete()
        .eq("household_id", householdId)
        .eq("user_id", s.support_user_id);

      try {
        await adminClient.from("vault_security_events").insert({
          user_id: s.support_user_id,
          event: "support.session_ended",
          metadata: {
            actor_user_id: caller.id,
            target_user_id: s.support_user_id,
            household_id: householdId,
            session_id: s.id,
            end_reason: endReason,
            ended_at: endedAt,
          },
        });
      } catch (err) {
        console.warn("admin-update-household-member end audit threw:", err);
      }

      return jsonResponse({ ok: true, ended: true }, 200, cors);
    }

    return jsonResponse({ error: "Unknown action" }, 400, cors);
  } catch (err) {
    console.error("admin-update-household-member error:", err);
    return jsonResponse({ error: "Internal error" }, 500, cors);
  }
});
