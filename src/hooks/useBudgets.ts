/**
 * useBudgets — fetch, decrypt, and mutate the encrypted budget for a single
 * month. Two coexisting modes per month: "flex" (3 buckets) and "category"
 * (per-category targets with optional rollover). The DB only ever sees
 * ciphertext for `enc_mode` and `enc_data`; `month` is plaintext (DATE) so
 * we can `.eq()` it.
 */
import { useCallback, useEffect, useState } from "react";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { useVault } from "@/context/VaultContext";
import type { DecryptedCategory } from "@/hooks/useCategories";

export type BudgetMode = "flex" | "category";

export type FlexBucketKey = "essentials" | "wants" | "savings";

export interface FlexBudgetData {
  mode: "flex";
  buckets: Record<FlexBucketKey, { target: number; mode: "amount" }>;
  /** category_id -> bucket key. Categories not listed default to "essentials". */
  categoryBucketMap: Record<string, FlexBucketKey>;
  incomeTarget: number;
}

export interface CategoryBudgetData {
  mode: "category";
  categories: Record<string, { target: number; rollover: boolean }>;
  incomeTarget: number;
  zeroBased: boolean;
}

export type BudgetData = FlexBudgetData | CategoryBudgetData;

export interface BudgetRecord {
  id: string;
  month: string; // YYYY-MM-01
  mode: BudgetMode;
  data: BudgetData;
  updated_at: string;
}

const budgetsTable = () => supabase.from("budgets");

/** Format a Date into the DB's first-of-month string. */
export function monthKey(d: Date): string {
  return format(new Date(d.getFullYear(), d.getMonth(), 1), "yyyy-MM-dd");
}

/** Fresh skeleton for a brand-new flex budget. */
export function emptyFlexData(): FlexBudgetData {
  return {
    mode: "flex",
    buckets: {
      essentials: { target: 0, mode: "amount" },
      wants: { target: 0, mode: "amount" },
      savings: { target: 0, mode: "amount" },
    },
    categoryBucketMap: {},
    incomeTarget: 0,
  };
}

export function emptyCategoryData(): CategoryBudgetData {
  return {
    mode: "category",
    categories: {},
    incomeTarget: 0,
    zeroBased: false,
  };
}

/**
 * Auto-suggest a categoryBucketMap from the user's categories. Uses the
 * top-level parent name as the heuristic — same name buckets even when the
 * user customizes a sub-category.
 */
export function suggestCategoryBucketMap(
  categories: DecryptedCategory[],
): Record<string, FlexBucketKey> {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const rootName = (c: DecryptedCategory): string => {
    let cur: DecryptedCategory | undefined = c;
    const seen = new Set<string>();
    while (cur && cur.parent_id && byId.has(cur.parent_id) && !seen.has(cur.id)) {
      seen.add(cur.id);
      cur = byId.get(cur.parent_id);
    }
    return cur?.name ?? c.name;
  };
  const map: Record<string, FlexBucketKey> = {};
  for (const c of categories) {
    if (c.type === "income" || c.type === "transfer") continue;
    const root = rootName(c);
    if (
      root === "Housing" ||
      root === "Food & Drink" ||
      root === "Transportation" ||
      root === "Health"
    ) {
      map[c.id] = "essentials";
    } else if (root === "Entertainment" || root === "Shopping" || root === "Travel") {
      map[c.id] = "wants";
    } else if (root === "Financial" || root === "Bitcoin") {
      map[c.id] = "savings";
    } else {
      map[c.id] = "essentials"; // Uncategorized + anything else
    }
  }
  return map;
}

interface RawBudgetRow {
  id: string;
  month: string;
  enc_mode: string;
  enc_data: string;
  updated_at: string;
}

export function useBudget(monthAnchor: Date) {
  const { user } = useAuth();
  const { isUnlocked, encryptText, decryptText, buildHouseholdSignatureFields } = useVault();
  const [budget, setBudget] = useState<BudgetRecord | null>(null);
  const [previousBudget, setPreviousBudget] = useState<BudgetRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const month = monthKey(monthAnchor);
  const prevMonth = monthKey(new Date(monthAnchor.getFullYear(), monthAnchor.getMonth() - 1, 1));

  const decryptRow = useCallback(
    async (raw: RawBudgetRow): Promise<BudgetRecord> => {
      const mode = (await decryptText(raw.enc_mode)) as BudgetMode;
      const data = JSON.parse(await decryptText(raw.enc_data)) as BudgetData;
      return { id: raw.id, month: raw.month, mode, data, updated_at: raw.updated_at };
    },
    [decryptText],
  );

  const refresh = useCallback(async () => {
    if (!user || !isUnlocked) {
      setBudget(null);
      setPreviousBudget(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { data, error: e } = await budgetsTable()
        .select("id, month, enc_mode, enc_data, updated_at")
        .in("month", [month, prevMonth]);
      if (e) throw e;
      const rows = (data ?? []) as RawBudgetRow[];
      const cur = rows.find((r) => r.month === month) ?? null;
      const prev = rows.find((r) => r.month === prevMonth) ?? null;
      setBudget(cur ? await decryptRow(cur) : null);
      setPreviousBudget(prev ? await decryptRow(prev) : null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load budget");
    } finally {
      setLoading(false);
    }
  }, [user, isUnlocked, month, prevMonth, decryptRow]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /** Upsert the current month's budget (insert if new, update if existing). */
  const save = useCallback(
    async (mode: BudgetMode, data: BudgetData): Promise<void> => {
      if (!user) throw new Error("Not signed in");
      const enc_mode = await encryptText(mode);
      const enc_data = await encryptText(JSON.stringify(data));
      const sig = buildHouseholdSignatureFields();
      if (budget) {
        const { error: e } = await budgetsTable()
          .update({ enc_mode, enc_data, ...sig })
          .eq("id", budget.id);
        if (e) throw new Error(e.message);
      } else {
        const { error: e } = await budgetsTable().insert({
          user_id: user.id,
          month,
          enc_mode,
          enc_data,
          ...sig,
        });
        if (e) throw new Error(e.message);
      }
      await refresh();
    },
    [user, encryptText, budget, month, refresh, buildHouseholdSignatureFields],
  );

  /** Replace the current month's budget with a fresh skeleton in the new mode. */
  const switchMode = useCallback(
    async (newMode: BudgetMode, seedData?: BudgetData) => {
      const data = seedData ?? (newMode === "flex" ? emptyFlexData() : emptyCategoryData());
      await save(newMode, data);
    },
    [save],
  );

  /** Duplicate the previous month's budget verbatim into the current month. */
  const copyFromLastMonth = useCallback(async () => {
    if (!previousBudget) throw new Error("No previous month budget to copy from");
    await save(previousBudget.mode, previousBudget.data);
  }, [previousBudget, save]);

  return {
    month,
    budget,
    previousBudget,
    loading,
    error,
    refresh,
    save,
    switchMode,
    copyFromLastMonth,
  };
}

/** Lightweight read-only single-month fetch — used by the txn-detail hint. */
export function useBudgetForMonth(monthAnchor: Date | null) {
  const { user } = useAuth();
  const { isUnlocked, decryptText } = useVault();
  const [budget, setBudget] = useState<BudgetRecord | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!user || !isUnlocked || !monthAnchor) {
        setBudget(null);
        return;
      }
      const m = monthKey(monthAnchor);
      const { data } = await budgetsTable()
        .select("id, month, enc_mode, enc_data, updated_at")
        .eq("month", m)
        .maybeSingle();
      if (!data || cancelled) {
        if (!cancelled) setBudget(null);
        return;
      }
      try {
        const raw = data as RawBudgetRow;
        const mode = (await decryptText(raw.enc_mode)) as BudgetMode;
        const parsed = JSON.parse(await decryptText(raw.enc_data)) as BudgetData;
        if (!cancelled)
          setBudget({
            id: raw.id,
            month: raw.month,
            mode,
            data: parsed,
            updated_at: raw.updated_at,
          });
      } catch {
        if (!cancelled) setBudget(null);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [user, isUnlocked, monthAnchor?.getFullYear(), monthAnchor?.getMonth(), decryptText]);

  return budget;
}
