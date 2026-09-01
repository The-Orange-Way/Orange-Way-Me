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
 * For all others: subaccount_id is resolved server-side from
 *   user_profiles.or_subaccount_id on the authenticated user. A
 *   client-supplied subaccount_id is ignored, so a user cannot act on
 *   another user's subaccount.
 *
 * Response: passes through OR's response body and status.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildCorsHeaders, jsonResponse, readBoundedText } from "../_shared/http.ts";
import { getOrGatewayFromEnv, OR_GATEWAY_NOT_ALLOWED_ERROR } from "../_shared/or-gateway.ts";
import {
  type AppFlagReader,
  readStealthSyncEnabled,
  STEALTH_SYNC_DISABLED_CODE,
  STEALTH_SYNC_DISABLED_ERROR,
  STEALTH_SYNC_DISABLED_STATUS,
} from "../_shared/stealth-flag.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Canonical Orange Rails API gateway. The allowed host set lives in
// _shared/or-gateway.ts, not here: owm-or-quick-connect reads the same
// OR_SUPABASE_URL and forwards the same platform key, so both functions must
// enforce the same list. Null means the configured value is not allowed and
// every request below is refused. See that module for the host notes.
const OR_SUPABASE_URL = getOrGatewayFromEnv("ow-or-proxy");

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
  // Disconnect a private (stealth) connection. A separate endpoint because
  // stealth connections live in their own store, scoped by app_user_id rather
  // than by subaccount_id, so or-connection-delete cannot see them and answers
  // 404 "Connection not found in this subaccount" for every one of them.
  "or-stealth-connection-delete",
  // Read back the sealed transactions the stealth widget stored. Separate
  // from or-transactions-list for the same reason the delete is separate:
  // stealth rows live in their own store, scoped by app_user_id. Without
  // this entry the call is rejected below before any network hop, which is
  // why the app has never issued a stealth read at all (#305).
  "or-stealth-transactions-list",
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
 * Actions refused while the private wallet kill switch is off.
 *
 * Every action in ALLOWED_ENDPOINTS was considered, and the disposition of
 * each is recorded here so a future reader does not have to re-derive it:
 *
 *   or-link-mint-token            GATED. It mints the widget token the browser
 *                                 trades for a widget origin that receives the
 *                                 credentials key. This is the server side edge
 *                                 of the self custody boundary.
 *   or-stealth-connection-delete  NOT gated. It removes a private connection
 *                                 and carries no key material. Gating a removal
 *                                 would strand a customer with a connection
 *                                 they cannot delete while the switch is off,
 *                                 which is the opposite of what the switch is
 *                                 for.
 *   or-stealth-transactions-list  NOT gated. It returns rows that were sealed
 *                                 to the user's own key before they were
 *                                 stored. The server never holds the plaintext
 *                                 and no key crosses a boundary on this call,
 *                                 so refusing it would only hide data the
 *                                 customer already owns.
 *   or-sync-key-register          NOT gated. It registers the user's X25519
 *                                 PUBLIC key. A public key is not secret
 *                                 material, and the bank sealing path needs the
 *                                 same registration, so gating it would break a
 *                                 feature this switch has nothing to do with.
 *   or-provision                  NOT gated. Creates the subaccount. No key
 *                                 material.
 *   or-connection-list            NOT gated. Connection metadata only.
 *   or-connection-delete          NOT gated. Removal, and not a private wallet
 *                                 path at all.
 *   or-sync                       NOT gated. Bank sync through the subaccount.
 *   or-transactions-list          NOT gated. Bank transactions through the
 *                                 subaccount.
 *
 * Adding an action that exports, transports or re-mints vault key material
 * without adding it to this set is the one way this gate can silently stop
 * covering something.
 */
const STEALTH_GATED_ENDPOINTS = new Set(["or-link-mint-token"]);

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
    // _shared/or-gateway.ts). Refuse all proxy traffic until either the env
    // var is corrected or the code's allowlist is extended via a reviewed PR.
    return jsonResponse({ error: OR_GATEWAY_NOT_ALLOWED_ERROR }, 500, cors);
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

    // -- Private wallet kill switch, enforced server side ---------------------
    // public.app_flags key stealth_sync_enabled is read here, on every gated
    // request, and never cached: an edge instance is reused across requests, so
    // a cached answer would outlive a flip of the row by an unbounded amount.
    //
    // This sits ABOVE the request build on purpose. There is no path where the
    // flag is off and a token is nonetheless constructed, and the refusal body
    // carries an error and a code and nothing else, so there is no partial
    // success that still contains a token.
    //
    // Fail closed: readStealthSyncEnabled returns false for a read that errors,
    // a read that throws, an absent row, and a value that is not exactly true.
    if (STEALTH_GATED_ENDPOINTS.has(endpoint)) {
      const stealthEnabled = await readStealthSyncEnabled(
        serviceClient as unknown as AppFlagReader,
      );
      if (!stealthEnabled) {
        return jsonResponse(
          { error: STEALTH_SYNC_DISABLED_ERROR, code: STEALTH_SYNC_DISABLED_CODE },
          STEALTH_SYNC_DISABLED_STATUS,
          cors,
        );
      }
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
    } else if (endpoint === "or-stealth-connection-delete") {
      // Private connections are scoped by app_user_id, not by subaccount_id,
      // so the subaccount check below does not apply and would reject every
      // one of these calls.
      //
      // app_user_id is forced to the authenticated user.id and never taken
      // from the payload. OR scopes the delete by platform, connection id and
      // app_user_id together, so forcing the owner here is the term that makes
      // that scoping resolve to the authenticated caller.
      const p = payload as { connection_id?: unknown };
      if (typeof p.connection_id !== "string" || !p.connection_id) {
        return jsonResponse({ error: "connection_id required in payload" }, 400, cors);
      }
      orBody = { app_user_id: user.id, connection_id: p.connection_id };
    } else if (endpoint === "or-stealth-transactions-list") {
      // Same scoping as the stealth delete: app_user_id, never subaccount_id,
      // and forced to the authenticated caller rather than taken from the
      // payload. OR re-checks that the connection belongs to that app_user_id
      // and answers 403 otherwise, so forcing it here is what makes that check
      // resolve to the caller instead of to whatever the browser claimed.
      //
      // The cursor is forwarded verbatim and never rebuilt. Both halves must
      // travel together -- OR rejects a half cursor, because block_height is
      // not unique and a height-only cursor silently drops the remainder of a
      // block. Passing them through untouched is what keeps that guarantee.
      const p = payload as {
        connection_id?: unknown;
        limit?: unknown;
        before_block?: unknown;
        before_txid_blind_index_hex?: unknown;
      };
      if (typeof p.connection_id !== "string" || !p.connection_id) {
        return jsonResponse({ error: "connection_id required in payload" }, 400, cors);
      }
      orBody = {
        app_user_id: user.id,
        connection_id: p.connection_id,
        ...(typeof p.limit === "number" ? { limit: p.limit } : {}),
        ...(typeof p.before_block === "number" && typeof p.before_txid_blind_index_hex === "string"
          ? {
              before_block: p.before_block,
              before_txid_blind_index_hex: p.before_txid_blind_index_hex,
            }
          : {}),
      };
    } else {
      // Always resolve subaccount_id server-side from the authenticated
      // user's profile. Never trust a client-supplied value: OR only checks
      // that a subaccount belongs to the platform, not to the calling user,
      // so an authenticated user could otherwise pass another user's
      // subaccount_id and read or mutate that user's Orange Rails state
      // (list, sync, delete, transactions). Source of truth is
      // user_profiles.or_subaccount_id, written by the or-provision mirror
      // below. Mirrors the OWB owb-or-proxy control.
      const { data: profileRow } = await serviceClient
        .from("user_profiles")
        .select("or_subaccount_id")
        .eq("user_id", user.id)
        .maybeSingle();
      const resolved = (profileRow as { or_subaccount_id?: unknown } | null)?.or_subaccount_id;
      if (typeof resolved !== "string" || !resolved) {
        return jsonResponse(
          { error: "not provisioned on Orange Rails (call or-provision first)" },
          400,
          cors,
        );
      }
      orBody = { ...payload, subaccount_id: resolved };
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
