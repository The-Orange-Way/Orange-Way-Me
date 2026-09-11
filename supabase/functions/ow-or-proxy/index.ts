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
 *
 * This file is a thin Deno.serve wrapper (OW-T0231): it builds the real
 * dependencies (Supabase clients, the OR gateway URL, the platform key,
 * fetch) from the Deno runtime and hands them to handleOwOrProxyRequest in
 * ./handler.ts, which holds all of the actual request logic and imports
 * nothing Deno-only, so it can be exercised directly under vitest.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getOrGatewayFromEnv } from "../_shared/or-gateway.ts";
import { handleOwOrProxyRequest, type OwOrProxyDeps } from "./handler.ts";

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

// Service-role client used for the rate-limit RPC, the stealth flag read in
// handler.ts, and the user_profiles.or_subaccount_id upsert -- so the
// or-webhook-receiver can resolve inbound sync.completed events back to a
// user without going through a user JWT.
const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const deps: OwOrProxyDeps = {
  createUserClient: (authHeader: string) =>
    createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    }),
  serviceClient,
  orGatewayUrl: OR_SUPABASE_URL,
  orPlatformApiKey: OR_PLATFORM_API_KEY,
  fetchImpl: fetch,
};

Deno.serve((req: Request) => handleOwOrProxyRequest(req, deps));
