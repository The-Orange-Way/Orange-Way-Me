/**
 * useConnectionAccountMap — read + write the encrypted mapping that links
 * an OR (connection, source-wallet) pair to one or more Personal accounts.
 *
 * ZKA: the Personal `accounts.id` UUID is encrypted with the user vault MEK
 * (via `encryptText` / `decryptText` from VaultContext) before being stored.
 * The server learns only `(or_connection_id, or_external_wallet_id)`. The
 * mapping is resolved entirely client-side after vault unlock.
 *
 * This hook does NOT require sequencing with `useAccounts`; the caller is
 * expected to resolve `accountId → Account` against its own account cache.
 *
 * Phase 4 scope: 1:N mappings supported (one OR wallet → many Personal
 * accounts) but the UX defaults to 1:1. N:N comes later when split routing
 * UX lands. Inactive rows are kept (not hard-deleted) so we can rehydrate a
 * mapping if the user accidentally clears it — toggle `is_active` instead.
 */
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { useVault } from "@/context/VaultContext";

export interface ConnectionAccountMapRow {
  id: string;
  or_connection_id: string;
  or_external_wallet_id: string;
  /** Decrypted Personal accounts.id — UUID string. */
  account_id: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

interface RawRow {
  id: string;
  user_id: string;
  or_connection_id: string;
  or_external_wallet_id: string;
  encrypted_account_id: string;
  encrypted_metadata_key_version: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

const camTable = () =>
  (supabase as { from: (t: string) => unknown }).from("connection_account_map") as {
    select: (cols: string) => {
      eq: (
        col: string,
        val: string,
      ) => Promise<{ data: RawRow[] | null; error: { message: string } | null }>;
    };
    insert: (
      rows: Record<string, unknown> | Record<string, unknown>[],
    ) => Promise<{ error: { message: string } | null }>;
    update: (patch: Record<string, unknown>) => {
      eq: (col: string, val: string) => Promise<{ error: { message: string } | null }>;
    };
    delete: () => {
      eq: (col: string, val: string) => Promise<{ error: { message: string } | null }>;
    };
  };

export function useConnectionAccountMap() {
  const { user } = useAuth();
  const { isUnlocked, encryptText, decryptText } = useVault();
  const [rows, setRows] = useState<ConnectionAccountMapRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!user || !isUnlocked) {
      if (!user) console.warn("[CAM] cam-resolve-skipped: no user");
      else console.warn("[CAM] cam-resolve-skipped: locked vault");
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { data, error: e } = await camTable()
        .select(
          "id, user_id, or_connection_id, or_external_wallet_id, encrypted_account_id, encrypted_metadata_key_version, is_active, created_at, updated_at",
        )
        .eq("user_id", user.id);
      if (e) throw new Error(e.message);
      const decoded: ConnectionAccountMapRow[] = [];
      for (const raw of (data ?? []) as RawRow[]) {
        try {
          const account_id = await decryptText(raw.encrypted_account_id);
          decoded.push({
            id: raw.id,
            or_connection_id: raw.or_connection_id,
            or_external_wallet_id: raw.or_external_wallet_id,
            account_id,
            is_active: raw.is_active,
            created_at: raw.created_at,
            updated_at: raw.updated_at,
          });
        } catch {
          // Row may have been encrypted with a different vault key; log for diagnostics.
          console.warn(`[CAM] cam-decrypt-failed: row ${raw.id} skipped (decrypt failed)`);
        }
      }
      if (decoded.length === 0 && (data?.length ?? 0) > 0) {
        console.warn(`[CAM] cam-mapped-but-empty: ${data?.length ?? 0} row(s) in DB, all decrypt failed`);
      }
      setRows(decoded);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load mapping");
    } finally {
      setLoading(false);
    }
  }, [user, isUnlocked, decryptText]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /**
   * Replace the active mappings for a (connection, wallet) pair with the
   * provided list of Personal accountIds. Existing inactive rows for the
   * same (connection, wallet, accountId) tuple are reactivated where
   * possible to preserve audit history.
   *
   * Empty `accountIds` deactivates all current mappings for the pair.
   */
  const setMappingForWallet = useCallback(
    async (
      orConnectionId: string,
      orExternalWalletId: string,
      accountIds: string[],
    ): Promise<void> => {
      if (!user) throw new Error("Not signed in");

      const existing = rows.filter(
        (r) =>
          r.or_connection_id === orConnectionId && r.or_external_wallet_id === orExternalWalletId,
      );

      const desiredSet = new Set(accountIds);
      const existingActive = existing.filter((r) => r.is_active);
      const existingActiveAccountIds = new Set(existingActive.map((r) => r.account_id));

      // 1. Deactivate active rows whose account_id is no longer in the desired set.
      for (const r of existingActive) {
        if (!desiredSet.has(r.account_id)) {
          const { error: e } = await camTable().update({ is_active: false }).eq("id", r.id);
          if (e) throw new Error(e.message);
        }
      }

      // 2. For each desired accountId not already active: try reactivating an
      // inactive row first (preserves history); else insert new ciphertext.
      for (const accId of accountIds) {
        if (existingActiveAccountIds.has(accId)) continue;
        const inactive = existing.find((r) => !r.is_active && r.account_id === accId);
        if (inactive) {
          const { error: e } = await camTable().update({ is_active: true }).eq("id", inactive.id);
          if (e) throw new Error(e.message);
        } else {
          const encrypted_account_id = await encryptText(accId);
          const { error: e } = await camTable().insert({
            user_id: user.id,
            or_connection_id: orConnectionId,
            or_external_wallet_id: orExternalWalletId,
            encrypted_account_id,
          });
          if (e) throw new Error(e.message);
        }
      }

      await refresh();
    },
    [user, rows, encryptText, refresh],
  );

  /**
   * Drop every row (active + inactive) for the given OR connection. Called
   * when the user deletes a connection so the mapping table doesn't grow
   * stale entries forever.
   */
  const removeAllForConnection = useCallback(
    async (orConnectionId: string): Promise<void> => {
      if (!user) return;
      const { error: e } = await camTable().delete().eq("or_connection_id", orConnectionId);
      if (e) throw new Error(e.message);
      await refresh();
    },
    [user, refresh],
  );

  /**
   * Convenience read: return the active accountIds mapped to a given
   * (connection, wallet) pair. Empty array = no mapping yet.
   */
  const getActiveAccountIds = useCallback(
    (orConnectionId: string, orExternalWalletId: string): string[] => {
      return rows
        .filter(
          (r) =>
            r.is_active &&
            r.or_connection_id === orConnectionId &&
            r.or_external_wallet_id === orExternalWalletId,
        )
        .map((r) => r.account_id);
    },
    [rows],
  );

  return {
    rows,
    loading,
    error,
    refresh,
    setMappingForWallet,
    removeAllForConnection,
    getActiveAccountIds,
  };
}
