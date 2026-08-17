/**
 * useOrConnectionsList — light-weight read-only fetch of the user's
 * OR connections, suitable for surfaces other than the Connections
 * page (e.g. the Wallets page badge that shows "broken connection"
 * on accounts feeding from a connection in error state).
 *
 * Differences vs ConnectionsPage's inline list fetch:
 *
 *   - Does NOT decrypt source_wallets metadata. We only need the
 *     connection-level status, last_sync_at, and the decrypted
 *     last-error message.
 *   - Returns a discriminated result, not a flat array, so a caller
 *     cannot confuse "we could not read your connections" with "you
 *     have no connections". Pure read, no picker / sync / delete UX.
 *   - Caches the subaccount_id from localStorage same as the
 *     Connections page. If the user has never visited /connections
 *     (subaccount not provisioned yet) the result is unavailable — no
 *     OR connections means nothing to surface.
 *
 * ZK invariants are unchanged: the proxy authenticates via the
 * Supabase JWT, OR returns ciphertexts, and the decrypted_last_error
 * is decrypted in-browser with the OR creds subkey. The raw error
 * string is deliberately not returned when a fetch fails; a failed
 * read yields the unreadable state, not an error message on the UI.
 */
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { useVault } from "@/context/VaultContext";

const SUBACCOUNT_LS_PREFIX = "or_subaccount_id_for_user_";

export interface OrConnectionStatus {
  /** OR-issued connection UUID. Joins against connection_account_map.or_connection_id. */
  connectionId: string;
  providerType: string;
  /** Decrypted user-supplied label (or null if the user didn't set one / decrypt failed). */
  label: string | null;
  status: "active" | "error" | "disconnected";
  lastSyncAt: string | null;
  /** Decrypted last error message; null if there's no error or we couldn't decrypt. */
  lastError: string | null;
}

/**
 * The three distinct facts a caller must be able to tell apart:
 *
 *   loaded      — we reached OR and read the list. Trust it, including
 *                 an empty connections array (genuinely no connections).
 *   unreadable  — the proxy threw. The list is UNKNOWN, not empty; a
 *                 broken connection may exist and we could not see it.
 *   unavailable — the vault is locked, or OR was never provisioned for
 *                 this user. There is nothing OR-side to surface.
 *
 * The union is intentional: `connections` only exists on `loaded`, so a
 * consumer cannot read the list without first acknowledging which fact
 * it is looking at.
 */
export type OrConnectionsResult =
  | { state: "loaded"; connections: OrConnectionStatus[] }
  | { state: "unreadable" }
  | { state: "unavailable" };

interface RawConnectionRow {
  id: string;
  provider_type: string;
  encrypted_label: string | null;
  status: "active" | "error" | "disconnected";
  last_sync_at: string | null;
  encrypted_last_error: string | null;
}

async function callProxy(endpoint: string, payload: Record<string, unknown>): Promise<unknown> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error("Not authenticated");
  const res = await supabase.functions.invoke("ow-or-proxy", {
    body: { endpoint, payload },
  });
  if (res.error) throw new Error(res.error.message || `${endpoint} failed`);
  if (res.data && typeof res.data === "object" && "error" in res.data && res.data.error) {
    throw new Error(String((res.data as { error: unknown }).error));
  }
  return res.data;
}

export function useOrConnectionsList(): {
  result: OrConnectionsResult;
  loading: boolean;
  refresh: () => Promise<void>;
} {
  const { user } = useAuth();
  const { isUnlocked, decryptOrCipher } = useVault();
  const [result, setResult] = useState<OrConnectionsResult>({ state: "unavailable" });
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!user || !isUnlocked) {
      // Cannot read anything without an unlocked vault. Nothing to surface.
      setResult({ state: "unavailable" });
      setLoading(false);
      return;
    }
    const cachedSub = localStorage.getItem(SUBACCOUNT_LS_PREFIX + user.id);
    if (!cachedSub) {
      // User hasn't visited Connections yet (no OR subaccount provisioned).
      // There's nothing OR-side to surface.
      setResult({ state: "unavailable" });
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = (await callProxy("or-connection-list", {
        subaccount_id: cachedSub,
      })) as { connections: RawConnectionRow[] };
      const out: OrConnectionStatus[] = [];
      for (const c of res.connections ?? []) {
        let label: string | null = null;
        let lastError: string | null = null;
        if (c.encrypted_label) {
          try {
            label = await decryptOrCipher(c.encrypted_label);
          } catch {
            /* cosmetic only */
          }
        }
        if (c.encrypted_last_error) {
          try {
            lastError = await decryptOrCipher(c.encrypted_last_error);
          } catch {
            /* may fail with stale ORK; leave null */
          }
        }
        out.push({
          connectionId: c.id,
          providerType: c.provider_type,
          label,
          status: c.status,
          lastSyncAt: c.last_sync_at,
          lastError,
        });
      }
      setResult({ state: "loaded", connections: out });
    } catch (err) {
      // The read failed. The list is UNKNOWN, not empty: a broken
      // connection may exist and we could not see it. Surface that as
      // unreadable so the badge can say "status unknown" instead of
      // silently rendering healthy. The raw error is logged, never
      // returned to the UI.
      console.warn("[useOrConnectionsList] fetch failed", err);
      setResult({ state: "unreadable" });
    } finally {
      setLoading(false);
    }
  }, [user, isUnlocked, decryptOrCipher]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { result, loading, refresh };
}
