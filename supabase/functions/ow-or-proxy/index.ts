/**
 * ow-or-proxy: the Orange Way to OrangeRails proxy.
 *
 * Orange Way is a Plaid-style platform consumer of OrangeRails. End
 * users never see OR; this proxy holds the OR_PLATFORM_API_KEY
 * (Supabase secret) and forwards user requests to OR's edge functions
 * with the platform key + the user's subaccount_id added.
 *
 * WHAT IS IN THIS FILE, AND WHY IT IS SO SHORT (OWM-T0534). Every branch,
 * status code and message lives in handler.ts, which imports nothing from a
 * URL and reads no environment, so the test runner can build a request and
 * drive it. This file is the part that can only run under Deno: the secrets,
 * the Supabase clients, and Deno.serve. Each adapter below is one call with no
 * decision in it.
 *
 * The server side private wallet kill switch is enforced in handler.ts on the
 * or-link-mint-token branch, above the outbound request. The read it uses is
 * `readStealthFlagRow` below, and _shared/stealth-mint-callers.test.ts pins
 * both that this function consults the switch and that the query names the
 * app_flags table and the enabled column.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getOrGatewayFromEnv } from "../_shared/or-gateway.ts";
import { STEALTH_SYNC_FLAG_KEY } from "../_shared/stealth-flag.ts";
import { handleProxyRequest, type ProxyDeps } from "./handler.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Canonical Orange Rails API gateway. The allowed host set lives in
// _shared/or-gateway.ts, not here: owm-or-quick-connect reads the same
// OR_SUPABASE_URL and forwards the same platform key, so both functions must
// enforce the same list. Null means the configured value is not allowed and
// every request is refused. See that module for the host notes.
const OR_SUPABASE_URL = getOrGatewayFromEnv("ow-or-proxy");

const OR_PLATFORM_API_KEY = Deno.env.get("OR_PLATFORM_API_KEY");

// Service-role client used only for the reads and the one upsert below -- so
// the or-webhook-receiver can resolve inbound sync.completed events back to a
// user without going through a user JWT, and so the kill switch is read with a
// role that is not the caller's.
const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

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

const deps: ProxyDeps = {
  platformApiKeyConfigured: Boolean(OR_PLATFORM_API_KEY),
  gatewayAllowed: OR_SUPABASE_URL !== null,

  async getUser(authHeader: string) {
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user },
      error,
    } = await userClient.auth.getUser();
    if (error || !user) return null;
    return { id: user.id };
  },

  async incrementRateLimit(userId: string) {
    const { data, error } = await serviceClient.rpc("increment_ow_or_proxy_rate", {
      p_user_id: userId,
    });
    return {
      count: typeof data === "number" ? data : null,
      error: error ? error.message : null,
    };
  },

  // The kill switch read. Key comes from the caller so the branch that gates
  // on it names the switch it is gating on, rather than this adapter deciding.
  async readStealthFlagRow(key: string) {
    return await serviceClient.from("app_flags").select("enabled").eq("key", key).maybeSingle();
  },

  async getSubaccountId(userId: string) {
    const { data } = await serviceClient
      .from("user_profiles")
      .select("or_subaccount_id")
      .eq("user_id", userId)
      .maybeSingle();
    const resolved = (data as { or_subaccount_id?: unknown } | null)?.or_subaccount_id;
    return typeof resolved === "string" && resolved ? resolved : null;
  },

  async saveSubaccountId(userId: string, subaccountId: string) {
    await serviceClient
      .from("user_profiles")
      .upsert({ user_id: userId, or_subaccount_id: subaccountId }, { onConflict: "user_id" });
  },

  async callOr(endpoint: string, body: Record<string, unknown>) {
    return await fetch(`${OR_SUPABASE_URL}/functions/v1/${endpoint}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Platform-API-Key": OR_PLATFORM_API_KEY!,
        "x-region": OR_REGION_HEADER,
      },
      body: JSON.stringify(body),
    });
  },
};

// Referenced so the flag key this function gates on is visible in this file
// too, not only inside the handler. The caller guard reads both.
void STEALTH_SYNC_FLAG_KEY;

Deno.serve((req: Request) => handleProxyRequest(req, deps));
