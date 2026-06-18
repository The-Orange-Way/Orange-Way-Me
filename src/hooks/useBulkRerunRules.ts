/**
 * useBulkRerunRules — iterate every transaction for the signed-in user,
 * apply the current rule set (respecting is_manual_category), and persist
 * the resulting changes. Runs client-side, paginated so we never decrypt
 * more than BATCH rows at a time.
 */
import { useCallback, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { useAuth } from "@/context/AuthContext";
import { useVault } from "@/context/VaultContext";
import { blindIndexHmac } from "@/lib/blind-index";
import { applyRulesToTransaction } from "@/lib/rules/engine";
import { useRules } from "./useRules";

const txnsTable = () => supabase.from("transactions");
const rulesTable = () => supabase.from("rules");
const PAGE_SIZE = 200;

interface RawRow {
  id: string;
  account_id: string;
  date: string;
  enc_amount: string;
  enc_description: string;
  enc_merchant: string | null;
  enc_category_id: string | null;
  enc_memo: string | null;
  enc_tags: string | null;
  is_manual_category: boolean;
}

export function useBulkRerunRules() {
  const { user } = useAuth();
  const { getHmacKey, encryptText, decryptText, buildHouseholdSignatureFields } = useVault();
  const { rules } = useRules();

  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });

  const run = useCallback(async (): Promise<number> => {
    if (!user) throw new Error("Not signed in");
    if (rules.length === 0) return 0;
    setBusy(true);
    setProgress({ done: 0, total: 0 });
    const hmacKey = getHmacKey();
    const ruleFireCounts = new Map<string, number>();

    try {
      // Count first so we can show a ratio
      const { count, error: countErr } = await txnsTable()
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id);
      if (countErr) throw new Error(countErr.message);
      const total = count ?? 0;
      setProgress({ done: 0, total });

      let done = 0;
      let offset = 0;

      while (offset < total) {
        const { data, error: e } = await txnsTable()
          .select(
            "id, account_id, date, enc_amount, enc_description, enc_merchant, enc_category_id, enc_memo, enc_tags, is_manual_category",
          )
          .order("date", { ascending: true })
          .range(offset, offset + PAGE_SIZE - 1);
        if (e) throw new Error(e.message);

        const rows = (data ?? []) as RawRow[];
        if (rows.length === 0) break;

        for (const raw of rows) {
          const decrypted = {
            account_id: raw.account_id,
            date: raw.date,
            amount: await decryptText(raw.enc_amount),
            description: await decryptText(raw.enc_description),
            merchant: raw.enc_merchant ? await decryptText(raw.enc_merchant) : null,
            category_id: raw.enc_category_id ? await decryptText(raw.enc_category_id) : null,
            memo: raw.enc_memo ? await decryptText(raw.enc_memo) : null,
            tags: raw.enc_tags ? (JSON.parse(await decryptText(raw.enc_tags)) as string[]) : null,
          };

          const { draft: modified, firedRuleIds } = applyRulesToTransaction(decrypted, rules, {
            skipSetCategory: raw.is_manual_category,
          });

          for (const id of firedRuleIds) {
            ruleFireCounts.set(id, (ruleFireCounts.get(id) ?? 0) + 1);
          }

          // Detect which fields actually changed and write only those.
          const upd: Record<string, unknown> = {};
          if ((modified.merchant ?? null) !== (decrypted.merchant ?? null)) {
            upd.enc_merchant = modified.merchant ? await encryptText(modified.merchant) : null;
            upd.hmac_merchant = modified.merchant
              ? await blindIndexHmac(modified.merchant, hmacKey)
              : null;
          }
          if ((modified.category_id ?? null) !== (decrypted.category_id ?? null)) {
            upd.enc_category_id = modified.category_id
              ? await encryptText(modified.category_id)
              : null;
            upd.hmac_category = modified.category_id
              ? await blindIndexHmac(modified.category_id, hmacKey)
              : null;
          }
          if ((modified.memo ?? null) !== (decrypted.memo ?? null)) {
            upd.enc_memo = modified.memo ? await encryptText(modified.memo) : null;
          }
          const oldTagsStr = decrypted.tags ? JSON.stringify(decrypted.tags) : "";
          const newTagsStr = modified.tags ? JSON.stringify(modified.tags) : "";
          if (newTagsStr !== oldTagsStr) {
            upd.enc_tags =
              modified.tags && modified.tags.length > 0
                ? await encryptText(JSON.stringify(modified.tags))
                : null;
          }

          if (Object.keys(upd).length > 0) {
            Object.assign(upd, buildHouseholdSignatureFields());
            const { error: upErr } = await txnsTable()
              .update(upd as Database["public"]["Tables"]["transactions"]["Update"])
              .eq("id", raw.id);
            if (upErr) throw new Error(upErr.message);
          }

          done += 1;
          setProgress({ done, total });
        }

        offset += rows.length;
        if (rows.length < PAGE_SIZE) break;
      }

      // Bump fire_count per rule (best-effort, per-rule update)
      for (const [ruleId, inc] of ruleFireCounts) {
        const r = rules.find((x) => x.id === ruleId);
        if (!r) continue;
        await rulesTable()
          .update({
            fire_count: r.fire_count + inc,
            last_fired_at: new Date().toISOString(),
            ...buildHouseholdSignatureFields(),
          })
          .eq("id", ruleId);
      }

      return done;
    } finally {
      setBusy(false);
    }
  }, [user, rules, decryptText, encryptText, getHmacKey, buildHouseholdSignatureFields]);

  return { run, busy, progress };
}
