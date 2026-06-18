/**
 * useAccountTransactions — fetch + decrypt all transactions for one account.
 * Used by WalletStatementSheet and the account detail page.
 */
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useVault } from "@/context/VaultContext";

export interface DecryptedTransaction {
  id: string;
  account_id: string;
  date: string;
  amount: string;
  /** Per-transaction currency — "sats", "BTC", "USD", etc.
   *  Null when the column was not set at import time; callers fall back to
   *  the account's currency in that case. */
  currency: string | null;
  description: string;
  merchant?: string | null;
  memo?: string | null;
  category_id?: string | null;
  /** Reconciliation state. NULL = unreconciled, 'cleared' = user-flagged,
   *  'reconciled' = included in a completed reconciliation batch. */
  cleared_status: string | null;
}

const txnsTable = () => supabase.from("transactions");

export function useAccountTransactions(accountId: string | undefined) {
  const { isUnlocked, decryptText } = useVault();
  const [items, setItems] = useState<DecryptedTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!accountId || !isUnlocked) {
      setItems([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { data, error: e } = await txnsTable()
        .select(
          "id, account_id, date, enc_amount, enc_currency, enc_description, enc_merchant, enc_memo, enc_category_id, cleared_status",
        )
        .eq("account_id", accountId)
        .order("date", { ascending: false })
        .limit(500);
      if (e) throw e;

      const out: DecryptedTransaction[] = [];
      for (const raw of (data ?? []) as Array<{
        id: string;
        account_id: string;
        date: string;
        enc_amount: string;
        enc_currency: string | null;
        enc_description: string;
        enc_merchant: string | null;
        enc_memo: string | null;
        enc_category_id: string | null;
        cleared_status: string | null;
      }>) {
        out.push({
          id: raw.id,
          account_id: raw.account_id,
          date: raw.date,
          amount: await decryptText(raw.enc_amount),
          currency: raw.enc_currency ? await decryptText(raw.enc_currency) : null,
          description: await decryptText(raw.enc_description),
          merchant: raw.enc_merchant ? await decryptText(raw.enc_merchant) : null,
          memo: raw.enc_memo ? await decryptText(raw.enc_memo) : null,
          category_id: raw.enc_category_id ? await decryptText(raw.enc_category_id) : null,
          cleared_status: raw.cleared_status ?? null,
        });
      }
      setItems(out);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load transactions");
    } finally {
      setLoading(false);
    }
  }, [accountId, isUnlocked, decryptText]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { items, loading, error, refresh };
}
