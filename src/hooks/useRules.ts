/**
 * useRules — fetch + decrypt the user's rules, provide CRUD, and expose an
 * `apply` helper that runs the current rule set against a transaction draft.
 *
 * Rules are stored encrypted (enc_name, enc_conditions, enc_actions) with
 * plaintext scheduling fields (match_mode, is_enabled, sort_order). The
 * engine logic itself lives in src/lib/rules/engine.ts — this hook is just
 * storage + wiring.
 */
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { useAuth } from "@/context/AuthContext";
import { useVault } from "@/context/VaultContext";
import type { MatchMode, Rule, RuleAction, RuleCondition } from "@/lib/rules/types";
import { applyRulesToTransaction } from "@/lib/rules/engine";
import type { RuleTxnDraft } from "@/lib/rules/types";

const rulesTable = () => supabase.from("rules");

interface RawRuleRow {
  id: string;
  enc_name: string;
  enc_conditions: string;
  enc_actions: string;
  match_mode: string;
  is_enabled: boolean;
  sort_order: number;
  last_fired_at: string | null;
  fire_count: number;
}

export interface RuleDraft {
  name: string;
  match_mode: MatchMode;
  conditions: RuleCondition[];
  actions: RuleAction[];
  is_enabled?: boolean;
}

export function useRules() {
  const { user } = useAuth();
  const { isUnlocked, encryptText, decryptText, buildHouseholdSignatureFields } = useVault();
  const [rules, setRules] = useState<Rule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!user || !isUnlocked) {
      setRules([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { data, error: e } = await rulesTable()
        .select(
          "id, enc_name, enc_conditions, enc_actions, match_mode, is_enabled, sort_order, last_fired_at, fire_count",
        )
        .order("sort_order", { ascending: true });
      if (e) throw e;

      const out: Rule[] = [];
      for (const raw of (data ?? []) as RawRuleRow[]) {
        out.push({
          id: raw.id,
          name: await decryptText(raw.enc_name),
          conditions: JSON.parse(await decryptText(raw.enc_conditions)) as RuleCondition[],
          actions: JSON.parse(await decryptText(raw.enc_actions)) as RuleAction[],
          match_mode: (raw.match_mode as MatchMode) ?? "all",
          is_enabled: raw.is_enabled,
          sort_order: raw.sort_order,
          last_fired_at: raw.last_fired_at,
          fire_count: raw.fire_count,
        });
      }
      setRules(out);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load rules");
    } finally {
      setLoading(false);
    }
  }, [user, isUnlocked, decryptText]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const createRule = useCallback(
    async (draft: RuleDraft) => {
      if (!user) throw new Error("Not signed in");
      const { error: e } = await rulesTable().insert({
        user_id: user.id,
        enc_name: await encryptText(draft.name),
        enc_conditions: await encryptText(JSON.stringify(draft.conditions)),
        enc_actions: await encryptText(JSON.stringify(draft.actions)),
        match_mode: draft.match_mode,
        is_enabled: draft.is_enabled ?? true,
        sort_order: rules.length,
        ...buildHouseholdSignatureFields(),
      });
      if (e) throw new Error(e.message);
      await refresh();
    },
    [user, encryptText, refresh, rules.length, buildHouseholdSignatureFields],
  );

  const updateRule = useCallback(
    async (id: string, patch: Partial<RuleDraft & { is_enabled: boolean }>) => {
      const upd: Record<string, unknown> = {};
      if (patch.name !== undefined) upd.enc_name = await encryptText(patch.name);
      if (patch.conditions !== undefined)
        upd.enc_conditions = await encryptText(JSON.stringify(patch.conditions));
      if (patch.actions !== undefined)
        upd.enc_actions = await encryptText(JSON.stringify(patch.actions));
      if (patch.match_mode !== undefined) upd.match_mode = patch.match_mode;
      if (patch.is_enabled !== undefined) upd.is_enabled = patch.is_enabled;
      if (Object.keys(upd).length === 0) return;
      Object.assign(upd, buildHouseholdSignatureFields());
      const { error: e } = await rulesTable()
        .update(upd as Database["public"]["Tables"]["rules"]["Update"])
        .eq("id", id);
      if (e) throw new Error(e.message);
      await refresh();
    },
    [encryptText, refresh, buildHouseholdSignatureFields],
  );

  const deleteRule = useCallback(
    async (id: string) => {
      const { error: e } = await rulesTable().delete().eq("id", id);
      if (e) throw new Error(e.message);
      await refresh();
    },
    [refresh],
  );

  const duplicateRule = useCallback(
    async (id: string) => {
      const src = rules.find((r) => r.id === id);
      if (!src) return;
      await createRule({
        name: `${src.name} (copy)`,
        match_mode: src.match_mode,
        conditions: src.conditions,
        actions: src.actions,
        is_enabled: src.is_enabled,
      });
    },
    [rules, createRule],
  );

  const recordFired = useCallback(
    async (id: string, byCount = 1) => {
      const { error: e } = await rulesTable()
        .update({ last_fired_at: new Date().toISOString(), ...buildHouseholdSignatureFields() })
        .eq("id", id);
      if (e) return;
      // Not a transactional counter, best-effort increment:
      const current = rules.find((r) => r.id === id);
      if (current) {
        await rulesTable()
          .update({
            fire_count: current.fire_count + byCount,
            ...buildHouseholdSignatureFields(),
          })
          .eq("id", id);
      }
    },
    [rules, buildHouseholdSignatureFields],
  );

  // Pure application — delegates to the engine but passes the current rules.
  const apply = useCallback(
    (txn: RuleTxnDraft, opts?: { skipSetCategory?: boolean }) =>
      applyRulesToTransaction(txn, rules, opts),
    [rules],
  );

  return {
    rules,
    loading,
    error,
    refresh,
    createRule,
    updateRule,
    deleteRule,
    duplicateRule,
    recordFired,
    apply,
  };
}
