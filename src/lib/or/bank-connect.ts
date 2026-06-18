/**
 * Bank-connect (Quiltt fast path) — Orange Way client helper.
 *
 * Parallel to src/lib/or/widget.ts (which handles the Bitcoin-source flow
 * via OR's hosted /connect page). The bank flow is different:
 *
 *   1. Single API call to owm-or-quick-connect (provision + mint widget
 *      token + mint Quiltt session bundle), so the popup can open in one
 *      click with no intermediate loading state.
 *   2. Popup goes STRAIGHT to OR's /connect/quiltt with the Quiltt session
 *      bundle in the URL fragment (no /connect picker — bank only).
 *   3. Listen for OR_QUILTT_LINK_COMPLETE postMessage carrying the
 *      Quiltt connection id.
 *   4. Caller hands off to owm-or-discover-quiltt to enumerate accounts.
 *
 * ZKA note: caller MUST pass cred_key + txn_key derived from the user's
 * unlocked vault. These keys ride in the popup's URL fragment to OR; OR
 * uses them to encrypt the Quiltt-fetched transactions before returning
 * them. The vault password itself never leaves the browser.
 */

import { supabase } from "@/integrations/supabase/client";

const OR_CONNECT_BASE =
  (import.meta.env.VITE_OR_CONNECT_URL as string | undefined) ?? "https://orangerails.com/connect";

export interface BankConnectQuickConnectResponse {
  orPlatformUserId: string;
  widget_token: string;
  expires_at: string;
  quilttBundle: {
    session_token: string;
    connector_id: string;
    platform_slug: string;
    app_user_id: string;
    profile_id?: string;
    environment_id?: string;
  } | null;
}

export interface BankLinkComplete {
  type: "OR_QUILTT_LINK_COMPLETE";
  quilttConnectionId: string;
  orConnectionId?: string;
  orSubaccountId?: string;
}

export interface QuilttDiscoveredAccount {
  id: string;
  name: string;
  institution_name: string | null;
  kind: string | null;
  mask: string | null;
  currency: string | null;
  state: string;
  /** Current balance reported by Quiltt. May be null if the bank does not expose it. */
  balance_current?: number | null;
  balance_available?: number | null;
}

/**
 * Step 1: fetch the everything-you-need-to-open-the-popup bundle from the
 * Orange Way edge function. One round trip. The function provisions the
 * OR subaccount if needed and mints a Quiltt session bundle so the popup
 * opens straight at /connect/quiltt.
 */
export async function quickConnect(): Promise<BankConnectQuickConnectResponse> {
  const { data, error } = await supabase.functions.invoke<BankConnectQuickConnectResponse>(
    "owm-or-quick-connect",
    { body: {} },
  );
  if (error) {
    throw new Error(`owm-or-quick-connect failed: ${error.message}`);
  }
  if (!data) {
    throw new Error("owm-or-quick-connect returned no data");
  }
  return data;
}

/**
 * Step 2: build the popup URL with the Quiltt session bundle embedded in
 * the fragment (so it never reaches OR's server logs), plus the ZKA keys
 * cred_key + txn_key. ZKA keys travel ONLY in the URL fragment.
 */
export function buildBankPopupUrl(args: {
  quickConnect: BankConnectQuickConnectResponse;
  credKeyB64: string;
  txnKeyB64: string;
}): string {
  const { quickConnect: qc, credKeyB64, txnKeyB64 } = args;
  const base = new URL(OR_CONNECT_BASE);
  const fragParams = new URLSearchParams({
    widget_token: qc.widget_token,
    cred_key: credKeyB64,
    txn_key: txnKeyB64,
  });
  if (qc.quilttBundle) {
    // Fast path: skip /connect, go straight to /connect/quiltt with the
    // pre-minted Quiltt session bundle. Popup opens with no loading.
    fragParams.set("session_token", qc.quilttBundle.session_token);
    fragParams.set("connector_id", qc.quilttBundle.connector_id);
    fragParams.set("platform_slug", qc.quilttBundle.platform_slug);
    fragParams.set("app_user_id", qc.quilttBundle.app_user_id);
    return `${base.origin}/connect/quiltt#${fragParams.toString()}`;
  }
  // Slow path fallback: open /connect; user clicks bank tile; OR mints
  // session there. Only happens if quick-connect's Quiltt bundle minting
  // failed (rate limit, transient Quiltt outage). Platform slug isn't
  // available here — OR derives it from the widget_token's binding.
  const qs = new URLSearchParams({
    app_user_id: qc.orPlatformUserId,
    return_to: window.location.origin,
    provider: "quiltt",
  });
  return `${OR_CONNECT_BASE}?${qs.toString()}#${fragParams.toString()}`;
}

/**
 * Step 3: open the popup, listen for OR_QUILTT_LINK_COMPLETE. Resolves
 * with the Quiltt connection id when the user finishes; rejects on
 * cancel/popup-close.
 */
export function openBankPopup(url: string): Promise<BankLinkComplete> {
  const popup = window.open(url, "or-quiltt-connect", "width=720,height=900,popup=yes");
  if (!popup) {
    throw new Error("Popup blocked — allow popups for this site to connect a bank");
  }
  const popupRef = popup;
  const expectedOrigin = new URL(OR_CONNECT_BASE).origin;

  return new Promise<BankLinkComplete>((resolve, reject) => {
    let settled = false;

    function handle(event: MessageEvent) {
      if (event.origin !== expectedOrigin) return;
      const data = event.data as { type?: string };
      if (data?.type === "OR_QUILTT_LINK_COMPLETE") {
        settled = true;
        cleanup();
        resolve(event.data as BankLinkComplete);
      } else if (data?.type === "or-link-cancel" || data?.type === "OR_QUILTT_LINK_CANCEL") {
        settled = true;
        cleanup();
        reject(new Error("User cancelled"));
      }
    }

    const poll = window.setInterval(() => {
      if (popupRef.closed && !settled) {
        cleanup();
        reject(new Error("Popup closed before completion"));
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

/**
 * Step 4: post-link account discovery. Quiltt's GraphQL pipeline takes a
 * few seconds to populate accounts after the popup closes successfully;
 * the edge function retries 0/1.5/3/5s so the caller gets the real list.
 */
export async function discoverQuilttAccounts(
  quilttConnectionId: string,
): Promise<QuilttDiscoveredAccount[]> {
  const { data, error } = await supabase.functions.invoke<{
    accounts: QuilttDiscoveredAccount[];
  }>("owm-or-discover-quiltt", {
    body: { quilttConnectionId },
  });
  if (error) {
    throw new Error(`owm-or-discover-quiltt failed: ${error.message}`);
  }
  if (!data?.accounts) {
    throw new Error("owm-or-discover-quiltt returned no accounts");
  }
  return data.accounts;
}
