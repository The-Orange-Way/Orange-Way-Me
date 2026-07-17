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

// See the note in ./widget.ts: this must be a host that serves the
// widget directly, or the strict origin compare in openBankPopup drops
// the completion message. Set per environment in deploy.yml.
// `||` and not `??` for the same reason: an empty string must be
// treated as unset, not kept.
const OR_CONNECT_BASE =
  (import.meta.env.VITE_OR_CONNECT_URL as string | undefined) ||
  "https://connect.orangerails.com/connect";

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
  /**
   * Set only when this resolved via the active-discovery poll (see
   * openBankPopup below), never via postMessage. Callers MUST use this
   * list directly instead of re-calling discoverQuilttAccounts("") when
   * it's present: the poll already diffed against the user's
   * pre-existing accounts, so this is the newly-linked account(s) only.
   * A second enumerate-all call at this point would return the user's
   * OLD accounts too, which is exactly the bug this field exists to
   * avoid (see PR discussion for the multi-bank-account failure mode).
   */
  discoveredAccounts?: QuilttDiscoveredAccount[];
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

/** Discovery poll cadence and hard stop, see openBankPopup doc comment. */
const DISCOVERY_POLL_INTERVAL_MS = 3000;
const DISCOVERY_POLL_MAX_ATTEMPTS = 200; // ~10 minutes at the interval above

/**
 * Step 3: open the popup, listen for OR_QUILTT_LINK_COMPLETE. Resolves
 * with the Quiltt connection id when the user finishes; rejects on
 * cancel/popup-close.
 *
 * Also runs an active-discovery poll alongside the postMessage listener.
 * Some bank OAuth redirects (Finicity/MX) send the popup cross-origin,
 * which severs window.opener, so OR_QUILTT_LINK_COMPLETE never arrives
 * even though the link succeeded server-side and the user is stuck
 * watching a popup that will never resolve. Every few seconds we ask OR
 * to enumerate every connection this platform user has (empty
 * quilttConnectionId), and compare that list against a snapshot taken
 * right when the popup opened. As soon as an account appears that
 * WASN'T in the snapshot, that's the new link, so we treat it as
 * complete, close the popup, and resolve.
 *
 * The snapshot diff matters: a user connecting a SECOND bank already has
 * accounts from their first one. Without diffing against a snapshot,
 * the very first poll tick would see those pre-existing accounts, wrongly
 * conclude the new bank is linked, and close the popup before the actual
 * new link finishes. The resolved BankLinkComplete carries only the
 * newly-appeared accounts in discoveredAccounts so the caller doesn't
 * have to (and can't accidentally) re-enumerate and pick up the old ones.
 *
 * This is additive: the postMessage and popup-close paths below are
 * unchanged, this is a third way to settle the same promise. Capped at
 * DISCOVERY_POLL_MAX_ATTEMPTS so an abandoned popup doesn't poll forever.
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
    let pollInFlight = false;
    let pollAttempts = 0;
    // null until the pre-existing-accounts snapshot loads. The poll below
    // refuses to compare against a snapshot it doesn't have yet, so a
    // slow or failed snapshot fetch can only delay the fallback, never
    // cause a false positive against an empty baseline.
    let baselineAccountIds: Set<string> | null = null;

    void discoverQuilttAccounts("")
      .then((accounts) => {
        baselineAccountIds = new Set(accounts.map((a) => a.id));
      })
      .catch(() => {
        // Leave baselineAccountIds null and retry on the next poll tick.
      });

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

    const closeWatch = window.setInterval(() => {
      if (popupRef.closed && !settled) {
        cleanup();
        reject(new Error("Popup closed before completion"));
      }
    }, 500);

    const discoveryPoll = window.setInterval(() => {
      // Skip this tick if we've already settled, the popup is gone, the
      // snapshot isn't loaded yet, or a previous tick's request is still
      // in flight (owm-or-discover-quiltt retries server-side and can
      // take a few seconds to return).
      if (settled || pollInFlight || popupRef.closed || baselineAccountIds === null) return;
      pollAttempts += 1;
      if (pollAttempts > DISCOVERY_POLL_MAX_ATTEMPTS) {
        window.clearInterval(discoveryPoll);
        return;
      }
      const baseline = baselineAccountIds;
      pollInFlight = true;
      void discoverQuilttAccounts("")
        .then((accounts) => {
          if (settled) return;
          const newlyLinked = accounts.filter((a) => !baseline.has(a.id));
          if (newlyLinked.length === 0) return;
          settled = true;
          cleanup();
          resolve({
            type: "OR_QUILTT_LINK_COMPLETE",
            quilttConnectionId: "",
            discoveredAccounts: newlyLinked,
          });
        })
        .catch(() => {
          // Transient (no accounts yet, or a network blip), the
          // postMessage or popup-close path can still settle this promise,
          // and the next tick will try discovery again.
        })
        .finally(() => {
          pollInFlight = false;
        });
    }, DISCOVERY_POLL_INTERVAL_MS);

    function cleanup() {
      window.removeEventListener("message", handle);
      window.clearInterval(closeWatch);
      window.clearInterval(discoveryPoll);
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
 *
 * quilttConnectionId may be "" to mean "enumerate every connection for
 * this platform user" instead of one specific connection. Used by the
 * active-discovery poll in openBankPopup above, which doesn't have a
 * connection id yet (that's exactly what it's trying to discover).
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
