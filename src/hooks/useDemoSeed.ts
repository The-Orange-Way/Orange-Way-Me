/**
 * useDemoSeed — seed / clear demo family data for in-app demonstrations.
 *
 * IDs for the most-recent seed are persisted in localStorage for fast targeted
 * deletion. On every seed or clear we also scan ALL user accounts for the
 * `demo_seed` metadata flag and purge any orphans left by sessions where
 * localStorage was wiped between runs — this prevents duplicate-account drift.
 */
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { useVault } from "@/context/VaultContext";
import { supabase } from "@/integrations/supabase/client";
import { blindIndexHmac } from "@/lib/blind-index";
import { DEMO_FAMILIES, type DemoFamily } from "@/lib/demo-families";
import type { AccountDraft, AccountTypeKey } from "@/lib/connectors";

const FAMILY_KEY = (uid: string) => `orangeway.demo.family.${uid}`;
const IDS_KEY = (uid: string) => `orangeway.demo.ids.${uid}`;

interface DemoIds {
  accountIds: string[];
  transactionIds: string[];
  goalIds: string[];
}

export interface SeedProgress {
  phase: "wallets" | "categories" | "transactions" | "goals" | "done";
  walletsDone: number;
  walletsTotal: number;
  txnsDone: number;
  txnsTotal: number;
  goalsDone: number;
  goalsTotal: number;
}

const accountsTable = () => supabase.from("accounts");
const txnsTable = () => supabase.from("transactions");
const goalsTable = () => supabase.from("goals");
const categoriesTable = () => supabase.from("categories");

export function useDemoSeed() {
  const { user } = useAuth();
  const { encryptText, decryptText, getHmacKey, buildHouseholdSignatureFields } = useVault();
  const [seededFamily, setSeededFamily] = useState<string | null>(null);
  const [seeding, setSeeding] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [progress, setProgress] = useState<SeedProgress | null>(null);

  useEffect(() => {
    if (!user) {
      setSeededFamily(null);
      return;
    }
    setSeededFamily(localStorage.getItem(FAMILY_KEY(user.id)));
  }, [user]);

  // Delete rows tracked in localStorage from the previous seed.
  const _clearTrackedIds = useCallback(async () => {
    if (!user) return;
    const raw = localStorage.getItem(IDS_KEY(user.id));
    if (!raw) return;
    try {
      const { accountIds, transactionIds, goalIds } = JSON.parse(raw) as DemoIds;
      if (transactionIds?.length) {
        await txnsTable().delete().in("id", transactionIds).eq("user_id", user.id);
      }
      if (goalIds?.length) {
        await goalsTable().delete().in("id", goalIds).eq("user_id", user.id);
      }
      if (accountIds?.length) {
        await accountsTable().delete().in("id", accountIds).eq("user_id", user.id);
      }
      localStorage.removeItem(IDS_KEY(user.id));
    } catch {
      /* best effort */
    }
  }, [user]);

  // Scan ALL accounts for demo_seed:true in their encrypted metadata and purge them
  // plus all transactions attached to them. This catches orphans from sessions where
  // localStorage was cleared between seeding runs.
  const _purgeOrphanDemoAccounts = useCallback(async () => {
    if (!user) return;
    const { data } = await accountsTable().select("id, enc_metadata").eq("user_id", user.id);

    const orphanIds: string[] = [];
    for (const row of (data ?? []) as Array<{ id: string; enc_metadata: string | null }>) {
      if (!row.enc_metadata) continue;
      try {
        const meta = JSON.parse(await decryptText(row.enc_metadata)) as Record<string, unknown>;
        if (meta?.demo_seed === true) orphanIds.push(row.id);
      } catch {
        /* row encrypted with a different MEK — not ours, skip */
      }
    }

    if (orphanIds.length === 0) return;

    // Delete transactions linked to the orphaned accounts in chunks of 50.
    for (let i = 0; i < orphanIds.length; i += 50) {
      const chunk = orphanIds.slice(i, i + 50);
      await txnsTable().delete().in("account_id", chunk).eq("user_id", user.id);
    }
    await accountsTable().delete().in("id", orphanIds).eq("user_id", user.id);
  }, [user, decryptText]);

  const seedFamily = useCallback(
    async (family: DemoFamily) => {
      if (!user) throw new Error("Not signed in");
      setSeeding(true);
      setProgress({
        phase: "wallets",
        walletsDone: 0,
        walletsTotal: family.accounts.length,
        txnsDone: 0,
        txnsTotal: family.transactions.length,
        goalsDone: 0,
        goalsTotal: family.goals.length,
      });
      try {
        // Clear any existing demo data — tracked IDs first, then orphan scan.
        await _clearTrackedIds();
        await _purgeOrphanDemoAccounts();

        // ── 1. Create accounts ──────────────────────────────────────────────────
        const accountIdByName = new Map<string, string>();
        const createdAccountIds: string[] = [];

        // Demo transactions are backdated up to ~3 months to look realistic
        // (see DemoTxn.daysAgo in demo-families.ts). accounts.opened_at
        // defaults to now() on insert, and a DB trigger rejects any
        // transaction dated before its account's opened_at (see migration
        // 20260530000000_accounts_opened_at_invariant.sql). Without this,
        // seeding a family fails on the first backdated transaction. Back
        // the account's opened_at up to one day before its oldest demo
        // transaction so the whole seed lands cleanly.
        const oldestDaysAgoForAccount = (accountName: string) =>
          family.transactions
            .filter((t) => t.account === accountName)
            .reduce((max, t) => Math.max(max, t.daysAgo), 0);

        for (let i = 0; i < family.accounts.length; i++) {
          const acc = family.accounts[i];
          const enc: AccountDraft = {
            name: acc.name,
            type: acc.type as AccountTypeKey,
            currency: acc.currency,
            institution: acc.institution,
            balance: acc.balance,
            metadata: { demo_seed: true, demo_family: family.id },
          };
          const openedAt = new Date();
          openedAt.setDate(openedAt.getDate() - (oldestDaysAgoForAccount(acc.name) + 1));
          const { data, error } = await accountsTable()
            .insert({
              user_id: user.id,
              connector_type: "manual",
              is_active: true,
              opened_at: openedAt.toISOString().slice(0, 10),
              enc_name: await encryptText(acc.name),
              enc_type: await encryptText(acc.type),
              enc_currency: await encryptText(acc.currency),
              enc_institution: await encryptText(acc.institution),
              enc_balance: await encryptText(acc.balance),
              enc_metadata: await encryptText(JSON.stringify(enc.metadata)),
              ...buildHouseholdSignatureFields(),
            })
            .select("id")
            .single();
          if (error) throw new Error(error.message);
          accountIdByName.set(acc.name, data.id as string);
          createdAccountIds.push(data.id as string);
          setProgress((p) => (p ? { ...p, walletsDone: i + 1 } : p));
        }

        // ── 2. Load existing categories ──────────────────────────────────────────
        setProgress((p) => (p ? { ...p, phase: "categories" } : p));
        let catData: Array<{ id: string; enc_name: string }> = [];
        const { data: existing } = await categoriesTable()
          .select("id, enc_name")
          .eq("user_id", user.id);
        catData = existing ?? [];

        if (catData.length === 0) {
          const { data: fresh } = await categoriesTable()
            .select("id, enc_name")
            .eq("user_id", user.id);
          catData = fresh ?? [];
        }

        const categoryIdByName = new Map<string, string>();
        for (const row of catData) {
          try {
            const name = await decryptText(row.enc_name);
            categoryIdByName.set(name, row.id);
          } catch {
            /* skip */
          }
        }

        // ── 3. Insert transactions ───────────────────────────────────────────────
        setProgress((p) => (p ? { ...p, phase: "transactions" } : p));
        const hmacKey = getHmacKey();
        const createdTxnIds: string[] = [];
        const today = new Date();

        for (let i = 0; i < family.transactions.length; i++) {
          const t = family.transactions[i];
          const d = new Date(today);
          d.setDate(d.getDate() - t.daysAgo);
          const dateStr = d.toISOString().slice(0, 10);

          const accountId = accountIdByName.get(t.account);
          if (!accountId) continue;

          const catId = categoryIdByName.get(t.category) ?? null;

          const { data: txnRow, error: txnErr } = await txnsTable()
            .insert({
              user_id: user.id,
              account_id: accountId,
              date: dateStr,
              enc_description: await encryptText(t.description),
              enc_amount: await encryptText(t.amount),
              enc_currency: t.currency ? await encryptText(t.currency) : null,
              enc_merchant: t.merchant ? await encryptText(t.merchant) : null,
              enc_category_id: catId ? await encryptText(catId) : null,
              enc_memo: t.memo ? await encryptText(t.memo) : null,
              enc_tags: t.tags?.length ? await encryptText(JSON.stringify(t.tags)) : null,
              hmac_merchant: t.merchant
                ? await blindIndexHmac(t.merchant.toLowerCase(), hmacKey)
                : null,
              hmac_category: catId ? await blindIndexHmac(catId, hmacKey) : null,
              is_manual_category: false,
              ...buildHouseholdSignatureFields(),
            })
            .select("id")
            .single();
          if (txnErr) throw new Error(txnErr.message);
          createdTxnIds.push(txnRow.id as string);
          setProgress((p) => (p ? { ...p, txnsDone: i + 1 } : p));
        }

        // ── 4. Insert goals ──────────────────────────────────────────────────────
        setProgress((p) => (p ? { ...p, phase: "goals" } : p));
        const createdGoalIds: string[] = [];
        for (let i = 0; i < family.goals.length; i++) {
          const g = family.goals[i];
          const linkedId = accountIdByName.get(g.account);
          const { data: goalRow, error: goalErr } = await goalsTable()
            .insert({
              user_id: user.id,
              is_completed: false,
              enc_name: await encryptText(g.name),
              enc_type: await encryptText(g.type),
              enc_target_amount: await encryptText(g.targetAmount),
              enc_current_amount: await encryptText("0"),
              enc_target_date: await encryptText(g.targetDate),
              enc_linked_account_ids: await encryptText(JSON.stringify(linkedId ? [linkedId] : [])),
              // Mirrors what useGoals.createGoal writes for a hand-made goal.
              // Leaving these null made a seeded pay_down goal fall back to its
              // target for the starting balance, which was zero (DL-1587).
              enc_strategy: g.strategy ? await encryptText(g.strategy) : null,
              enc_starting_balance: g.startingBalance ? await encryptText(g.startingBalance) : null,
              ...buildHouseholdSignatureFields(),
            })
            .select("id")
            .single();
          if (goalErr) throw new Error(goalErr.message);
          createdGoalIds.push(goalRow.id as string);
          setProgress((p) => (p ? { ...p, goalsDone: i + 1 } : p));
        }

        // ── 5. Persist IDs for targeted removal on next seed/clear ──────────────
        const ids: DemoIds = {
          accountIds: createdAccountIds,
          transactionIds: createdTxnIds,
          goalIds: createdGoalIds,
        };
        localStorage.setItem(IDS_KEY(user.id), JSON.stringify(ids));
        localStorage.setItem(FAMILY_KEY(user.id), family.name);
        setSeededFamily(family.name);
        setProgress((p) => (p ? { ...p, phase: "done" } : p));
      } catch (err) {
        setProgress(null);
        throw err;
      } finally {
        setSeeding(false);
      }
    },
    [user, encryptText, decryptText, getHmacKey, _clearTrackedIds, _purgeOrphanDemoAccounts],
  );

  const clearDemoData = useCallback(async () => {
    if (!user) return;
    setClearing(true);
    try {
      await _clearTrackedIds();
      await _purgeOrphanDemoAccounts();
      localStorage.removeItem(FAMILY_KEY(user.id));
      setSeededFamily(null);
    } finally {
      setClearing(false);
    }
  }, [user, _clearTrackedIds, _purgeOrphanDemoAccounts]);

  return { seededFamily, seedFamily, clearDemoData, seeding, clearing, progress };
}
