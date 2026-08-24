/**
 * useAccounts — fetch + decrypt accounts for the signed-in user, and offer
 * create/update/delete + balance refresh helpers. All plaintext stays in
 * memory; the database only ever sees ciphertext.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { useAuth } from "@/context/AuthContext";
import { useVault } from "@/context/VaultContext";
import {
  decryptAccount,
  encryptAccount,
  encryptTransaction,
  type AccountEncrypted,
} from "@/lib/crypto-fields";
import { encryptText as cryptoEncryptText } from "@/lib/vault";
import type { Account, AccountDraft, AccountTypeKey, ConnectorType } from "@/lib/connectors";
import { getConnector } from "@/lib/connectors";

interface AccountRow extends AccountEncrypted {
  id: string;
  user_id: string;
  connector_type: ConnectorType;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  format_version?: number;
}

const accountsTable = () => supabase.from("accounts");
const credsTable = () => supabase.from("connector_credentials");
const txnsTable = () => supabase.from("transactions");

export function useAccounts() {
  const { user } = useAuth();
  const { isUnlocked, encryptText, decryptText, getHmacKey, buildHouseholdSignatureFields } =
    useVault();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Keep a stable cipher of the in-memory MEK so we can rebuild AES key for crypto-fields helpers.
  const decryptCacheRef = useRef<Map<string, Account>>(new Map());

  const refresh = useCallback(async () => {
    if (!user || !isUnlocked) {
      setAccounts([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { data, error: e } = await accountsTable()
        .select(
          "id, user_id, connector_type, is_active, created_at, updated_at, format_version, enc_name, enc_type, enc_currency, enc_institution, enc_balance, enc_metadata",
        )
        .eq("is_active", true)
        .order("created_at", { ascending: true });
      if (e) throw e;

      const out: Account[] = [];
      for (const raw of (data ?? []) as AccountRow[]) {
        try {
          const cached = decryptCacheRef.current.get(raw.id);
          if (cached && cached.updated_at === raw.updated_at) {
            out.push(cached);
            continue;
          }
          const dec = {
            name: await decryptText(raw.enc_name),
            type: (await decryptText(raw.enc_type)) as AccountTypeKey,
            currency: await decryptText(raw.enc_currency),
            institution: raw.enc_institution ? await decryptText(raw.enc_institution) : null,
            balance: await decryptText(raw.enc_balance),
            metadata: raw.enc_metadata
              ? (JSON.parse(await decryptText(raw.enc_metadata)) as Record<string, unknown>)
              : null,
          };
          const acc: Account = {
            id: raw.id,
            user_id: raw.user_id,
            connector_type: raw.connector_type,
            is_active: raw.is_active,
            created_at: raw.created_at,
            updated_at: raw.updated_at,
            format_version: raw.format_version,
            ...dec,
          };
          decryptCacheRef.current.set(raw.id, acc);
          out.push(acc);
        } catch {
          // Row was encrypted with a different vault key — skip silently.
          // This happens when old sessions left orphaned rows in the DB.
        }
      }
      setAccounts(out);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load accounts");
    } finally {
      setLoading(false);
    }
  }, [user, isUnlocked, decryptText]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const createAccount = useCallback(
    async (connector: ConnectorType, draft: AccountDraft): Promise<string> => {
      if (!user) throw new Error("Not signed in");
      // Encrypt account fields individually using vault helpers (mek lives in context).
      const enc = {
        enc_name: await encryptText(draft.name),
        enc_type: await encryptText(draft.type),
        enc_currency: await encryptText(draft.currency),
        enc_institution: draft.institution ? await encryptText(draft.institution) : null,
        enc_balance: await encryptText(draft.balance),
        enc_metadata: draft.metadata ? await encryptText(JSON.stringify(draft.metadata)) : null,
      };
      // Phase 4.4: include household_id + HSK signature when active.
      const acctSig = buildHouseholdSignatureFields();
      const { data, error: e } = await accountsTable()
        .insert({
          user_id: user.id,
          connector_type: connector,
          ...enc,
          ...acctSig,
        })
        .select("id")
        .single();
      if (e || !data) throw new Error(e?.message ?? "Insert failed");
      const accountId = data.id as string;

      if (draft.credentials) {
        const encCreds = await encryptText(JSON.stringify(draft.credentials));
        await credsTable().insert({
          user_id: user.id,
          account_id: accountId,
          connector_type: connector,
          enc_credentials: encCreds,
        });
      }

      if (draft.seedTransactions && draft.seedTransactions.length > 0) {
        const hmacKey = getHmacKey();
        const rows: Record<string, unknown>[] = [];
        for (const t of draft.seedTransactions) {
          const encTxn = {
            enc_amount: await encryptText(t.amount),
            enc_description: await encryptText(t.description),
            enc_merchant: t.merchant ? await encryptText(t.merchant) : null,
            enc_category_id: t.category_id ? await encryptText(t.category_id) : null,
            enc_memo: t.memo ? await encryptText(t.memo) : null,
            enc_tags: t.tags && t.tags.length ? await encryptText(JSON.stringify(t.tags)) : null,
            enc_owner: null,
            hmac_merchant: t.merchant ? await blindIndexHmac(t.merchant, hmacKey) : null,
            hmac_category: t.category_id ? await blindIndexHmac(t.category_id, hmacKey) : null,
          };
          rows.push({
            user_id: user.id,
            account_id: accountId,
            date: t.date,
            ...encTxn,
            ...buildHouseholdSignatureFields(),
          });
        }
        // Insert in chunks of 100.
        for (let i = 0; i < rows.length; i += 100) {
          const chunk = rows.slice(i, i + 100);
          const { error: insertErr } = await txnsTable().insert(
            chunk as Database["public"]["Tables"]["transactions"]["Insert"][],
          );
          if (insertErr) throw new Error(insertErr.message);
        }
      }

      decryptCacheRef.current.delete(accountId);
      await refresh();
      return accountId;
    },
    [user, encryptText, getHmacKey, refresh, buildHouseholdSignatureFields],
  );

  const updateAccount = useCallback(
    async (
      id: string,
      patch: Partial<Pick<Account, "name" | "type" | "currency" | "institution" | "balance">>,
    ) => {
      const enc: Record<string, string | null> = {};
      if (patch.name !== undefined) enc.enc_name = await encryptText(patch.name);
      if (patch.type !== undefined) enc.enc_type = await encryptText(patch.type);
      if (patch.currency !== undefined) enc.enc_currency = await encryptText(patch.currency);
      if (patch.institution !== undefined)
        enc.enc_institution = patch.institution ? await encryptText(patch.institution) : null;
      if (patch.balance !== undefined) enc.enc_balance = await encryptText(patch.balance);
      if (Object.keys(enc).length === 0) return;
      Object.assign(enc, buildHouseholdSignatureFields());
      const { error: e } = await accountsTable()
        .update(enc as Database["public"]["Tables"]["accounts"]["Update"])
        .eq("id", id);
      if (e) throw new Error(e.message);
      decryptCacheRef.current.delete(id);
      await refresh();
    },
    [encryptText, refresh, buildHouseholdSignatureFields],
  );

  /**
   * Count active transactions on an account. Used by the delete dialog
   * to decide between "safe delete" (empty) and "archive vs permanent
   * delete" (non-empty).
   */
  const countTransactions = useCallback(async (id: string): Promise<number> => {
    const { count, error: e } = await txnsTable()
      .select("id", { count: "exact", head: true })
      .eq("account_id", id);
    if (e) throw new Error(e.message);
    return count ?? 0;
  }, []);

  /**
   * Archive an account: hides it from the active list (the refresh()
   * query filters on is_active = true) without losing transactions or
   * the account row itself. Reversible via restoreAccount.
   *
   * Recommended over deleteAccount for non-empty accounts. An earlier
   * iteration of this same flow replaced the move-and-delete then
   * nuke-account UX with archive after the move-then-delete path produced
   * too many edge cases. The is_active column is already in place; this
   * just exposes the toggle.
   */
  const archiveAccount = useCallback(
    async (id: string) => {
      const { error: e } = await accountsTable()
        .update({ is_active: false, ...buildHouseholdSignatureFields() })
        .eq("id", id);
      if (e) throw new Error(e.message);
      decryptCacheRef.current.delete(id);
      await refresh();
    },
    [refresh, buildHouseholdSignatureFields],
  );

  const restoreAccount = useCallback(
    async (id: string) => {
      const { error: e } = await accountsTable()
        .update({ is_active: true, ...buildHouseholdSignatureFields() })
        .eq("id", id);
      if (e) throw new Error(e.message);
      decryptCacheRef.current.delete(id);
      await refresh();
    },
    [refresh, buildHouseholdSignatureFields],
  );

  /**
   * Fetch the user's archived accounts on demand. The main `accounts`
   * state intentionally only holds active rows (refresh() filters on
   * is_active = true) so the dashboard, totals, and ledger views never
   * accidentally include archived data. This helper is for the
   * Accounts page's "Show archived" toggle.
   *
   * Returns decrypted accounts. Reuses the same per-row decrypt path
   * as refresh() — if a row was encrypted with a stale vault key it
   * is silently skipped, matching the active-list behaviour.
   */
  const listArchivedAccounts = useCallback(async (): Promise<Account[]> => {
    if (!user || !isUnlocked) return [];
    const { data, error: e } = await accountsTable()
      .select(
        "id, user_id, connector_type, is_active, created_at, updated_at, format_version, enc_name, enc_type, enc_currency, enc_institution, enc_balance, enc_metadata",
      )
      .eq("is_active", false)
      .order("created_at", { ascending: true });
    if (e) throw new Error(e.message);
    const out: Account[] = [];
    for (const raw of (data ?? []) as AccountRow[]) {
      try {
        const dec = {
          name: await decryptText(raw.enc_name),
          type: (await decryptText(raw.enc_type)) as AccountTypeKey,
          currency: await decryptText(raw.enc_currency),
          institution: raw.enc_institution ? await decryptText(raw.enc_institution) : null,
          balance: await decryptText(raw.enc_balance),
          metadata: raw.enc_metadata
            ? (JSON.parse(await decryptText(raw.enc_metadata)) as Record<string, unknown>)
            : null,
        };
        out.push({
          id: raw.id,
          user_id: raw.user_id,
          connector_type: raw.connector_type,
          is_active: raw.is_active,
          created_at: raw.created_at,
          updated_at: raw.updated_at,
          ...dec,
        });
      } catch {
        // Stale-key row — silently skipped, same as refresh().
      }
    }
    return out;
  }, [user, isUnlocked, decryptText]);

  /**
   * Hard-delete an account and ALL its transactions.
   *
   * For non-empty accounts the caller must explicitly opt in via
   * `force: true`. Without that flag, this throws AccountNotEmptyError
   * with the transaction count so the UI can offer archive instead.
   *
   * Default behaviour change (vs the previous always-cascade delete):
   * empty accounts delete cleanly; non-empty accounts require the user
   * to confirm a destructive action through the dialog flow rather than
   * losing transactions silently.
   */
  const deleteAccount = useCallback(
    async (id: string, opts: { force?: boolean } = {}) => {
      if (!opts.force) {
        const txCount = await countTransactions(id);
        if (txCount > 0) {
          throw new AccountNotEmptyError(txCount);
        }
      }
      // Delete child transactions first — accounts.id is referenced by
      // transactions.account_id via FK, so the account delete would
      // fail if transactions exist.
      await txnsTable().delete().eq("account_id", id);
      const { error: e } = await accountsTable().delete().eq("id", id);
      if (e) throw new Error(e.message);
      decryptCacheRef.current.delete(id);
      await refresh();
    },
    [countTransactions, refresh],
  );

  const refreshBalance = useCallback(
    async (id: string) => {
      const acc = accounts.find((a) => a.id === id);
      if (!acc) throw new Error("Account not found");
      const connector = getConnector(acc.connector_type);
      if (!connector.refreshBalance) throw new Error("This connector can't refresh balance.");
      const newBtc = await connector.refreshBalance(acc);
      const newBalance =
        acc.currency === "sats" ? Math.round(Number(newBtc) * 1e8).toString() : newBtc;
      await updateAccount(id, { balance: newBalance });
    },
    [accounts, updateAccount],
  );

  // Re-export so unused-imports stay live for tree-shake (these helpers are used elsewhere).
  void encryptAccount;
  void decryptAccount;
  void encryptTransaction;
  void cryptoEncryptText;

  return {
    accounts,
    loading,
    error,
    refresh,
    createAccount,
    updateAccount,
    deleteAccount,
    archiveAccount,
    restoreAccount,
    listArchivedAccounts,
    countTransactions,
    refreshBalance,
  };
}

/**
 * Thrown by deleteAccount when the account still has transactions and
 * the caller did not opt into a destructive cascade. Carries the count
 * so the UI can render "X transactions will be lost" copy + an archive
 * fallback button.
 */
export class AccountNotEmptyError extends Error {
  readonly transactionCount: number;
  constructor(transactionCount: number) {
    super(
      `Account has ${transactionCount} transaction${transactionCount === 1 ? "" : "s"}. ` +
        `Pass { force: true } to permanently delete, or call archiveAccount instead.`,
    );
    this.name = "AccountNotEmptyError";
    this.transactionCount = transactionCount;
  }
}

// Local helper — avoids pulling in the full vault.ts blindIndex which expects a CryptoKey.
async function blindIndexHmac(input: string, hmacKey: CryptoKey): Promise<string> {
  const sig = await crypto.subtle.sign(
    "HMAC",
    hmacKey,
    new TextEncoder().encode(input.trim().toLowerCase()),
  );
  const bytes = new Uint8Array(sig);
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}
