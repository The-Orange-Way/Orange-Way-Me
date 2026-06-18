/**
 * owm-or-quick-connect — single-call setup for the Quiltt bank popup.
 *
 * The "fast path" for connecting a bank: in one HTTP roundtrip from the
 * browser, do everything needed to open the Quiltt popup with no further
 * loading state.
 *
 *   1. Provision an OR subaccount for this user (or reuse the existing one)
 *   2. Mint a short-lived widget_token (OR's auth token for the popup)
 *   3. Mint a Quiltt session bundle (lets the popup skip OR's /connect
 *      loading state and go straight to /connect/quiltt)
 *   4. Cache the Quiltt session token on user_profiles for 1hr so subsequent
 *      popup opens stay under Quiltt's 10/hr per-Profile rate limit
 *
 * ZKA note: this function never sees the vault password, MEK, or any
 * derived txn_key. The browser derives cred_key + txn_key from the
 * unlocked vault and posts them to OR via the popup's URL fragment —
 * out of band of this edge function. The transactions OR later returns
 * are encrypted under txn_key; the server (this side) cannot decrypt them.
 *
 * Per-user privacy: all DB reads/writes scope to auth.uid(). Household
 * partners get NO visibility into each other's bank connections by
 * default; sharing is an explicit later step via household-osk wrapping.
 *
 * POST (auth required):
 *   {} — no body needed
 *
 * Response 200:
 *   {
 *     orPlatformUserId: string,
 *     widget_token: string,
 *     expires_at: string,
 *     quilttBundle: {
 *       session_token: string,
 *       connector_id: string,
 *       platform_slug: string,
 *       app_user_id: string,
 *       profile_id?: string,
 *       environment_id?: string,
 *     } | null,
 *   }
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildCorsHeaders, jsonResponse, readBoundedText } from "../_shared/http.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// Canonical Orange Rails API gateway — see bb-or-proxy/index.ts comment block.
const OR_SUPABASE_URL = Deno.env.get("OR_SUPABASE_URL") ?? "https://api.orangerails.com";
const OR_PLATFORM_API_KEY = Deno.env.get("OR_PLATFORM_API_KEY");

const QUILTT_CACHE_REUSE_FLOOR_MS = 60 * 60 * 1000; // 1hr
const QUILTT_CACHE_LIFETIME_MS = 24 * 60 * 60 * 1000; // 24hr

const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

interface OrProvisionResp {
  subaccount_id?: string;
  error?: string;
}

interface OrMintTokenResp {
  widget_token?: string;
  expires_at?: string;
  error?: string;
}

interface QuilttBundle {
  session_token: string;
  connector_id: string;
  platform_slug: string;
  app_user_id: string;
  profile_id?: string;
  environment_id?: string;
}

/**
 * Force OR's edge function execution into us-east-1.
 *
 * Why: Quiltt's upstream providers (Finicity, MX) geo-restrict to US IPs.
 * Without pinning the execution region, OR's outbound fetch to
 * auth.quiltt.io can originate from a non-US IP and get 403
 * "API access is not permitted from this country."
 *
 * x-region: us-east-1 → response header x-sb-edge-region: us-east-1
 * → OR runs in Virginia → outbound call to Quiltt comes from a US IP.
 *
 * Required on EVERY OR call that may touch Quiltt's PROD API.
 */
const OR_REGION_HEADER = "us-east-1";

async function callOr<T>(
  endpoint: string,
  body: Record<string, unknown>,
): Promise<{ ok: boolean; status: number; json: T }> {
  const res = await fetch(`${OR_SUPABASE_URL}/functions/v1/${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Platform-API-Key": OR_PLATFORM_API_KEY!,
      "x-region": OR_REGION_HEADER,
    },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as T;
  return { ok: res.ok, status: res.status, json };
}

async function mintQuilttBundle(widgetToken: string): Promise<QuilttBundle | null> {
  // or-quiltt-session-via-widget takes only widget_token (no platform key).
  // The widget_token binds to (platform, app_user_id) so OR can authenticate
  // and authorize without our header.
  // x-region: us-east-1 forces OR to execute in Virginia so its outbound
  // call to auth.quiltt.io hits Quiltt PROD from a US IP (see callOr).
  try {
    const res = await fetch(`${OR_SUPABASE_URL}/functions/v1/or-quiltt-session-via-widget`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-region": OR_REGION_HEADER,
      },
      body: JSON.stringify({ widget_token: widgetToken }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as Partial<QuilttBundle>;
    if (
      typeof json.session_token === "string" &&
      typeof json.connector_id === "string" &&
      typeof json.platform_slug === "string" &&
      typeof json.app_user_id === "string"
    ) {
      return json as QuilttBundle;
    }
    return null;
  } catch {
    return null;
  }
}

Deno.serve(async (req: Request) => {
  const cors = buildCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405, cors);

  if (!OR_PLATFORM_API_KEY) {
    return jsonResponse({ error: "OR_PLATFORM_API_KEY not configured" }, 500, cors);
  }
  if (!OR_SUPABASE_URL) {
    return jsonResponse({ error: "OR_SUPABASE_URL not configured" }, 500, cors);
  }

  try {
    // ── Auth ─────────────────────────────────────────────────────────
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return jsonResponse({ error: "Missing Authorization header" }, 401, cors);

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user },
      error: authErr,
    } = await userClient.auth.getUser();
    if (authErr || !user) return jsonResponse({ error: "Unauthorized" }, 401, cors);

    // Body is optional; reject only if absurdly large.
    const raw = await readBoundedText(req);
    if (raw === null) return jsonResponse({ error: "Request body too large" }, 413, cors);

    // ── 1. Find or create OR subaccount ──────────────────────────────
    const { data: profile, error: profErr } = await serviceClient
      .from("user_profiles")
      .select("or_subaccount_id, quiltt_session_token, quiltt_session_expires_at")
      .eq("user_id", user.id)
      .maybeSingle();
    if (profErr) {
      console.error("[owm-or-quick-connect] user_profiles read failed:", profErr);
      return jsonResponse({ error: "Could not read user profile" }, 500, cors);
    }

    let orPlatformUserId = profile?.or_subaccount_id ?? null;

    if (!orPlatformUserId) {
      const prov = await callOr<OrProvisionResp>("or-provision", { external_user_id: user.id });
      if (!prov.ok || !prov.json.subaccount_id) {
        console.error("[owm-or-quick-connect] or-provision failed:", prov.status, prov.json);
        return jsonResponse({ error: "Failed to provision Orange Rails subaccount" }, 502, cors);
      }
      orPlatformUserId = prov.json.subaccount_id;

      // Persist the mapping so or-webhook-receiver can resolve sync.completed
      // events without a user JWT. Idempotent on user_id.
      const { error: upErr } = await serviceClient
        .from("user_profiles")
        .upsert(
          { user_id: user.id, or_subaccount_id: orPlatformUserId },
          { onConflict: "user_id" },
        );
      if (upErr) {
        console.error("[owm-or-quick-connect] subaccount upsert failed:", upErr);
        // Continue anyway — next attempt will retry.
      }
    }

    // ── 2. Mint widget token ──────────────────────────────────────────
    const mint = await callOr<OrMintTokenResp>("or-link-mint-token", { app_user_id: user.id });
    if (!mint.ok || !mint.json.widget_token) {
      console.error("[owm-or-quick-connect] mint-token failed:", mint.status, mint.json);
      return jsonResponse({ error: "Failed to mint widget token" }, 502, cors);
    }
    const { widget_token, expires_at } = mint.json;

    // ── 3. Quiltt session bundle (cached or fresh) ────────────────────
    // Reuse-if-fresh policy: if we have a cached session with >1hr remaining,
    // skip the fresh mint to stay under Quiltt's per-Profile rate limit.
    let quilttBundle: QuilttBundle | null = null;

    const cachedToken = profile?.quiltt_session_token ?? null;
    const cachedExpiresAt = profile?.quiltt_session_expires_at
      ? new Date(profile.quiltt_session_expires_at).getTime()
      : 0;
    const cacheHasHeadroom =
      cachedToken && cachedExpiresAt - Date.now() > QUILTT_CACHE_REUSE_FLOOR_MS;

    if (cacheHasHeadroom && cachedToken) {
      // Mint a fresh bundle but overlay the cached session_token. We still
      // need fresh connector_id / platform_slug / app_user_id from OR (in
      // case the Quiltt config changed); the heavy thing we're saving is
      // the Quiltt rate-limit-burning session mint.
      const freshShell = await mintQuilttBundle(widget_token);
      if (freshShell) {
        quilttBundle = { ...freshShell, session_token: cachedToken };
      }
    }

    if (!quilttBundle) {
      // Cache miss (or fresh mint failed) — mint a real one and cache it.
      const freshBundle = await mintQuilttBundle(widget_token);
      if (freshBundle) {
        quilttBundle = freshBundle;
        const { error: cacheErr } = await serviceClient
          .from("user_profiles")
          .update({
            quiltt_session_token: freshBundle.session_token,
            quiltt_session_expires_at: new Date(
              Date.now() + QUILTT_CACHE_LIFETIME_MS,
            ).toISOString(),
          })
          .eq("user_id", user.id);
        if (cacheErr) {
          console.error("[owm-or-quick-connect] quiltt cache write failed:", cacheErr);
          // Not fatal — next call will mint fresh again.
        }
      }
      // If freshBundle is null too, we return quilttBundle=null and the
      // client falls back to the slow path (popup goes to /connect not
      // /connect/quiltt; user clicks through the loading state).
    }

    return jsonResponse(
      {
        orPlatformUserId,
        widget_token,
        expires_at,
        quilttBundle,
      },
      200,
      cors,
    );
  } catch (err) {
    console.error("[owm-or-quick-connect] fatal:", err);
    return jsonResponse({ error: "Internal error" }, 500, cors);
  }
});
