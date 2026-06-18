/**
 * useGoals — fetch + decrypt the user's goals, plus CRUD helpers.
 *
 * Goals are stored encrypted in `goals`. The plaintext fields are:
 *   - id, user_id, household_id, is_completed, created_at, updated_at
 * Everything else is enc_*. JSON shapes are stringified before encryption.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { useAuth } from "@/context/AuthContext";
import { useVault } from "@/context/VaultContext";

export type GoalType = "save_up" | "pay_down";
export type SaveUpStrategy = "all_balance" | "specific_amount";
export type PayDownStrategy = "avalanche" | "snowball";

export interface Goal {
  id: string;
  user_id: string;
  type: GoalType;
  name: string;
  target_amount: string;
  current_amount: string; // last persisted snapshot — actual current is computed live
  starting_balance: string | null;
  interest_rate: string | null; // APR as percent string ("4.5")
  minimum_payment: string | null;
  target_date: string | null; // YYYY-MM-DD
  linked_account_ids: string[];
  strategy: SaveUpStrategy | PayDownStrategy | null;
  manual_allocation: string | null; // for save_up + specific_amount
  is_completed: boolean;
  created_at: string;
  updated_at: string;
}

export interface GoalDraft {
  type: GoalType;
  name: string;
  target_amount: string;
  starting_balance?: string | null;
  interest_rate?: string | null;
  minimum_payment?: string | null;
  target_date?: string | null;
  linked_account_ids: string[];
  strategy: SaveUpStrategy | PayDownStrategy | null;
  manual_allocation?: string | null;
  is_completed?: boolean;
}

interface RawGoalRow {
  id: string;
  user_id: string;
  is_completed: boolean;
  created_at: string;
  updated_at: string;
  enc_name: string;
  enc_type: string;
  enc_target_amount: string;
  enc_current_amount: string;
  enc_target_date: string | null;
  enc_linked_account_ids: string | null;
  enc_strategy: string | null;
  enc_starting_balance: string | null;
  enc_interest_rate: string | null;
  enc_minimum_payment: string | null;
  enc_manual_allocation: string | null;
}

const goalsTable = () => supabase.from("goals");

export function useGoals() {
  const { user } = useAuth();
  const { isUnlocked, encryptText, decryptText, buildHouseholdSignatureFields } = useVault();
  const [goals, setGoals] = useState<Goal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const cacheRef = useRef<Map<string, Goal>>(new Map());

  const refresh = useCallback(async () => {
    if (!user || !isUnlocked) {
      setGoals([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { data, error: e } = await goalsTable()
        .select(
          "id, user_id, is_completed, created_at, updated_at, enc_name, enc_type, enc_target_amount, enc_current_amount, enc_target_date, enc_linked_account_ids, enc_strategy, enc_starting_balance, enc_interest_rate, enc_minimum_payment, enc_manual_allocation",
        )
        .order("created_at", { ascending: true });
      if (e) throw e;

      const out: Goal[] = [];
      for (const raw of (data ?? []) as RawGoalRow[]) {
        try {
          const cached = cacheRef.current.get(raw.id);
          if (cached && cached.updated_at === raw.updated_at) {
            out.push(cached);
            continue;
          }
          const goal: Goal = {
            id: raw.id,
            user_id: raw.user_id,
            is_completed: raw.is_completed,
            created_at: raw.created_at,
            updated_at: raw.updated_at,
            name: await decryptText(raw.enc_name),
            type: (await decryptText(raw.enc_type)) as GoalType,
            target_amount: await decryptText(raw.enc_target_amount),
            current_amount: await decryptText(raw.enc_current_amount),
            target_date: raw.enc_target_date ? await decryptText(raw.enc_target_date) : null,
            linked_account_ids: raw.enc_linked_account_ids
              ? (JSON.parse(await decryptText(raw.enc_linked_account_ids)) as string[])
              : [],
            strategy: raw.enc_strategy
              ? ((await decryptText(raw.enc_strategy)) as SaveUpStrategy | PayDownStrategy)
              : null,
            starting_balance: raw.enc_starting_balance
              ? await decryptText(raw.enc_starting_balance)
              : null,
            interest_rate: raw.enc_interest_rate ? await decryptText(raw.enc_interest_rate) : null,
            minimum_payment: raw.enc_minimum_payment
              ? await decryptText(raw.enc_minimum_payment)
              : null,
            manual_allocation: raw.enc_manual_allocation
              ? await decryptText(raw.enc_manual_allocation)
              : null,
          };
          cacheRef.current.set(raw.id, goal);
          out.push(goal);
        } catch {
          // Row encrypted with a different vault key — skip silently.
        }
      }
      setGoals(out);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load goals");
    } finally {
      setLoading(false);
    }
  }, [user, isUnlocked, decryptText]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const buildEncrypted = useCallback(
    async (draft: GoalDraft) => {
      return {
        enc_name: await encryptText(draft.name),
        enc_type: await encryptText(draft.type),
        enc_target_amount: await encryptText(draft.target_amount),
        enc_current_amount: await encryptText("0"),
        enc_target_date: draft.target_date ? await encryptText(draft.target_date) : null,
        enc_linked_account_ids: await encryptText(JSON.stringify(draft.linked_account_ids ?? [])),
        enc_strategy: draft.strategy ? await encryptText(draft.strategy) : null,
        enc_starting_balance: draft.starting_balance
          ? await encryptText(draft.starting_balance)
          : null,
        enc_interest_rate: draft.interest_rate ? await encryptText(draft.interest_rate) : null,
        enc_minimum_payment: draft.minimum_payment
          ? await encryptText(draft.minimum_payment)
          : null,
        enc_manual_allocation: draft.manual_allocation
          ? await encryptText(draft.manual_allocation)
          : null,
      };
    },
    [encryptText],
  );

  const createGoal = useCallback(
    async (draft: GoalDraft) => {
      if (!user) throw new Error("Not signed in");
      const enc = await buildEncrypted(draft);
      const { error: e } = await goalsTable().insert({
        user_id: user.id,
        is_completed: draft.is_completed ?? false,
        ...enc,
        ...buildHouseholdSignatureFields(),
      });
      if (e) throw new Error(e.message);
      await refresh();
    },
    [user, buildEncrypted, refresh, buildHouseholdSignatureFields],
  );

  const updateGoal = useCallback(
    async (id: string, patch: Partial<GoalDraft>) => {
      const upd: Record<string, unknown> = {};
      if (patch.name !== undefined) upd.enc_name = await encryptText(patch.name);
      if (patch.type !== undefined) upd.enc_type = await encryptText(patch.type);
      if (patch.target_amount !== undefined)
        upd.enc_target_amount = await encryptText(patch.target_amount);
      if (patch.target_date !== undefined)
        upd.enc_target_date = patch.target_date ? await encryptText(patch.target_date) : null;
      if (patch.linked_account_ids !== undefined)
        upd.enc_linked_account_ids = await encryptText(JSON.stringify(patch.linked_account_ids));
      if (patch.strategy !== undefined)
        upd.enc_strategy = patch.strategy ? await encryptText(patch.strategy) : null;
      if (patch.starting_balance !== undefined)
        upd.enc_starting_balance = patch.starting_balance
          ? await encryptText(patch.starting_balance)
          : null;
      if (patch.interest_rate !== undefined)
        upd.enc_interest_rate = patch.interest_rate ? await encryptText(patch.interest_rate) : null;
      if (patch.minimum_payment !== undefined)
        upd.enc_minimum_payment = patch.minimum_payment
          ? await encryptText(patch.minimum_payment)
          : null;
      if (patch.manual_allocation !== undefined)
        upd.enc_manual_allocation = patch.manual_allocation
          ? await encryptText(patch.manual_allocation)
          : null;
      if (patch.is_completed !== undefined) upd.is_completed = patch.is_completed;
      if (Object.keys(upd).length === 0) return;
      Object.assign(upd, buildHouseholdSignatureFields());
      const { error: e } = await goalsTable()
        .update(upd as Database["public"]["Tables"]["goals"]["Update"])
        .eq("id", id);
      if (e) throw new Error(e.message);
      cacheRef.current.delete(id);
      await refresh();
    },
    [encryptText, refresh, buildHouseholdSignatureFields],
  );

  const deleteGoal = useCallback(
    async (id: string) => {
      const { error: e } = await goalsTable().delete().eq("id", id);
      if (e) throw new Error(e.message);
      cacheRef.current.delete(id);
      await refresh();
    },
    [refresh],
  );

  return { goals, loading, error, refresh, createGoal, updateGoal, deleteGoal };
}
