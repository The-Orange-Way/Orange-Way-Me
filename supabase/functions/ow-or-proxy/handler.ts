/**
 * ow-or-proxy request handling, extracted so the stealth-sync mint gate can
 * be exercised end to end under vitest instead of only by a structural
 * pattern match on source text (OWM-T0534's auditMintGate).
 *
 * index.ts is now a thin Deno.serve wrapper: it builds the real dependencies
 * (Supabase clients, the OR gateway URL, the platform key, fetch) from the
 * Deno runtime and calls handleOwOrProxyRequest with them. Everything in
 * this file is dependency-injected and imports nothing Deno-only, so a test
 * can call it directly with a fake flag reader and a fake fetch and assert
 * both directions of the stealth-sync mint gate: flag true lets the mint
 * proceed to the outbound call, flag false returns a refusal with the stable
 * code stealth_sync_disabled and no widget token anywhere in the response
 * body.
 *
 * Behaviour is unchanged from before the extraction: this is the same logic
 * that lived in the Deno.serve callback in index.ts, only relocated, with
 * its dependencies made explicit arguments instead of module-scope reads.
 * See index.ts for the full endpoint contract and the single-user model
 * this implements; that doc comment is not duplicated here so the two
 * copies cannot drift apart.
 */

import { buildCorsHeaders, jsonResponse, readBoundedText } from "../_shared/http.ts";
import { OR_GATEWAY_NOT_ALLOWED_ERROR } from "../_shared/or-gateway.ts";
import {
  readStealthSyncEnabled,
  STEALTH_SYNC_DISABLED_ERROR,
  STEALTH_SYNC_DISABLED_MESSAGE,
  STEALTH_SYNC_FLAG_KEY,
} from "../_shared/stealth-flag.ts";

// Per-user-per-hour rate limit. 60 requests per hour is roughly one every
// minute, which covers the legitimate "sync now" + "connect a new bank" +
// "see my transactions" workflow many times over. The limit exists to stop a
// compromised user account from being used to flood OR's platform endpoints
// (or to abuse our quota).
export const RATE_LIMIT_PER_HOUR = 60;

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
  // OR's /connect route. Platform-level (no subaccount), but the returned
  // token binds to app_user_id (= user.id).
  "or-link-mint-token",
  // Register the user's OPK (X25519 public key) so or-quiltt-sync can seal
  // background-synced bank transactions to it. app_user_id forced to user.id.
  "or-sync-key-register",
]);

/**
 * x-region: us-east-1 -- pin OR's edge function execution to Virginia so any
 * Quiltt-touching path (or-sync via the Quiltt source adapter,
 * or-link-mint-token, future Quiltt endpoints) executes from a US IP.
 * Quiltt's upstream providers (Finicity, MX) 403 non-US traffic.
 *
 * Safe to apply to every endpoint -- non-Quiltt endpoints are unaffected by
 * where the function runs.
 */
const OR_REGION_HEADER = "us-east-1";

/**
 * Minimal shape ow-or-proxy needs from a Supabase auth client, so this
 * module never imports the real SDK (which is a Deno-only https: import and
 * would break under Node/vitest). index.ts hands in the real thing; a test
 * hands in a stub with just this shape.
 */
export interface OwOrProxyUserClient {
  auth: {
    getUser(): Promise<{
      data: { user: { id: string } | null };
      error: unknown;
    }>;
  };
}

/**
 * Minimal shape of the service-role calls this handler makes: the
 * rate-limit RPC, the app_flags read for the stealth gate, and the
 * user_profiles read/upsert for subaccount resolution. Same reasoning as
 * OwOrProxyUserClient.
 */
export interface OwOrProxyServiceClient {
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): Promise<{ data: unknown; error: { message: string } | null }>;
  from(table: string): {
    select(columns: string): {
      eq(
        column: string,
        value: unknown,
      ): { maybeSingle(): Promise<{ data: unknown; error: unknown }> };
    };
    upsert(row: Record<string, unknown>, opts: { onConflict: string }): Promise<unknown>;
  };
}

export interface OwOrProxyDeps {
  /** Builds a Supabase client authenticated as the caller, from the raw
   *  Authorization header. index.ts wires this to the real SDK; a test
   *  wires it to a stub that returns a fixed user or a fixed auth error. */
  createUserClient: (authHeader: string) => OwOrProxyUserClient;
  /** Service-role client for the rate limit RPC, the stealth flag read, and
   *  the user_profiles subaccount lookup/upsert. */
  serviceClient: OwOrProxyServiceClient;
  /** Resolved OR gateway URL, or null when the configured value is outside
   *  the allowlist (see _shared/or-gateway.ts). null means every request is
   *  refused with OR_GATEWAY_NOT_ALLOWED_ERROR. */
  orGatewayUrl: string | null;
  /** OR_PLATFORM_API_KEY. Undefined means the function is not configured. */
  orPlatformApiKey: string | undefined;
  /** The outbound call to OR. index.ts passes the real global fetch; a test
   *  passes a fake that records the call and returns a controlled Response,
   *  which is what proves the mint gate's allowed direction actually reaches
   *  the outbound call rather than merely returning "not refused". */
  fetchImpl: typeof fetch;
}

async function callOr(
  deps: Pick<OwOrProxyDeps, "orGatewayUrl" | "orPlatformApiKey" | "fetchImpl">,
  endpoint: string,
  body: Record<string, unknown>,
): Promise<Response> {
  return await deps.fetchImpl(`${deps.orGatewayUrl}/functions/v1/${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Platform-API-Key": deps.orPlatformApiKey!,
      "x-region": OR_REGION_HEADER,
    },
    body: JSON.stringify(body),
  });
}

/**
 * The full ow-or-proxy request handler. Identical behaviour to the former
 * Deno.serve callback in index.ts; only the dependencies moved from module
 * scope to explicit arguments. See index.ts for the endpoint contract.
 */
export async function handleOwOrProxyRequest(
  req: Request,
  deps: OwOrProxyDeps,
): Promise<Response> {
  const cors = buildCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405, cors);

  if (!deps.orPlatformApiKey) {
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
  if (!deps.orGatewayUrl) {
    // OR_SUPABASE_URL was set to something outside the allowlist (see
    // _shared/or-gateway.ts). Refuse all proxy traffic until either the env
    // var is corrected or the code's allowlist is extended via a reviewed PR.
    return jsonResponse({ error: OR_GATEWAY_NOT_ALLOWED_ERROR }, 500, cors);
  }

  try {
    // -- Authenticate caller via Supabase JWT ---------------------------------
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return jsonResponse({ error: "Missing Authorization header" }, 401, cors);

    const userClient = deps.createUserClient(authHeader);
    const {
      data: { user },
      error: authErr,
    } = await userClient.auth.getUser();
    if (authErr || !user) return jsonResponse({ error: "Unauthorized" }, 401, cors);

    // -- Per-user-per-hour rate limit -----------------------------------------
    // Increments a counter in public.ow_or_proxy_rate_limit via the
    // increment_ow_or_proxy_rate RPC (SECURITY DEFINER, returns the updated
    // count). If the count exceeds RATE_LIMIT_PER_HOUR the caller gets 429
    // with a Retry-After hint of the seconds remaining in the current hour
    // bucket. Stops a compromised user account from being weaponized to
    // flood OR's platform endpoints.
    const { data: rateCount, error: rateErr } = await deps.serviceClient.rpc(
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
      const stealthAllowed = await readStealthSyncEnabled(
        async () =>
          await deps.serviceClient
            .from("app_flags")
            .select("enabled")
            .eq("key", STEALTH_SYNC_FLAG_KEY)
            .maybeSingle(),
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
      // leave a rotated OPK silently blocked at 409 with no client path to
      // recover.
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
      const { data: profileRow } = await deps.serviceClient
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

    const orRes = await callOr(deps, endpoint, orBody);
    const orJson = await orRes.json().catch(() => ({ error: "OR returned non-JSON response" }));

    // Persist the user -> subaccount mapping on successful or-provision so
    // the or-webhook-receiver can resolve inbound sync.completed events back
    // to a user without going through a user JWT. Idempotent -- the
    // subaccount_id is stable per user and OR returns it on every call.
    if (
      endpoint === "or-provision" &&
      orRes.ok &&
      typeof (orJson as { subaccount_id?: unknown })?.subaccount_id === "string"
    ) {
      try {
        await deps.serviceClient
          .from("user_profiles")
          .upsert(
            {
              user_id: user.id,
              or_subaccount_id: (orJson as { subaccount_id: string }).subaccount_id,
            },
            { onConflict: "user_id" },
          );
      } catch (mapErr) {
        // Best-effort: don't fail the request if the mapping write hiccups.
        // Next provision call will retry the upsert.
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
