/**
 * ow-or-proxy: the Orange Way to OrangeRails proxy.
 *
 * Orange Way is a Plaid-style platform consumer of OrangeRails. End
 * users never see OR; this proxy holds the OR_PLATFORM_API_KEY
 * (Supabase secret) and forwards user requests to OR's edge functions
 * with the platform key + the user's subaccount_id added.
 *
 * Single-user model:
 *   - There is no "org" concept. Vault is per-user, so OR subaccount = one
 *     per user. external_user_id used at provision time = the authenticated
 *     Supabase user.id. No org membership check.
 *   - The browser caches the subaccount_id under
 *     `or_subaccount_id_for_user_<user.id>` and passes it back in payload
 *     for non-provision endpoints.
 *
 * POST body:
 *   endpoint: one of:
 *     'or-provision' | 'or-connection-list' | 'or-connection-delete'
 *     | 'or-sync' | 'or-transactions-list' | 'or-link-mint-token'
 *   payload: object  forwarded to OR; subaccount_id auto-injected for
 *                    non-provision, non-mint endpoints if not present
 *
 * The hosted OR /connect widget (opened by openOrConnect on the
 * client) now owns connection creation, credential entry, wallet
 * discovery, and source-wallet picking -- so the create/discover/
 * source-wallets-set endpoints are no longer proxied here.
 *
 * For or-provision: external_user_id is set to the authenticated user.id.
 * For or-link-mint-token: app_user_id is set to user.id; ttl_seconds
 *   passed through if numeric.
 * For all others: subaccount_id MUST be in payload (browser passes it).
 *
 * Response: passes through OR's response body and status.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildCorsHeaders, jsonResponse, readBoundedText } from "../_shared/http.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Canonical Orange Rails API gateways.
//
// OR_URL_ALLOWLIST: the complete set of hosts OR_SUPABASE_URL may take.
// An operator who tries to point this function at an unrecognized host
// (e.g., via a compromised secret store) cannot redirect proxy traffic
// to an attacker-controlled endpoint. New allowed values require a
// code-review pass, not just an env-var edit.
//
// Entries:
//   api.orangerails.com  -- OR production API gateway
//   api.orangerails.dev  -- OR development API gateway
//
// Note: dev.orangerails.com is OR's dev CDN/frontend origin and returns
// 405 on all function paths; it is NOT an API host and must not appear
// here. staging.orangerails.com has no DNS.
const OR_URL_ALLOWLIST = new Set<string>([
  "https://api.orangerails.com",
  "https://api.orangerails.dev",
]);
const OR_SUPABASE_URL_RAW = Deno.env.get("OR_SUPABASE_URL") ?? "https://api.orangerails.com";
const OR_SUPABASE_URL = OR_URL_ALLOWLIST.has(OR_SUPABASE_URL_RAW) ? OR_SUPABASE_URL_RAW : null;
if (!OR_SUPABASE_URL) {
  console.error(
    `[ow-or-proxy] OR_SUPABASE_URL=${OR_SUPABASE_URL_RAW} is not in the allowlist; all requests will 500 until the env var is corrected or the code allowlist is extended.`,
  );
}

const OR_PLATFORM_API_KEY = Deno.env.get("OR_PLATFORM_API_KEY");

// Per-user-per-hour rate limit. 60 requests per hour is roughly one
// every minute, which covers the legitimate "sync now" + "connect a
// new bank" + "see my transactions" workflow many times over. The
// limit exists to stop a compromised user account from being used to
// flood OR's platform endpoints (or to abuse our quota).
const RATE_LIMIT_PER_HOUR = 60;

// Service-role client used only for the user_profiles.or_subaccount_id
// upsert below -- so the or-webhook-receiver can resolve inbound
// sync.completed events back to a user without going through a user JWT.
const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const ALLOWED_ENDPOINTS = new Set([
  "or-provision",
  "or-connection-list",
  "or-connection-delete",
  "or-sync",
  "or-transactions-list",
  // Hosted Link widget -- OW mints a short-lived widget_token, then opens
  // OR's /connect route. Platform-level (no subaccount), but the
  // returned token binds to app_user_id (= user.id).
  "or-link-mint-token",
  // Register the user's OPK (X25519 public key) so or-quiltt-sync can seal
  // background-synced bank transactions to it. app_user_id forced to user.id.
  "or-sync-key-register",
]);

/**
 * x-region: us-east-1 -- pin OR's edge function execution to Virginia so
 * any Quiltt-touching path (or-sync via the Quiltt source adapter,
 * or-link-mint-token, future Quiltt endpoints) executes from a US IP.
 * Quiltt's upstream providers (Finicity, MX) 403 non-US traffic.
 *
 * Safe to apply to every endpoint -- non-Quiltt endpoints are unaffected
 * by where the function runs.
 */
const OR_REGION_HEADER = "us-east-1";

async function callOr(endpoint: string, body: Record<string, unknown>): Promise<Response> {
  return await fetch(`${OR_SUPABASE_URL}/functions/v1/${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Platform-API-Key": OR_PLATFORM_API_KEY!,
      "x-region": OR_REGION_HEADER,
    },
    body: JSON.stringify(body),
  });
}

Deno.serve(async (req: Request) => {
  const cors = buildCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405, cors);

  if (!OR_PLATFORM_API_KEY) {
    // Consistent error phrasing across OR platform consumers so support
    // and users see the same text wherever they encounter the message.
    return jsonResponse(
      {
        error:
          "Orange Rails is not configured on this server. Ask your admin to set OR_PLATFORM_API_KEY in the Supabase function secrets.",
      },
      500,
      cors,
    );
  }
  if (!OR_SUPABASE_URL) {
    // OR_SUPABASE_URL was set to something outside the allowlist (see
    // OR_URL_ALLOWLIST near the top of the file). Refuse all proxy
    // traffic until either the env var is corrected or the code's
    // allowlist is extended via a reviewed PR.
    return jsonResponse(
      {
        error:
          "Orange Rails endpoint is not in the function's allowlist. This is a deploy-side misconfiguration.",
      },
      500,
      cors,
    );
  }

  try {
    // -- Authenticate caller via Supabase JWT ---------------------------------
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

    // -- Per-user-per-hour rate limit -----------------------------------------
    // Increments a counter in public.ow_or_proxy_rate_limit via the
    // increment_ow_or_proxy_rate RPC (SECURITY DEFINER, returns the
    // updated count). If the count exceeds RATE_LIMIT_PER_HOUR the
    // caller gets 429 with a Retry-After hint of the seconds remaining
    // in the current hour bucket. Stops a compromised user account
    // from being weaponized to flood OR's platform endpoints.
    const { data: rateCount, error: rateErr } = await serviceClient.rpc(
      "increment_ow_or_proxy_rate",
      { p_user_id: user.id },
    );
    if (rateErr) {
      console.error("[ow-or-proxy] rate-limit RPC failed:", rateErr.message);
      // Fail-closed: if we cannot track the limit, refuse the request.
      return jsonResponse({ error: "Rate-limit check failed" }, 500, cors);
    }
    if (typeof rateCount === "number" && rateCount > RATE_LIMIT_PER_HOUR) {
      const secondsLeft = 3600 - Math.floor((Date.now() % 3_600_000) / 1000);
      return jsonResponse(
        {
          error: `Rate limit exceeded (${RATE_LIMIT_PER_HOUR} requests per hour). Try again shortly.`,
        },
        429,
        { ...cors, "Retry-After": String(secondsLeft) },
      );
    }

    // -- Parse body -----------------------------------------------------------
    const raw = await readBoundedText(req);
    if (raw === null) return jsonResponse({ error: "Request body too large" }, 413, cors);

    const body = JSON.parse(raw) as {
      endpoint?: string;
      payload?: Record<string, unknown>;
    };

    const { endpoint, payload = {} } = body;
    if (!endpoint || !ALLOWED_ENDPOINTS.has(endpoint)) {
      return jsonResponse(
        { error: `endpoint must be one of: ${[...ALLOWED_ENDPOINTS].join(", ")}` },
        400,
        cors,
      );
    }

    // -- Build the OR request body --------------------------------------------
    let orBody: Record<string, unknown>;

    if (endpoint === "or-provision") {
      // Provision uses user.id as external_user_id (one subaccount per user
      // -- vault is per-user, no orgs concept).
      orBody = { external_user_id: user.id };
    } else if (endpoint === "or-link-mint-token") {
      // Mint widget session token. app_user_id = user.id (mirrors the
      // subaccount external_user_id used at provision). TTL can be
      // overridden by the caller; cap is enforced on OR side.
      const ttl =
        typeof (payload as { ttl_seconds?: unknown }).ttl_seconds === "number"
          ? ((payload as { ttl_seconds?: number }).ttl_seconds as number)
          : undefined;
      orBody = { app_user_id: user.id, ttl_seconds: ttl };
    } else if (endpoint === "or-sync-key-register") {
      // Register the user's OPK public key. app_user_id forced to the
      // authenticated user.id (never trust a client-supplied value).
      // opk_public + opk_alg come from the payload (browser-derived).
      // confirm_rotation + rotation_reason are forwarded as-is so the
      // client can opt into OR's rotation guard on a re-derive (vault
      // password change, recovery). Forgetting to forward these would
      // leave a rotated OPK silently blocked at 409 with no client
      // path to recover.
      const p = payload as {
        opk_public?: unknown;
        opk_alg?: unknown;
        confirm_rotation?: unknown;
        rotation_reason?: unknown;
      };
      orBody = {
        app_user_id: user.id,
        opk_public: p.opk_public,
        opk_alg: p.opk_alg,
        ...(p.confirm_rotation === true ? { confirm_rotation: true } : {}),
        ...(typeof p.rotation_reason === "string" ? { rotation_reason: p.rotation_reason } : {}),
      };
    } else {
      // For everything else, ensure subaccount_id is in the payload.
      // The browser passes it from localStorage; we additionally validate
      // it on the OR side (resolveSubaccount checks platform ownership).
      if (!payload.subaccount_id) {
        return jsonResponse(
          { error: "subaccount_id required in payload (call or-provision first if missing)" },
          400,
          cors,
        );
      }
      orBody = { ...payload };
    }

    const orRes = await callOr(endpoint, orBody);
    const orJson = await orRes.json().catch(() => ({ error: "OR returned non-JSON response" }));

    // Persist the user -> subaccount mapping on successful or-provision so
    // the or-webhook-receiver can resolve inbound sync.completed events
    // back to a user without going through a user JWT. Idempotent -- the
    // subaccount_id is stable per user and OR returns it on every call.
    if (endpoint === "or-provision" && orRes.ok && typeof orJson?.subaccount_id === "string") {
      try {
        await serviceClient
          .from("user_profiles")
          .upsert(
            { user_id: user.id, or_subaccount_id: orJson.subaccount_id },
            { onConflict: "user_id" },
          );
      } catch (mapErr) {
        // Best-effort: don't fail the request if the mapping write
        // hiccups. Next provision call will retry the upsert.
        console.error("[ow-or-proxy] subaccount map upsert failed:", mapErr);
      }
    }

    return jsonResponse(orJson, orRes.status, cors);
  } catch (err) {
    // Log the full error server-side for triage; never echo it to the
    // client. `detail: String(err)` previously leaked stack traces and
    // upstream error shapes to anyone who could trigger the catch.
    console.error("[ow-or-proxy] fatal:", err);
    return jsonResponse({ error: "Internal error" }, 500, cors);
  }
});
