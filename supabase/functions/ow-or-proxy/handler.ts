/**
 * ow-or-proxy: everything the proxy DOES, separated from the wiring that
 * starts it. index.ts holds the environment and the server; this file holds
 * the branches.
 *
 * WHY THE SPLIT EXISTS (OWM-T0534). The server side private wallet kill
 * switch is the `or-link-mint-token` branch below. The pure flag reader in
 * _shared/stealth-flag.ts had nine tests and not one of them built a request,
 * so nothing in CI could tell whether the refusal was still WIRED UP. Moving
 * the refusal below the outbound body assembly, inverting it, or repointing
 * the reader at another row all passed the tests, the typechecks and the leak
 * scan. A control that only holds because two people once read the file
 * carefully is not a control.
 *
 * The obstacle was mechanical rather than deep: index.ts called Deno.serve at
 * module scope and imported the Supabase SDK from a URL, so importing it from
 * the Node based test runner started a server and failed on the import.
 * Nothing here imports the SDK and nothing here reads Deno.env. The runtime
 * pieces arrive as ProxyDeps: index.ts builds them from the environment,
 * handler.test.ts builds them from fakes.
 *
 * THIS MOVE CHANGED NO BEHAVIOUR. Same branches, same status codes, same
 * messages, same order. If you are reviewing the diff, that is the property to
 * check.
 *
 * Single-user model, unchanged:
 *   - There is no "org" concept. Vault is per-user, so OR subaccount = one
 *     per user. external_user_id used at provision time = the authenticated
 *     Supabase user.id. No org membership check.
 *   - The browser caches the subaccount_id under
 *     `or_subaccount_id_for_user_<user.id>` and passes it back in payload
 *     for non-provision endpoints.
 *
 * For or-provision: external_user_id is set to the authenticated user.id.
 * For or-link-mint-token: app_user_id is set to user.id; ttl_seconds
 *   passed through if numeric. Refused outright while the private wallet
 *   kill switch (public.app_flags.stealth_sync_enabled) is not true: the
 *   minted token is what lets the widget receive the credentials key, so the
 *   switch has to be enforced here and not only in the browser.
 * For all others: subaccount_id is resolved server-side from
 *   user_profiles.or_subaccount_id on the authenticated user. A
 *   client-supplied subaccount_id is ignored, so a user cannot act on
 *   another user's subaccount.
 *
 * Response: passes through OR's response body and status.
 */

import { buildCorsHeaders, jsonResponse, readBoundedText } from "../_shared/http.ts";
import { OR_GATEWAY_NOT_ALLOWED_ERROR } from "../_shared/or-gateway.ts";
import {
  readStealthSyncEnabled,
  STEALTH_SYNC_DISABLED_ERROR,
  STEALTH_SYNC_DISABLED_MESSAGE,
  STEALTH_SYNC_FLAG_KEY,
} from "../_shared/stealth-flag.ts";

/**
 * Per-user-per-hour rate limit. 60 requests per hour is roughly one every
 * minute, which covers the legitimate "sync now" + "connect a new bank" +
 * "see my transactions" workflow many times over. The limit exists to stop a
 * compromised user account from being used to flood OR's platform endpoints
 * (or to abuse our quota).
 */
export const RATE_LIMIT_PER_HOUR = 60;

/**
 * Consistent error phrasing across OR platform consumers so support and users
 * see the same text wherever they encounter the message.
 */
export const OR_NOT_CONFIGURED_ERROR =
  "Orange Rails is not configured on this server. Ask your admin to set OR_PLATFORM_API_KEY in the Supabase function secrets.";

export const ALLOWED_ENDPOINTS = new Set([
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

/** The result of the hourly counter RPC. `error` non-null means it failed. */
export interface RateLimitResult {
  count: number | null;
  error: string | null;
}

/**
 * Everything this handler needs from the outside world. Deliberately a set of
 * narrow functions rather than a Supabase client: the client type comes from a
 * URL import that the Node test runner cannot resolve, and the point of the
 * split is that a test can supply these without one.
 */
export interface ProxyDeps {
  /** OR_PLATFORM_API_KEY is present. False refuses every request with a 500. */
  readonly platformApiKeyConfigured: boolean;
  /** The configured OR gateway host passed the _shared/or-gateway.ts allowlist. */
  readonly gatewayAllowed: boolean;
  /** Resolve the caller from the Authorization header. Null means unauthenticated. */
  getUser(authHeader: string): Promise<{ id: string } | null>;
  /** Increment and return the caller's count in the current hour bucket. */
  incrementRateLimit(userId: string): Promise<RateLimitResult>;
  /**
   * Raw read of one app_flags row, handed straight to readStealthSyncEnabled,
   * which is the thing that turns every failure shape into a refusal. The key
   * is a parameter rather than baked into the adapter so a test can assert
   * WHICH switch this branch consulted, not merely that it consulted one.
   */
  readStealthFlagRow(key: string): Promise<unknown>;
  /** user_profiles.or_subaccount_id for the authenticated user, or null. */
  getSubaccountId(userId: string): Promise<string | null>;
  /** Mirror the user to subaccount mapping after a successful or-provision. */
  saveSubaccountId(userId: string, subaccountId: string): Promise<void>;
  /** POST to an Orange Rails edge function with the platform key attached. */
  callOr(endpoint: string, body: Record<string, unknown>): Promise<Response>;
}

export async function handleProxyRequest(req: Request, deps: ProxyDeps): Promise<Response> {
  const cors = buildCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405, cors);

  if (!deps.platformApiKeyConfigured) {
    return jsonResponse({ error: OR_NOT_CONFIGURED_ERROR }, 500, cors);
  }
  if (!deps.gatewayAllowed) {
    // OR_SUPABASE_URL was set to something outside the allowlist (see
    // _shared/or-gateway.ts). Refuse all proxy traffic until either the env
    // var is corrected or the code's allowlist is extended via a reviewed PR.
    return jsonResponse({ error: OR_GATEWAY_NOT_ALLOWED_ERROR }, 500, cors);
  }

  try {
    // -- Authenticate caller via Supabase JWT ---------------------------------
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return jsonResponse({ error: "Missing Authorization header" }, 401, cors);

    const user = await deps.getUser(authHeader);
    if (!user) return jsonResponse({ error: "Unauthorized" }, 401, cors);

    // -- Per-user-per-hour rate limit -----------------------------------------
    // Increments a counter in public.ow_or_proxy_rate_limit via the
    // increment_ow_or_proxy_rate RPC (SECURITY DEFINER, returns the
    // updated count). If the count exceeds RATE_LIMIT_PER_HOUR the
    // caller gets 429 with a Retry-After hint of the seconds remaining
    // in the current hour bucket. Stops a compromised user account
    // from being weaponized to flood OR's platform endpoints.
    const rate = await deps.incrementRateLimit(user.id);
    if (rate.error) {
      console.error("[ow-or-proxy] rate-limit RPC failed:", rate.error);
      // Fail-closed: if we cannot track the limit, refuse the request.
      return jsonResponse({ error: "Rate-limit check failed" }, 500, cors);
    }
    if (typeof rate.count === "number" && rate.count > RATE_LIMIT_PER_HOUR) {
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
      // SERVER SIDE KILL SWITCH. This is the mint that has to refuse, because
      // the token it returns is what lets the connect widget authenticate and
      // receive the credentials key. Reading the flag only in the browser made
      // it a convention: anything not running our JavaScript ignored it.
      //
      // Read fresh on every mint and never cached. Flipping the row is meant to
      // take effect immediately, and a mint happens when a person presses a
      // button, so one primary key read is not worth trading that property for.
      //
      // Fails closed in every direction: see _shared/stealth-flag.ts. A missing
      // row, a null, a non boolean and a failed read all refuse.
      //
      // THE POSITION OF THIS BLOCK IS THE CONTROL. It must stay above the
      // orBody assembly below and therefore above the callOr near the end of
      // this function: a refusal that happens after the outbound request is a
      // refusal of the response, not of the mint. handler.test.ts asserts both
      // directions, and asserts that callOr is never reached while the switch
      // is off.
      const stealthAllowed = await readStealthSyncEnabled(
        async () => await deps.readStealthFlagRow(STEALTH_SYNC_FLAG_KEY),
      );
      if (!stealthAllowed) {
        // 503 plus a stable code, so the client can tell "switched off for now"
        // from "you are not allowed" and render the right thing. Returns before
        // any request leaves this function: no token, no partial success.
        return jsonResponse(
          { error: STEALTH_SYNC_DISABLED_ERROR, message: STEALTH_SYNC_DISABLED_MESSAGE },
          503,
          cors,
        );
      }

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
      const resolved = await deps.getSubaccountId(user.id);
      if (typeof resolved !== "string" || !resolved) {
        return jsonResponse(
          { error: "not provisioned on Orange Rails (call or-provision first)" },
          400,
          cors,
        );
      }
      orBody = { ...payload, subaccount_id: resolved };
    }

    const orRes = await deps.callOr(endpoint, orBody);
    const orJson = await orRes.json().catch(() => ({ error: "OR returned non-JSON response" }));

    // Persist the user -> subaccount mapping on successful or-provision so
    // the or-webhook-receiver can resolve inbound sync.completed events
    // back to a user without going through a user JWT. Idempotent -- the
    // subaccount_id is stable per user and OR returns it on every call.
    if (endpoint === "or-provision" && orRes.ok && typeof orJson?.subaccount_id === "string") {
      try {
        await deps.saveSubaccountId(user.id, orJson.subaccount_id);
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
}
