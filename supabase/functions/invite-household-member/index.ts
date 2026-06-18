/**
 * invite-household-member — Supabase Edge Function (Phase 4.3).
 *
 * Email-based household invite with hybrid-KEM wrap routing.
 *
 * Routes to one of two paths:
 *   (a) Wrap-present: client hands in a wrapped household DEK because
 *       the recipient already published a keypair. We insert the
 *       household_keys row, the household_members row, and flip the
 *       invite to status='wrapped' in one go.
 *   (b) Wrap-pending: no wrap yet (recipient has no keypair). We
 *       inviteUserByEmail to create the auth user, record an
 *       household_invites row in status='awaiting_recipient', and let
 *       the on-keypair-insert trigger flip it to ready_to_wrap when
 *       the recipient finishes setup.
 *
 * Authorization: caller must be the household Owner
 * (households.owner_id match).
 *
 * Request body:
 *   {
 *     "household_id": "<uuid>",
 *     "email":        "person@example.com",
 *     "role":         "owner" | "partner" | "advisor" | "dependent" | "auditor",
 *     "expires_at"?: "<ISO string>",        // Phase 4.4 — Auditor only
 *     "source"?:     "direct" | "auditor_invite",  // default "direct"
 *     "wrapped_dek"?: {
 *       "enc_household_dek": "<base64>",
 *       "wrap_algo":         "hybrid_x25519_mlkem768"
 *     },
 *     "enc_email"?:   "<base64-aes-gcm>"   // for household_members display
 *   }
 *
 *   Phase 4.4 rules (Auditor time-box):
 *     - When role = "auditor", expires_at MUST be supplied, in the future,
 *       and at most 1 year from now.
 *     - For every other role, expires_at is ignored (stored as NULL).
 *     - source is auto-normalized to "auditor_invite" for the auditor
 *       role; "support_grant" never comes through this function (use
 *       admin-update-household-member grant_support_session instead).
 *
 * Response (200):
 *   { ok, household_id, recipient_user_id, wrap_status, message }
 *   wrap_status is one of: 'wrapped' | 'pending'
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  buildCorsHeaders,
  getAllowedOriginsFromEnv,
  isOriginAllowed,
  jsonResponse,
  readBoundedText,
} from "../_shared/http.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$/;
const BASE64_RE = /^[A-Za-z0-9+/=]+$/;

const ALLOWED_WRAP_ALGOS = new Set<string>(["hybrid_x25519_mlkem768"]);
// Phase 4.4: 'auditor' is invite-time-boxable. 'support' is reserved
// for grant_support_session in admin-update-household-member and is rejected
// here.
const ALLOWED_ROLES = new Set<string>(["owner", "partner", "advisor", "dependent", "auditor"]);

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
    let body: {
      household_id?: unknown;
      email?: unknown;
      role?: unknown;
      expires_at?: unknown;
      source?: unknown;
      wrapped_dek?: unknown;
      enc_email?: unknown;
    };
    try {
      body = JSON.parse(raw || "{}");
    } catch {
      return jsonResponse({ error: "Invalid JSON" }, 400, cors);
    }

    const householdId = typeof body.household_id === "string" ? body.household_id.trim() : "";
    const email = typeof body.email === "string" ? body.email.trim() : "";
    const role = typeof body.role === "string" ? body.role.trim() : "";
    const encEmail = typeof body.enc_email === "string" ? body.enc_email : null;

    if (!householdId || !UUID_RE.test(householdId)) {
      return jsonResponse({ error: "household_id must be a UUID" }, 400, cors);
    }
    if (!email || !EMAIL_RE.test(email)) {
      return jsonResponse({ error: "A valid email address is required" }, 400, cors);
    }
    if (!role || !ALLOWED_ROLES.has(role)) {
      return jsonResponse(
        { error: "role must be owner, partner, advisor, dependent, or auditor" },
        400,
        cors,
      );
    }

    // Phase 4.4: parse + validate expires_at (ISO string, future,
    // <= 1 year). Only meaningful for the auditor role.
    let expiresAtIso: string | null = null;
    if (body.expires_at !== undefined && body.expires_at !== null && body.expires_at !== "") {
      if (typeof body.expires_at !== "string") {
        return jsonResponse({ error: "expires_at must be an ISO string" }, 400, cors);
      }
      const parsed = Date.parse(body.expires_at);
      if (Number.isNaN(parsed)) {
        return jsonResponse({ error: "expires_at could not be parsed as a date" }, 400, cors);
      }
      const now = Date.now();
      const oneYear = 365 * 24 * 60 * 60 * 1000;
      if (parsed <= now) {
        return jsonResponse({ error: "expires_at must be in the future" }, 400, cors);
      }
      if (parsed > now + oneYear) {
        return jsonResponse({ error: "expires_at must be at most 1 year from today" }, 400, cors);
      }
      expiresAtIso = new Date(parsed).toISOString();
    }

    let source: "direct" | "auditor_invite" = "direct";
    if (body.source !== undefined && body.source !== null) {
      if (body.source === "direct" || body.source === "auditor_invite") {
        source = body.source;
      } else {
        return jsonResponse({ error: 'source must be "direct" or "auditor_invite"' }, 400, cors);
      }
    }

    if (role === "auditor") {
      if (!expiresAtIso) {
        return jsonResponse({ error: "Auditor access requires an expiry date." }, 400, cors);
      }
      source = "auditor_invite";
    } else {
      expiresAtIso = null;
      if (source === "auditor_invite") {
        return jsonResponse(
          { error: 'source="auditor_invite" is only valid for the auditor role.' },
          400,
          cors,
        );
      }
    }

    let wrapPayload: WrappedDekPayload | null = null;
    if (body.wrapped_dek !== undefined && body.wrapped_dek !== null) {
      if (!isValidWrapPayload(body.wrapped_dek)) {
        return jsonResponse({ error: "Invalid wrapped_dek payload" }, 400, cors);
      }
      wrapPayload = body.wrapped_dek;
    }

    // Owner-only: caller must be the household's owner.
    const { data: hh, error: hhErr } = await adminClient
      .from("households")
      .select("id, owner_id")
      .eq("id", householdId)
      .maybeSingle();
    if (hhErr) {
      console.error("invite-household-member households lookup failed:", hhErr);
      return jsonResponse({ error: "Failed to load household" }, 500, cors);
    }
    if (!hh || hh.owner_id !== caller.id) {
      return jsonResponse(
        {
          error: "You don't have permission to invite people to this household.",
        },
        403,
        cors,
      );
    }

    // Find or invite the auth user.
    const normalizedEmail = email.toLowerCase();
    let recipientUserId: string | null = null;
    let invitedNew = false;
    // Single indexed lookup via public.find_user_id_by_email RPC
    // (SECURITY DEFINER, hits auth.users email btree). Replaces the
    // previous paginate-up-to-50-pages-of-1000 linear scan, which would
    // have broken silently past 50K total auth users.
    {
      const { data: foundId, error: lookupErr } = await adminClient.rpc("find_user_id_by_email", {
        p_email: normalizedEmail,
      });
      if (lookupErr) {
        console.error("invite-household-member find_user_id_by_email failed:", lookupErr);
      } else if (foundId) {
        recipientUserId = foundId as string;
      }
    }

    if (!recipientUserId) {
      const redirectTo = resolveRedirect(req);
      const { data: invited, error: inviteErr } = await adminClient.auth.admin.inviteUserByEmail(
        normalizedEmail,
        {
          redirectTo,
        },
      );
      if (inviteErr || !invited?.user) {
        console.error("invite-household-member inviteUserByEmail failed:", inviteErr);
        return jsonResponse({ error: "Failed to send invitation" }, 500, cors);
      }
      recipientUserId = invited.user.id;
      invitedNew = true;
    } else {
      // Existing user — check duplicate household_members.
      const { data: dup } = await adminClient
        .from("household_members")
        .select("id, status")
        .eq("household_id", householdId)
        .eq("user_id", recipientUserId)
        .maybeSingle();
      if (dup && (dup as { status?: string }).status !== "removed") {
        return jsonResponse({ error: "That person is already in this household." }, 409, cors);
      }
    }

    // Wrap-present path: we have the wrap; persist everything.
    if (wrapPayload) {
      if (!recipientUserId) {
        return jsonResponse({ error: "wrapped_dek provided but recipient not found" }, 400, cors);
      }

      // Phase 4.5: detect the active DEK key_version + whether this
      // household has a real (non-placeholder) wrap somewhere yet.
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

      // household_members upsert (idempotent). Phase 4.4 carries
      // expires_at + source so the sweep job knows which rows are
      // time-boxed and why.
      const { error: memberErr } = await adminClient.from("household_members").upsert(
        {
          household_id: householdId,
          user_id: recipientUserId,
          role,
          status: "active",
          joined_at: new Date().toISOString(),
          enc_email: encEmail,
          expires_at: expiresAtIso,
          source,
        },
        { onConflict: "household_id,user_id" },
      );
      if (memberErr) {
        console.error("invite-household-member household_members upsert failed:", memberErr);
        return jsonResponse({ error: "Failed to add member" }, 500, cors);
      }

      // household_keys insert. Use upsert to keep retry safe.
      const { error: keyErr } = await adminClient.from("household_keys").upsert(
        {
          household_id: householdId,
          user_id: recipientUserId,
          enc_household_dek: wrapPayload.enc_household_dek,
          wrap_algo: wrapPayload.wrap_algo,
          key_version: activeKv,
          is_placeholder: isPlaceholder,
          wrapped_by: caller.id,
        },
        { onConflict: "household_id,user_id,key_version" },
      );
      if (keyErr) {
        console.error("invite-household-member household_keys upsert failed:", keyErr);
        return jsonResponse({ error: "Failed to record household key" }, 500, cors);
      }

      // Mark any pre-existing pending invite for this email/household
      // as wrapped so the UI clears it.
      await adminClient
        .from("household_invites")
        .update({
          status: "wrapped",
          wrapped_at: new Date().toISOString(),
          recipient_user_id: recipientUserId,
        })
        .eq("household_id", householdId)
        .eq("email", normalizedEmail);

      await writeAudit(caller.id, recipientUserId, householdId, role, "wrapped");

      // Notification email — non-fatal.
      try {
        const redirectTo = resolveRedirect(req);
        await adminClient.auth.admin.inviteUserByEmail(normalizedEmail, { redirectTo });
      } catch (mailErr) {
        console.warn("invite-household-member notification email failed:", mailErr);
      }

      return jsonResponse(
        {
          ok: true,
          household_id: householdId,
          recipient_user_id: recipientUserId,
          invited: invitedNew,
          role,
          wrap_status: "wrapped",
          message: `${normalizedEmail} added to your household`,
        },
        200,
        cors,
      );
    }

    // Wrap-pending path. Probe whether the recipient already has a
    // keypair — if so we can flag the invite ready_to_wrap immediately
    // (saves a trigger round-trip).
    let initialStatus: "awaiting_recipient" | "ready_to_wrap" = "awaiting_recipient";
    let initialReadyAt: string | null = null;
    if (recipientUserId) {
      const { data: existingKey } = await adminClient
        .from("user_public_keys")
        .select("user_id")
        .eq("user_id", recipientUserId)
        .maybeSingle();
      if (existingKey) {
        initialStatus = "ready_to_wrap";
        initialReadyAt = new Date().toISOString();
      }
    }

    // Lookup-then-update-or-insert: PostgREST's onConflict cannot
    // target a partial unique index, and household_invites has the
    // (household_id, lower(email)) constraint as a partial index so
    // legacy code_only rows can coexist.
    const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
    const { data: existingInvite } = await adminClient
      .from("household_invites")
      .select("id")
      .eq("household_id", householdId)
      .eq("email", normalizedEmail)
      .maybeSingle();

    if (existingInvite) {
      const { error: updErr } = await adminClient
        .from("household_invites")
        .update({
          recipient_user_id: recipientUserId,
          inviter_id: caller.id,
          role,
          status: initialStatus,
          ready_to_wrap_at: initialReadyAt,
          expires_at: expiresAt,
          revoked_at: null,
        })
        .eq("id", (existingInvite as { id: string }).id);
      if (updErr) {
        console.error("invite-household-member pending update failed:", updErr);
        return jsonResponse({ error: "Failed to record pending invite" }, 500, cors);
      }
    } else {
      const { error: insErr } = await adminClient.from("household_invites").insert({
        household_id: householdId,
        email: normalizedEmail,
        recipient_user_id: recipientUserId,
        inviter_id: caller.id,
        role,
        status: initialStatus,
        ready_to_wrap_at: initialReadyAt,
        expires_at: expiresAt,
      });
      if (insErr) {
        console.error("invite-household-member pending insert failed:", insErr);
        return jsonResponse({ error: "Failed to record pending invite" }, 500, cors);
      }
    }

    await writeAudit(caller.id, recipientUserId, householdId, role, "pending");

    return jsonResponse(
      {
        ok: true,
        household_id: householdId,
        recipient_user_id: recipientUserId,
        invited: invitedNew,
        role,
        wrap_status: "pending",
        message: invitedNew
          ? `Invitation sent to ${normalizedEmail}`
          : `Invite recorded for ${normalizedEmail}; they'll get access once their account is set up.`,
      },
      200,
      cors,
    );
  } catch (err) {
    console.error("invite-household-member error:", err);
    return jsonResponse({ error: "Internal error" }, 500, cors);
  }
});

/**
 * This function emits a Supabase invite email whose
 * confirmation link routes the recipient through `redirectTo`. If we
 * reflect the request Origin verbatim, ANY web origin that can call this
 * function gets to point the invite link at an attacker-controlled host —
 * resulting in token leakage when the recipient clicks through.
 *
 * Strict rules:
 *   1. If the request Origin is in the ALLOWED_ORIGINS allowlist → use it.
 *   2. Otherwise → fall back to INVITE_REDIRECT_URL env var. Never reflect.
 *   3. If neither is available → fall back to the project's default
 *      Supabase domain. Log a warning, since this branch means the
 *      operator forgot to set INVITE_REDIRECT_URL.
 *
 * We never log the rejected origin verbatim (avoid log-injection / leaking
 * attacker probe fingerprints) — just the flag.
 */
function resolveRedirect(req: Request): string {
  const origin = req.headers.get("Origin");
  const allowlist = getAllowedOriginsFromEnv();

  if (isOriginAllowed(origin, allowlist)) {
    return `${origin!.replace(/\/+$/, "")}/`;
  }

  if (origin) {
    console.warn(
      "invite-household-member: rejected-non-allowlisted-origin, falling back to INVITE_REDIRECT_URL",
    );
  }

  const envRedirect = Deno.env.get("INVITE_REDIRECT_URL");
  if (envRedirect) return envRedirect;

  console.warn(
    "invite-household-member: INVITE_REDIRECT_URL unset; falling back to SUPABASE_URL",
  );
  return `${SUPABASE_URL}/`;
}

async function writeAudit(
  callerId: string,
  targetUserId: string | null,
  householdId: string,
  role: string,
  wrapStatus: "wrapped" | "pending",
): Promise<void> {
  try {
    const scopedUserId = targetUserId ?? callerId;
    const { error } = await adminClient.from("vault_security_events").insert({
      user_id: scopedUserId,
      event: "household_member.invited",
      metadata: {
        actor_user_id: callerId,
        target_user_id: targetUserId,
        household_id: householdId,
        role,
        wrap_status: wrapStatus,
      },
    });
    if (error) {
      console.warn("invite-household-member audit insert failed:", error);
    }
  } catch (err) {
    console.warn("invite-household-member audit insert threw:", err);
  }
}
