/**
 * e2e-mint-session: mint a Supabase auth session for ONE hardcoded
 * throwaway E2E fixture account (test1@orangeway.app), so CI can drive
 * the vault-unlock UI as a signed-in user without ever holding that
 * account's password or the project's service-role key in a CI secret.
 *
 * WHY THIS EXISTS (OWM-T0226). Dev sign-in is OTP-only (Cloudflare
 * Turnstile plus an emailed code): the password field auth.setup.ts
 * used to fill (#si-pw) does not exist on the deployed dev origin.
 * Typing a password can never authenticate there, however many
 * secrets CI is given. The alternative this function implements was
 * proven end to end against the deployed dev origin before being
 * built (see the ticket): mint a session server side with the
 * service-role key, hand only the resulting SESSION (never the key)
 * to the caller, and let the caller inject it as browser storage
 * state before the app loads. The vault-unlock screen itself, the
 * thing this ticket exists to test, is untouched: it still needs the
 * real vault password and never sees this function.
 *
 * Deliberately narrow, so a leaked E2E_MINT_TOKEN caps out at "sign
 * in as the one throwaway fixture account" instead of "whole dev
 * database":
 *   - the account is a literal, hardcoded constant, never a caller
 *     supplied value
 *   - the only credential this function needs at call time is its own
 *     single-purpose bearer token (a Supabase function secret,
 *     E2E_MINT_TOKEN, unrelated to and independently revocable from
 *     SUPABASE_SERVICE_ROLE_KEY)
 *   - it refuses to run at all unless SUPABASE_URL names the dev
 *     project, so the same code deployed to prod by mistake is a hard
 *     no-op rather than a live door
 *
 * Dev only. Never deploy this function to the prod project.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { jsonResponse } from "../_shared/http.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const MINT_TOKEN = Deno.env.get("E2E_MINT_TOKEN");

// The one account this function will ever authenticate as. Never taken
// from the request: a caller-supplied email would turn "leak the mint
// token" into "sign in as anyone".
const FIXTURE_EMAIL = "test1@orangeway.app";

// This function must exist only on the dev project. Refuse defensively
// in case it is ever deployed to prod by mistake.
const DEV_PROJECT_REF = "bogmoovbjpvcvdqrmjgt";

const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405, {});

  if (!MINT_TOKEN) {
    console.error("[e2e-mint-session] E2E_MINT_TOKEN secret is unset -- refusing all requests.");
    return jsonResponse({ error: "e2e-mint-session is not configured" }, 500, {});
  }
  if (!SUPABASE_URL.includes(DEV_PROJECT_REF)) {
    return jsonResponse(
      { error: "e2e-mint-session refuses to run outside the dev project" },
      403,
      {},
    );
  }

  const presented = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  // This is not a constant-time compare on purpose: MINT_TOKEN is a
  // single-purpose, independently revocable secret scoped to one
  // throwaway account, not a password guarding real user data. A
  // timing side channel on it is not a materially bigger blast radius
  // than holding the token at all.
  if (!presented || presented !== MINT_TOKEN) {
    return jsonResponse({ error: "Unauthorized" }, 401, {});
  }

  try {
    const { data: linkData, error: linkErr } = await serviceClient.auth.admin.generateLink({
      type: "magiclink",
      email: FIXTURE_EMAIL,
    });
    const hashedToken = linkData?.properties?.hashed_token;
    if (linkErr || !hashedToken) {
      console.error("[e2e-mint-session] generateLink failed:", linkErr?.message);
      return jsonResponse({ error: "Could not mint a link for the fixture account" }, 500, {});
    }

    const { data: verifyData, error: verifyErr } = await serviceClient.auth.verifyOtp({
      type: "magiclink",
      token_hash: hashedToken,
    });
    if (verifyErr || !verifyData?.session) {
      console.error("[e2e-mint-session] verifyOtp failed:", verifyErr?.message);
      return jsonResponse({ error: "Could not verify the minted link" }, 500, {});
    }

    // Return exactly the Session object supabase-js persists under its
    // sb-<project-ref>-auth-token storage key, so the caller can
    // inject it verbatim with no reshaping.
    return jsonResponse({ session: verifyData.session }, 200, {});
  } catch (err) {
    console.error("[e2e-mint-session] fatal:", err);
    return jsonResponse({ error: "Internal error" }, 500, {});
  }
});
