/**
 * sweep-expired-household-roles — Supabase Edge Function (Phase 4.4).
 *
 * Fallback sweep path for Supabase projects where pg_cron is unavailable.
 * Calls the SQL `expire_time_boxed_household_roles()` function, which:
 *   - ends every support_sessions row whose expires_at has elapsed
 *   - flips revoked_at + status='removed' on every household_members row
 *     whose expires_at has elapsed, deletes their household_keys, and
 *     writes vault_security_events
 *
 * Invocation: Supabase scheduled function (every minute). Authenticated
 * via shared secret header (`x-cron-secret`) matching the
 * CRON_SWEEP_SECRET env var — NOT via user JWT.
 *
 * Response (200):
 *   { ok: true, expired_roles: number, expired_sessions: number }
 *
 * If pg_cron is enabled the DB schedules the same function every minute
 * internally; this edge function then behaves as a no-op when there is
 * nothing to sweep.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildCorsHeaders, jsonResponse } from "../_shared/http.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SWEEP_SECRET = Deno.env.get("CRON_SWEEP_SECRET") ?? "";

const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

/**
 * Constant-time string compare. Prevents timing-leak attacks where a
 * remote caller learns the secret one byte at a time by measuring how
 * long a `!==` reject takes. Differing-length strings still leak the
 * length difference — we accept that since the secret is fixed at 64
 * hex chars and the attacker would have to be lucky on length first.
 */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

serve(async (req) => {
  const cors = buildCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405, cors);
  }

  try {
    const provided = req.headers.get("x-cron-secret") ?? "";
    if (!CRON_SWEEP_SECRET || !constantTimeEqual(provided, CRON_SWEEP_SECRET)) {
      return jsonResponse({ error: "Forbidden" }, 403, cors);
    }

    const { data, error } = await adminClient.rpc("expire_time_boxed_household_roles");
    if (error) {
      console.error("sweep-expired-household-roles rpc failed:", error);
      return jsonResponse({ error: "Sweep failed" }, 500, cors);
    }

    const first = Array.isArray(data) ? data[0] : data;
    const expiredRoles = Number((first as { expired_roles?: unknown })?.expired_roles ?? 0);
    const expiredSessions = Number(
      (first as { expired_sessions?: unknown })?.expired_sessions ?? 0,
    );

    return jsonResponse(
      {
        ok: true,
        expired_roles: expiredRoles,
        expired_sessions: expiredSessions,
      },
      200,
      cors,
    );
  } catch (err) {
    console.error("sweep-expired-household-roles error:", err);
    return jsonResponse({ error: "Internal error" }, 500, cors);
  }
});
