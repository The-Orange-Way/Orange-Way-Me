/**
 * useTransactions — primary data hook for the Transactions page.
 *
 * Fetches encrypted rows for a date range, decrypts in batches, and exposes
 * CRUD + split + transfer helpers. All plaintext is held only in component
 * state; the database only ever sees ciphertext + blind-index HMACs.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { useAuth } from "@/context/AuthContext";
import { useVault } from "@/context/VaultContext";
import { blindIndexHmac } from "@/lib/blind-index";

export interface DecryptedTxn {
  id: string;
  account_id: string;
  date: string;
  amount: string;
  currency: string;
  description: string;
  merchant: string | null;
  category_id: string | null;
  memo: string | null;
  tags: string[] | null;
  is_split_parent: boolean;
  split_parent_id: string | null;
  transfer_group_id: string | null;
  is_manual_category: boolean;
  updated_at: string;
}

export interface TxnDraft {
  date: string;
  account_id: string;
  amount: string;
  currency?: string;
  description: string;
  merchant?: string | null;
  category_id?: string | null;
  memo?: string | null;
  tags?: string[] | null;
  /** True when the category came from explicit user action. Locks the rule
   *  engine out of overwriting this transaction's category on re-run. */
  is_manual_category?: boolean;
}

export interface TransferDraft {
  date: string;
  fromAccountId: string;
  toAccountId: string;
  amount: string; // positive number; we mirror sign
  description: string;
  category_id?: string | null;
  memo?: string | null;
}

export interface SplitChild {
  amount: string;
  description: string;
  category_id?: string | null;
}

interface RawRow {
  id: string;
  account_id: string;
  date: string;
  enc_amount: string;
  enc_currency: string | null;
  enc_description: string;
  enc_merchant: string | null;
  enc_category_id: string | null;
  enc_memo: string | null;
  enc_tags: string | null;
  is_split_parent: boolean;
  split_parent_id: string | null;
  transfer_group_id: string | null;
  is_manual_category: boolean | null;
  updated_at: string;
}

const txnsTable = () => supabase.from("transactions");

const BATCH = 50;

async function decryptInBatches(
  rows: RawRow[],
  decryptText: (s: string) => Promise<string>,
): Promise<DecryptedTxn[]> {
  const out: DecryptedTxn[] = [];
  for (let i = 0; i < rows.length; i += BATCH) {
    const slice = rows.slice(i, i + BATCH);
    const decoded = await Promise.allSettled(
      slice.map(async (raw) => {
        const tagsJson = raw.enc_tags ? await decryptText(raw.enc_tags) : null;
        return {
          id: raw.id,
          account_id: raw.account_id,
          date: raw.date,
          amount: await decryptText(raw.enc_amount),
          currency: raw.enc_currency ? await decryptText(raw.enc_currency) : "",
          description: await decryptText(raw.enc_description),
          merchant: raw.enc_merchant ? await decryptText(raw.enc_merchant) : null,
          category_id: raw.enc_category_id ? await decryptText(raw.enc_category_id) : null,
          memo: raw.enc_memo ? await decryptText(raw.enc_memo) : null,
          tags: tagsJson ? (JSON.parse(tagsJson) as string[]) : null,
          is_split_parent: raw.is_split_parent,
          split_parent_id: raw.split_parent_id,
          transfer_group_id: raw.transfer_group_id,
          is_manual_category: !!raw.is_manual_category,
          updated_at: raw.updated_at,
        };
      }),
    );
    for (const result of decoded) {
      // Skip rows encrypted with a different vault key (orphaned from prior sessions).
      if (result.status === "fulfilled") out.push(result.value);
    }
  }
  return out;
}

export function useTransactions(opts: {
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
}) {
  const { startDate, endDate } = opts;
  const { user } = useAuth();
  const { isUnlocked, encryptText, decryptText, getHmacKey, buildHouseholdSignatureFields } =
    useVault();
  const [items, setItems] = useState<DecryptedTxn[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const cacheRef = useRef<Map<string, DecryptedTxn>>(new Map());

  const refresh = useCallback(async () => {
    if (!user || !isUnlocked) {
      setItems([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { data, error: e } = await txnsTable()
        .select(
          "id, account_id, date, enc_amount, enc_currency, enc_description, enc_merchant, enc_category_id, enc_memo, enc_tags, is_split_parent, split_parent_id, transfer_group_id, is_manual_category, updated_at",
        )
        .gte("date", startDate)
        .lte("date", endDate)
        .order("date", { ascending: false })
        .limit(10_000);
      if (e) throw e;

      const rows = (data ?? []) as RawRow[];
      // Use cache where updated_at matches.
      const toDecrypt: RawRow[] = [];
      const indexMap = new Map<string, number>();
      const interim: (DecryptedTxn | null)[] = rows.map((r) => {
        const cached = cacheRef.current.get(r.id);
        if (cached && cached.updated_at === r.updated_at) return cached;
        return null;
      });
      rows.forEach((r, i) => {
        if (interim[i] === null) {
          indexMap.set(r.id, i);
          toDecrypt.push(r);
        }
      });
      const decrypted = await decryptInBatches(toDecrypt, decryptText);
      decrypted.forEach((d) => {
        cacheRef.current.set(d.id, d);
        const idx = indexMap.get(d.id);
        if (idx !== undefined) interim[idx] = d;
      });
      setItems(interim.filter((x): x is DecryptedTxn => x !== null));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load transactions");
    } finally {
      setLoading(false);
    }
  }, [user, isUnlocked, decryptText, startDate, endDate]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const buildEncryptedRow = useCallback(
    async (
      draft: TxnDraft,
      extras: {
        is_split_parent?: boolean;
        split_parent_id?: string | null;
        transfer_group_id?: string | null;
      } = {},
    ) => {
      if (!user) throw new Error("Not signed in");
      const hmacKey = getHmacKey();
      // Phase 4.4: include household_id + ML-DSA-65 signature columns
      // when the row is bound to an active household. Falls back to all
      // NULLs for solo users — the server trigger short-circuits when
      // household_id IS NULL.
      const sigFields = buildHouseholdSignatureFields();
      return {
        user_id: user.id,
        account_id: draft.account_id,
        date: draft.date,
        enc_amount: await encryptText(draft.amount),
        enc_currency: draft.currency ? await encryptText(draft.currency) : null,
        enc_description: await encryptText(draft.description),
        enc_merchant: draft.merchant ? await encryptText(draft.merchant) : null,
        enc_category_id: draft.category_id ? await encryptText(draft.category_id) : null,
        enc_memo: draft.memo ? await encryptText(draft.memo) : null,
        enc_tags:
          draft.tags && draft.tags.length > 0
            ? await encryptText(JSON.stringify(draft.tags))
            : null,
        hmac_merchant: draft.merchant ? await blindIndexHmac(draft.merchant, hmacKey) : null,
        hmac_category: draft.category_id ? await blindIndexHmac(draft.category_id, hmacKey) : null,
        is_split_parent: extras.is_split_parent ?? false,
        split_parent_id: extras.split_parent_id ?? null,
        transfer_group_id: extras.transfer_group_id ?? null,
        is_manual_category: draft.is_manual_category ?? false,
        ...sigFields,
      };
    },
    [user, encryptText, getHmacKey, buildHouseholdSignatureFields],
  );

  const createTransaction = useCallback(
    async (draft: TxnDraft) => {
      const row = await buildEncryptedRow(draft);
      const { error: e } = await txnsTable().insert(row);
      if (e) throw new Error(e.message);
      await refresh();
    },
    [buildEncryptedRow, refresh],
  );

  /**
   * Encrypt N drafts and insert them as a single Supabase batch. Used by
   * CSV import; one .insert() means one refresh at the end rather than
   * N round-trips. Per-row encrypt is sequential because the deterministic
   * HMAC needs the same key throughout — that's CPU-bound, not network,
   * and runs entirely in-process.
   */
  const bulkCreateTransactions = useCallback(
    async (drafts: TxnDraft[]) => {
      if (drafts.length === 0) return;
      const rows = await Promise.all(drafts.map((d) => buildEncryptedRow(d)));
      const { error: e } = await txnsTable().insert(rows);
      if (e) throw new Error(e.message);
      await refresh();
    },
    [buildEncryptedRow, refresh],
  );

  const createTransfer = useCallback(
    async (draft: TransferDraft) => {
      if (!user) throw new Error("Not signed in");
      if (draft.fromAccountId === draft.toAccountId) throw new Error("Pick two different accounts");
      const groupId = crypto.randomUUID();
      const amt = Math.abs(Number(draft.amount));
      if (!Number.isFinite(amt) || amt <= 0) throw new Error("Amount must be a positive number");
      const desc = draft.description || "Transfer";
      const out = await buildEncryptedRow(
        {
          date: draft.date,
          account_id: draft.fromAccountId,
          amount: (-amt).toString(),
          description: desc,
          category_id: draft.category_id ?? null,
          memo: draft.memo ?? null,
        },
        { transfer_group_id: groupId },
      );
      const inn = await buildEncryptedRow(
        {
          date: draft.date,
          account_id: draft.toAccountId,
          amount: amt.toString(),
          description: desc,
          category_id: draft.category_id ?? null,
          memo: draft.memo ?? null,
        },
        { transfer_group_id: groupId },
      );
      const { error: e } = await txnsTable().insert([out, inn]);
      if (e) throw new Error(e.message);
      await refresh();
    },
    [user, buildEncryptedRow, refresh],
  );

  const updateTransaction = useCallback(
    async (id: string, draft: TxnDraft) => {
      if (!user) throw new Error("Not signed in");
      const hmacKey = getHmacKey();
      const enc: Record<string, unknown> = {
        account_id: draft.account_id,
        date: draft.date,
        enc_amount: await encryptText(draft.amount),
        enc_description: await encryptText(draft.description),
        enc_merchant: draft.merchant ? await encryptText(draft.merchant) : null,
        enc_category_id: draft.category_id ? await encryptText(draft.category_id) : null,
        enc_memo: draft.memo ? await encryptText(draft.memo) : null,
        enc_tags:
          draft.tags && draft.tags.length > 0
            ? await encryptText(JSON.stringify(draft.tags))
            : null,
        hmac_merchant: draft.merchant ? await blindIndexHmac(draft.merchant, hmacKey) : null,
        hmac_category: draft.category_id ? await blindIndexHmac(draft.category_id, hmacKey) : null,
      };
      if (draft.is_manual_category !== undefined) {
        enc.is_manual_category = draft.is_manual_category;
      }
      // Phase 4.4: refresh the row's signature on every UPDATE — the
      // server trigger re-verifies on every write, not just inserts.
      Object.assign(enc, buildHouseholdSignatureFields());
      const { error: e } = await txnsTable()
        .update(enc as Database["public"]["Tables"]["transactions"]["Update"])
        .eq("id", id);
      if (e) throw new Error(e.message);
      cacheRef.current.delete(id);
      await refresh();
    },
    [user, encryptText, getHmacKey, refresh, buildHouseholdSignatureFields],
  );

  const deleteTransaction = useCallback(
    async (id: string) => {
      // Cascading deletes: if it's a transfer, delete the pair. If it's a
      // split parent, delete its children.
      const cached = cacheRef.current.get(id);
      const idsToDelete: string[] = [id];
      if (cached?.transfer_group_id) {
        const { data } = await txnsTable()
          .select("id")
          .eq("transfer_group_id", cached.transfer_group_id);
        for (const r of (data ?? []) as Array<{ id: string }>) {
          if (!idsToDelete.includes(r.id)) idsToDelete.push(r.id);
        }
      }
      if (cached?.is_split_parent) {
        const { data } = await txnsTable().select("id").eq("split_parent_id", id);
        for (const r of (data ?? []) as Array<{ id: string }>) {
          if (!idsToDelete.includes(r.id)) idsToDelete.push(r.id);
        }
      }
      const { error: e } = await txnsTable().delete().in("id", idsToDelete);
      if (e) throw new Error(e.message);
      idsToDelete.forEach((d) => cacheRef.current.delete(d));
      await refresh();
    },
    [refresh],
  );

  const splitTransaction = useCallback(
    async (parentId: string, children: SplitChild[]) => {
      if (!user) throw new Error("Not signed in");
      const parent = cacheRef.current.get(parentId) ?? items.find((t) => t.id === parentId);
      if (!parent) throw new Error("Parent transaction not found");
      const sumChildren = children.reduce((acc, c) => acc + Number(c.amount), 0);
      const parentAmt = Number(parent.amount);
      if (Math.abs(sumChildren - parentAmt) > 0.01)
        throw new Error("Split totals must match the parent amount");

      const rows: Record<string, unknown>[] = [];
      for (const c of children) {
        const row = await buildEncryptedRow(
          {
            date: parent.date,
            account_id: parent.account_id,
            amount: c.amount,
            description: c.description || parent.description,
            merchant: parent.merchant,
            category_id: c.category_id ?? null,
          },
          { split_parent_id: parentId },
        );
        rows.push(row);
      }
      const { error: insErr } = await txnsTable().insert(
        rows as Database["public"]["Tables"]["transactions"]["Insert"][],
      );
      if (insErr) throw new Error(insErr.message);
      const { error: upErr } = await txnsTable()
        .update({ is_split_parent: true, ...buildHouseholdSignatureFields() })
        .eq("id", parentId);
      if (upErr) throw new Error(upErr.message);
      cacheRef.current.delete(parentId);
      await refresh();
    },
    [user, items, buildEncryptedRow, refresh, buildHouseholdSignatureFields],
  );

  const bulkSetCategory = useCallback(
    async (ids: string[], categoryId: string) => {
      const hmacKey = getHmacKey();
      const enc_category_id = await encryptText(categoryId);
      const hmac_category = await blindIndexHmac(categoryId, hmacKey);
      const { error: e } = await txnsTable()
        .update({ enc_category_id, hmac_category, ...buildHouseholdSignatureFields() })
        .in("id", ids);
      if (e) throw new Error(e.message);
      ids.forEach((d) => cacheRef.current.delete(d));
      await refresh();
    },
    [encryptText, getHmacKey, refresh, buildHouseholdSignatureFields],
  );

  const bulkDelete = useCallback(
    async (ids: string[]) => {
      const { error: e } = await txnsTable().delete().in("id", ids);
      if (e) throw new Error(e.message);
      ids.forEach((d) => cacheRef.current.delete(d));
      await refresh();
    },
    [refresh],
  );

  // Merge a tag into each selected transaction's encrypted tag array.
  // Reads current encrypted tags per row, adds the new tag if absent, re-encrypts.
  const bulkAddTag = useCallback(
    async (ids: string[], newTag: string) => {
      const trimmed = newTag.trim();
      if (!trimmed || ids.length === 0) return;
      const { data, error: fetchErr } = await txnsTable().select("id, enc_tags").in("id", ids);
      if (fetchErr) throw new Error(fetchErr.message);
      for (const row of (data ?? []) as Array<{ id: string; enc_tags: string | null }>) {
        const existing: string[] = row.enc_tags
          ? (JSON.parse(await decryptText(row.enc_tags)) as string[])
          : [];
        if (existing.includes(trimmed)) continue;
        const merged = [...existing, trimmed];
        const enc = await encryptText(JSON.stringify(merged));
        const { error: upErr } = await txnsTable()
          .update({ enc_tags: enc, ...buildHouseholdSignatureFields() })
          .eq("id", row.id);
        if (upErr) throw new Error(upErr.message);
        cacheRef.current.delete(row.id);
      }
      await refresh();
    },
    [decryptText, encryptText, refresh, buildHouseholdSignatureFields],
  );

  // Search by merchant via blind index — exposed as helper for the search box.
  const searchByMerchant = useCallback(
    async (term: string): Promise<DecryptedTxn[]> => {
      if (!user || !term) return [];
      const hmacKey = getHmacKey();
      const hmac = await blindIndexHmac(term, hmacKey);
      const { data, error: e } = await txnsTable()
        .select(
          "id, account_id, date, enc_amount, enc_currency, enc_description, enc_merchant, enc_category_id, enc_memo, enc_tags, is_split_parent, split_parent_id, transfer_group_id, is_manual_category, updated_at",
        )
        .eq("hmac_merchant", hmac)
        .order("date", { ascending: false })
        .limit(500);
      if (e) throw new Error(e.message);
      return decryptInBatches((data ?? []) as RawRow[], decryptText);
    },
    [user, getHmacKey, decryptText],
  );

  const totals = useMemo(() => {
    let inflow = 0;
    let outflow = 0;
    for (const t of items) {
      // Skip split children — the parent row carries the authoritative bank
      // amount; children are internal breakdowns. Summing both would double-count.
      if (t.split_parent_id) continue;
      const n = Number(t.amount);
      if (n >= 0) inflow += n;
      else outflow += n;
    }
    return { inflow, outflow, net: inflow + outflow };
  }, [items]);

  return {
    items,
    loading,
    error,
    refresh,
    totals,
    createTransaction,
    bulkCreateTransactions,
    createTransfer,
    updateTransaction,
    deleteTransaction,
    splitTransaction,
    bulkSetCategory,
    bulkDelete,
    bulkAddTag,
    searchByMerchant,
  };
}
