/**
 * OR hosted Link widget — Orange Way client helper.
 *
 * Orange Way is a Plaid-style consumer of OrangeRails. Instead of
 * reinventing the provider picker, credential form, and wallet picker
 * in app code, this helper opens OR's hosted /connect route in a popup,
 * then resolves a Promise when the user finishes.
 *
 * Key handoff:
 *   OR's /connect route accepts `cred_key` + `txn_key` (base64 raw
 *   32-byte AES keys) in the URL fragment. The fragment never reaches
 *   OR's server logs. To produce these bytes, we re-derive from the
 *   user's vault password using the same HKDF contexts already used by
 *   the vault (ORANGERAILS_CREDENTIALS_V1 / ORANGERAILS_TRANSACTIONS_V1).
 *   The widget locks the credential under those keys and posts only
 *   the resulting subaccount_id / connection_id back to OW — OW never
 *   sees the plaintext credential.
 *
 * Single-user adaptation (vs. V3 which is multi-org):
 *   OW has no org concept. The vault is per-user, so `orgId` here is
 *   the authenticated Supabase user.id. ow-or-proxy already maps that
 *   to OR's external_user_id at provision time and uses subaccount_id
 *   for everything else; the mint-token endpoint mirrors that with
 *   app_user_id = user.id.
 */

import { supabase } from "@/integrations/supabase/client";

const OR_CONNECT_BASE =
  (import.meta.env.VITE_OR_CONNECT_URL as string | undefined) ?? "https://orangerails.com/connect";

/** Source wallets returned by the widget after the user picks them. */
export interface OrLinkSourceWallet {
  id: string;
  external_wallet_id: string;
  currency: string;
  label: string;
}

/** Success payload posted by OR /connect on completion. */
export interface OrLinkSuccess {
  type: "or-link-success";
  connection_id: string;
  subaccount_id: string;
  source_wallets: OrLinkSourceWallet[];
}

/** Open the OR hosted connect widget; resolves on success, rejects on
 *  cancel/close. Omit `provider` to let OR's widget show its own provider
 *  picker step. */
export async function openOrConnect(args: {
  orgId: string;
  provider?: string;
  credKeyB64: string;
  txnKeyB64: string;
}): Promise<OrLinkSuccess> {
  const widgetToken = await mintWidgetToken(args.orgId);
  const url = buildConnectUrl({
    platform: "orangeway",
    appUserId: args.orgId,
    provider: args.provider,
    returnTo: window.location.origin,
    widgetToken,
    credKeyB64: args.credKeyB64,
    txnKeyB64: args.txnKeyB64,
  });

  const popup = window.open(url, "or-connect", "width=720,height=900,popup=yes");
  if (!popup) {
    throw new Error("Popup blocked — allow popups for this site to connect a wallet");
  }
  const popupRef = popup; // narrowed non-null reference for closures below

  return new Promise<OrLinkSuccess>((resolve, reject) => {
    const expectedOrigin = new URL(OR_CONNECT_BASE).origin;
    let settled = false;

    function handle(event: MessageEvent) {
      if (event.origin !== expectedOrigin) return;
      const data = event.data as { type?: string };
      if (data?.type === "or-link-success") {
        settled = true;
        cleanup();
        resolve(event.data as OrLinkSuccess);
      } else if (data?.type === "or-link-cancel") {
        settled = true;
        cleanup();
        reject(new Error("User cancelled"));
      }
    }

    const poll = window.setInterval(() => {
      if (popupRef.closed && !settled) {
        cleanup();
        reject(new Error("Widget closed before completion"));
      }
    }, 500);

    function cleanup() {
      window.removeEventListener("message", handle);
      window.clearInterval(poll);
      try {
        popupRef.close();
      } catch {
        /* already closed */
      }
    }

    window.addEventListener("message", handle);
  });
}

async function mintWidgetToken(orgId: string): Promise<string> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const accessToken = session?.access_token;
  if (!accessToken) throw new Error("Not signed in");

  // Resolve the Supabase functions base URL the same way the supabase
  // client does. We hit the proxy directly via fetch (instead of
  // supabase.functions.invoke) so tests can mock global fetch.
  const SUPABASE_URL =
    (import.meta.env.VITE_SUPABASE_URL as string | undefined) ??
    (typeof process !== "undefined" ? process.env?.SUPABASE_URL : undefined) ??
    "";
  const SUPABASE_PUBLISHABLE_KEY =
    (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined) ??
    (typeof process !== "undefined" ? process.env?.SUPABASE_PUBLISHABLE_KEY : undefined) ??
    "";

  const res = await fetch(`${SUPABASE_URL}/functions/v1/ow-or-proxy`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      apikey: SUPABASE_PUBLISHABLE_KEY,
    },
    body: JSON.stringify({
      endpoint: "or-link-mint-token",
      org_id: orgId,
      payload: {},
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`or-link-mint-token failed (${res.status}): ${body}`);
  }
  const json = (await res.json()) as { widget_token?: string; error?: string };
  if (!json.widget_token) throw new Error(json.error ?? "Mint returned no widget_token");
  return json.widget_token;
}

function buildConnectUrl(args: {
  platform: string;
  appUserId: string;
  provider?: string;
  returnTo: string;
  widgetToken: string;
  credKeyB64: string;
  txnKeyB64: string;
}): string {
  const qs = new URLSearchParams({
    platform: args.platform,
    app_user_id: args.appUserId,
    return_to: args.returnTo,
  });
  if (args.provider) qs.set("provider", args.provider);
  const frag = new URLSearchParams({
    widget_token: args.widgetToken,
    cred_key: args.credKeyB64,
    txn_key: args.txnKeyB64,
  });
  return `${OR_CONNECT_BASE}?${qs.toString()}#${frag.toString()}`;
}
