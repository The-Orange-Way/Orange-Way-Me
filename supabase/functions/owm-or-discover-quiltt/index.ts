/**
 * owm-or-discover-quiltt — post-link bank account discovery.
 *
 * After the Quiltt popup closes with OR_QUILTT_LINK_COMPLETE, the browser
 * holds a quilttConnectionId but doesn't yet know what accounts exist
 * under it (Quiltt's GraphQL pipeline takes a few seconds to populate
 * accounts after a successful link). This function calls OR's
 * or-quiltt-accounts with retry backoff and returns the discovered
 * bank account metadata, which the client uses to seed the
 * review-accounts step.
 *
 * Returned account fields are plaintext-OK (institution name, account
 * mask, currency, kind) — these match what the user already sees in
 * the bank's own UI. The ZKA-encrypted columns on the accounts table
 * are NOT populated here; that happens client-side when the user clicks
 * Save in the review step.
 *
 * POST (auth required):
 *   { quilttConnectionId: string }
 *
 * Response 200:
 *   { accounts: [{ id, name, institution_name, kind, mask, currency, state }] }
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildCorsHeaders, jsonResponse, readBoundedText } from "../_shared/http.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
// Canonical Orange Rails API gateway — see bb-or-proxy/index.ts comment block.
const OR_SUPABASE_URL = Deno.env.get("OR_SUPABASE_URL") ?? "https://api.orangerails.com";
const OR_PLATFORM_API_KEY = Deno.env.get("OR_PLATFORM_API_KEY");

/**
 * Force OR's execution into us-east-1 so its outbound Quiltt call comes
 * from a US IP. Quiltt's upstream providers (Finicity, MX) block non-US
 * traffic at the API level.
 */
const OR_REGION_HEADER = "us-east-1";

// Quiltt's GraphQL pipeline can return 0 accounts for a few seconds after
// onExitSuccess. Retry with backoff so the listener gets the real list.
const RETRY_DELAYS_MS = [0, 1500, 3000, 5000];

interface QuilttAccount {
  id: string;
  name: string;
  institution_name: string | null;
  kind: string | null;
  mask: string | null;
  currency: string | null;
  state: string;
  balance_current?: number | null;
  balance_available?: number | null;
}

interface AccountsResp {
  accounts?: QuilttAccount[];
  error?: string;
}

async function fetchAccounts(
  appUserId: string,
  quilttConnectionId: string,
): Promise<{ ok: boolean; status: number; accounts: QuilttAccount[]; error?: string }> {
  const res = await fetch(`${OR_SUPABASE_URL}/functions/v1/or-quiltt-accounts`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Platform-API-Key": OR_PLATFORM_API_KEY!,
      "x-region": OR_REGION_HEADER,
    },
    body: JSON.stringify({
      app_user_id: appUserId,
      quiltt_connection_id: quilttConnectionId,
    }),
  });
  const json = (await res.json().catch(() => ({}))) as AccountsResp;
  return {
    ok: res.ok,
    status: res.status,
    accounts: json.accounts ?? [],
    error: json.error,
  };
}

Deno.serve(async (req: Request) => {
  const cors = buildCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405, cors);

  if (!OR_PLATFORM_API_KEY)
    return jsonResponse({ error: "OR_PLATFORM_API_KEY not configured" }, 500, cors);
  if (!OR_SUPABASE_URL) return jsonResponse({ error: "OR_SUPABASE_URL not configured" }, 500, cors);

  try {
    // Auth
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

    // Body
    const raw = await readBoundedText(req);
    if (raw === null) return jsonResponse({ error: "Request body too large" }, 413, cors);

    const body = JSON.parse(raw || "{}") as { quilttConnectionId?: string };
    if (!body.quilttConnectionId || typeof body.quilttConnectionId !== "string") {
      return jsonResponse({ error: "quilttConnectionId required" }, 400, cors);
    }

    // Retry until we get accounts back or run out of attempts
    let lastStatus = 0;
    let lastError: string | undefined;
    for (let i = 0; i < RETRY_DELAYS_MS.length; i++) {
      const delay = RETRY_DELAYS_MS[i];
      if (delay > 0) await new Promise((r) => setTimeout(r, delay));

      const result = await fetchAccounts(user.id, body.quilttConnectionId);
      lastStatus = result.status;
      lastError = result.error;

      if (!result.ok && result.status >= 500) {
        // Upstream 5xx is treated as transient — fall through to next retry.
        continue;
      }
      if (!result.ok) {
        // 4xx is terminal (auth, bad request) — surface immediately.
        return jsonResponse({ error: result.error ?? `OR returned ${result.status}` }, 502, cors);
      }
      if (result.accounts.length > 0) {
        return jsonResponse({ accounts: result.accounts }, 200, cors);
      }
      // Zero accounts: retry — Quiltt's GraphQL hasn't populated yet.
    }

    // Exhausted retries with no accounts
    return jsonResponse(
      {
        error: "Quiltt did not surface any accounts after retries",
        upstream_status: lastStatus,
        upstream_error: lastError ?? null,
      },
      504,
      cors,
    );
  } catch (err) {
    console.error("[owm-or-discover-quiltt] fatal:", err);
    return jsonResponse({ error: "Internal error" }, 500, cors);
  }
});
