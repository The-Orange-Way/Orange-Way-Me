/**
 * useCategories — fetch + decrypt the user's categories (hierarchical tree)
 * and provide create / update / delete / seed / reassign helpers.
 *
 * Categories are encrypted at rest. The row uuid is used as the stable
 * reference on transactions.enc_category_id / hmac_category — renaming a
 * category does NOT invalidate existing references.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { useAuth } from "@/context/AuthContext";
import { useVault } from "@/context/VaultContext";
import { blindIndexHmac } from "@/lib/blind-index";

export type CategoryType = "income" | "expense" | "transfer";

export interface DecryptedCategory {
  id: string;
  name: string;
  icon: string | null;
  color: string | null;
  parent_id: string | null;
  sort_order: number;
  type: CategoryType;
}

export interface CategoryTreeNode extends DecryptedCategory {
  children: CategoryTreeNode[];
}

const catTable = () => supabase.from("categories");
const txnsTable = () => supabase.from("transactions");

// Full default category set. "parent" key references another default by name
// and is resolved to a uuid during the seed write.
interface DefaultCategorySpec {
  name: string;
  color: string;
  icon: string;
  type: CategoryType;
  parent?: string;
}

const DEFAULT_CATEGORIES: DefaultCategorySpec[] = [
  // Income
  { name: "Income", color: "#22c55e", icon: "TrendingUp", type: "income" },
  { name: "Salary", color: "#22c55e", icon: "Briefcase", type: "income", parent: "Income" },
  { name: "Bonus", color: "#22c55e", icon: "Gift", type: "income", parent: "Income" },
  { name: "Freelance", color: "#22c55e", icon: "Laptop", type: "income", parent: "Income" },
  {
    name: "Investment returns",
    color: "#22c55e",
    icon: "LineChart",
    type: "income",
    parent: "Income",
  },
  {
    name: "Gifts received",
    color: "#22c55e",
    icon: "PackageOpen",
    type: "income",
    parent: "Income",
  },
  { name: "Other income", color: "#22c55e", icon: "Plus", type: "income", parent: "Income" },

  // Housing
  { name: "Housing", color: "#8b5cf6", icon: "Home", type: "expense" },
  {
    name: "Rent / Mortgage",
    color: "#8b5cf6",
    icon: "KeyRound",
    type: "expense",
    parent: "Housing",
  },
  { name: "Utilities", color: "#8b5cf6", icon: "Zap", type: "expense", parent: "Housing" },
  { name: "Maintenance", color: "#8b5cf6", icon: "Wrench", type: "expense", parent: "Housing" },
  {
    name: "HOA / Property tax",
    color: "#8b5cf6",
    icon: "FileText",
    type: "expense",
    parent: "Housing",
  },

  // Food & Drink
  { name: "Food & Drink", color: "#f97316", icon: "Utensils", type: "expense" },
  {
    name: "Groceries",
    color: "#f97316",
    icon: "ShoppingCart",
    type: "expense",
    parent: "Food & Drink",
  },
  {
    name: "Restaurants",
    color: "#f97316",
    icon: "UtensilsCrossed",
    type: "expense",
    parent: "Food & Drink",
  },
  { name: "Coffee", color: "#f97316", icon: "Coffee", type: "expense", parent: "Food & Drink" },
  { name: "Alcohol", color: "#f97316", icon: "Wine", type: "expense", parent: "Food & Drink" },

  // Transportation
  { name: "Transportation", color: "#06b6d4", icon: "Car", type: "expense" },
  { name: "Gas / Fuel", color: "#06b6d4", icon: "Fuel", type: "expense", parent: "Transportation" },
  {
    name: "Public transit",
    color: "#06b6d4",
    icon: "Bus",
    type: "expense",
    parent: "Transportation",
  },
  {
    name: "Parking",
    color: "#06b6d4",
    icon: "ParkingCircle",
    type: "expense",
    parent: "Transportation",
  },
  { name: "Rideshare", color: "#06b6d4", icon: "Car", type: "expense", parent: "Transportation" },
  {
    name: "Vehicle maintenance",
    color: "#06b6d4",
    icon: "Wrench",
    type: "expense",
    parent: "Transportation",
  },
  {
    name: "Vehicle insurance",
    color: "#06b6d4",
    icon: "ShieldCheck",
    type: "expense",
    parent: "Transportation",
  },

  // Shopping
  { name: "Shopping", color: "#f43f5e", icon: "ShoppingBag", type: "expense" },
  { name: "Clothing", color: "#f43f5e", icon: "Shirt", type: "expense", parent: "Shopping" },
  {
    name: "Electronics",
    color: "#f43f5e",
    icon: "Smartphone",
    type: "expense",
    parent: "Shopping",
  },
  { name: "Home goods", color: "#f43f5e", icon: "Sofa", type: "expense", parent: "Shopping" },
  {
    name: "Personal care",
    color: "#f43f5e",
    icon: "Sparkles",
    type: "expense",
    parent: "Shopping",
  },

  // Entertainment
  { name: "Entertainment", color: "#ec4899", icon: "Film", type: "expense" },
  { name: "Streaming", color: "#ec4899", icon: "Tv", type: "expense", parent: "Entertainment" },
  { name: "Events", color: "#ec4899", icon: "Ticket", type: "expense", parent: "Entertainment" },
  { name: "Hobbies", color: "#ec4899", icon: "Palette", type: "expense", parent: "Entertainment" },
  { name: "Books", color: "#ec4899", icon: "BookOpen", type: "expense", parent: "Entertainment" },

  // Health
  { name: "Health", color: "#10b981", icon: "Heart", type: "expense" },
  { name: "Doctor", color: "#10b981", icon: "Stethoscope", type: "expense", parent: "Health" },
  { name: "Pharmacy", color: "#10b981", icon: "Pill", type: "expense", parent: "Health" },
  { name: "Fitness", color: "#10b981", icon: "Dumbbell", type: "expense", parent: "Health" },
  {
    name: "Health insurance",
    color: "#10b981",
    icon: "ShieldPlus",
    type: "expense",
    parent: "Health",
  },

  // Travel
  { name: "Travel", color: "#3b82f6", icon: "Plane", type: "expense" },
  { name: "Flights", color: "#3b82f6", icon: "Plane", type: "expense", parent: "Travel" },
  { name: "Hotels", color: "#3b82f6", icon: "BedDouble", type: "expense", parent: "Travel" },
  { name: "Meals away", color: "#3b82f6", icon: "Utensils", type: "expense", parent: "Travel" },
  { name: "Activities", color: "#3b82f6", icon: "Map", type: "expense", parent: "Travel" },

  // Financial
  { name: "Financial", color: "#0ea5e9", icon: "PiggyBank", type: "expense" },
  {
    name: "Savings transfer",
    color: "#0ea5e9",
    icon: "ArrowLeftRight",
    type: "transfer",
    parent: "Financial",
  },
  {
    name: "Investment",
    color: "#0ea5e9",
    icon: "TrendingUp",
    type: "transfer",
    parent: "Financial",
  },
  { name: "Fees", color: "#0ea5e9", icon: "Receipt", type: "expense", parent: "Financial" },
  { name: "Interest", color: "#0ea5e9", icon: "Percent", type: "expense", parent: "Financial" },

  // Bitcoin
  { name: "Bitcoin", color: "#f59e0b", icon: "Bitcoin", type: "expense" },
  {
    name: "DCA purchase",
    color: "#f59e0b",
    icon: "CalendarClock",
    type: "expense",
    parent: "Bitcoin",
  },
  { name: "On-chain fees", color: "#f59e0b", icon: "Link", type: "expense", parent: "Bitcoin" },
  { name: "Lightning", color: "#f59e0b", icon: "Zap", type: "expense", parent: "Bitcoin" },
  { name: "Mining income", color: "#f59e0b", icon: "Cpu", type: "income", parent: "Bitcoin" },

  // Transfers (top-level system category)
  { name: "Internal transfer", color: "#64748b", icon: "ArrowLeftRight", type: "transfer" },

  // Fallback
  { name: "Uncategorized", color: "#94a3b8", icon: "Circle", type: "expense" },
];

export function useCategories() {
  const { user } = useAuth();
  const { isUnlocked, encryptText, decryptText, getHmacKey, buildHouseholdSignatureFields } =
    useVault();
  const [categories, setCategories] = useState<DecryptedCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!user || !isUnlocked) {
      setCategories([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { data, error: e } = await catTable()
        .select("id, enc_name, enc_icon, enc_color, enc_parent_id, sort_order, type")
        .order("sort_order", { ascending: true });
      if (e) throw e;

      const out: DecryptedCategory[] = [];
      for (const raw of (data ?? []) as Array<{
        id: string;
        enc_name: string;
        enc_icon: string | null;
        enc_color: string | null;
        enc_parent_id: string | null;
        sort_order: number;
        type: CategoryType | null;
      }>) {
        out.push({
          id: raw.id,
          name: await decryptText(raw.enc_name),
          icon: raw.enc_icon ? await decryptText(raw.enc_icon) : null,
          color: raw.enc_color ? await decryptText(raw.enc_color) : null,
          parent_id: raw.enc_parent_id ? await decryptText(raw.enc_parent_id) : null,
          sort_order: raw.sort_order,
          type: (raw.type ?? "expense") as CategoryType,
        });
      }
      setCategories(out);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load categories");
    } finally {
      setLoading(false);
    }
  }, [user, isUnlocked, decryptText]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Tree helper: nest children into their parents, preserve sort_order.
  const tree = useMemo<CategoryTreeNode[]>(() => {
    const byId = new Map<string, CategoryTreeNode>();
    for (const c of categories) byId.set(c.id, { ...c, children: [] });
    const roots: CategoryTreeNode[] = [];
    for (const node of byId.values()) {
      if (node.parent_id && byId.has(node.parent_id)) {
        byId.get(node.parent_id)!.children.push(node);
      } else {
        roots.push(node);
      }
    }
    const sortRec = (nodes: CategoryTreeNode[]) => {
      nodes.sort((a, b) => a.sort_order - b.sort_order);
      for (const n of nodes) sortRec(n.children);
    };
    sortRec(roots);
    return roots;
  }, [categories]);

  const seedDefaults = useCallback(async () => {
    if (!user) return;
    // Check the DB directly — React state may still be empty while loading,
    // causing repeated seeding if we rely on categories.length.
    const { count } = await catTable()
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id);
    if (count && count > 0) return;

    // First pass: insert all rows without parent references (we don't know
    // uuids yet). Track name → uuid mapping for second pass.
    const nameToId = new Map<string, string>();

    // Parents first (entries with no `parent`)
    const parents = DEFAULT_CATEGORIES.filter((c) => !c.parent);
    for (let i = 0; i < parents.length; i++) {
      const c = parents[i];
      const { data, error: e } = await catTable()
        .insert({
          user_id: user.id,
          enc_name: await encryptText(c.name),
          enc_color: await encryptText(c.color),
          enc_icon: await encryptText(c.icon),
          enc_parent_id: null,
          sort_order: i,
          type: c.type,
          ...buildHouseholdSignatureFields(),
        })
        .select("id")
        .single();
      if (e) throw new Error(e.message);
      nameToId.set(c.name, data.id as string);
    }

    // Children
    const children = DEFAULT_CATEGORIES.filter((c) => c.parent);
    const childRows: Record<string, unknown>[] = [];
    for (let i = 0; i < children.length; i++) {
      const c = children[i];
      const parentId = nameToId.get(c.parent!);
      if (!parentId) continue;
      childRows.push({
        user_id: user.id,
        enc_name: await encryptText(c.name),
        enc_color: await encryptText(c.color),
        enc_icon: await encryptText(c.icon),
        enc_parent_id: await encryptText(parentId),
        sort_order: parents.length + i,
        type: c.type,
        ...buildHouseholdSignatureFields(),
      });
    }
    if (childRows.length > 0) {
      const { error: e } = await catTable().insert(
        childRows as Database["public"]["Tables"]["categories"]["Insert"][],
      );
      if (e) throw new Error(e.message);
    }
    await refresh();
  }, [user, encryptText, refresh, buildHouseholdSignatureFields]);

  const createCategory = useCallback(
    async (draft: {
      name: string;
      color?: string;
      icon?: string;
      parent_id?: string | null;
      type?: CategoryType;
    }) => {
      if (!user) throw new Error("Not signed in");
      const { error: e } = await catTable().insert({
        user_id: user.id,
        enc_name: await encryptText(draft.name),
        enc_color: draft.color ? await encryptText(draft.color) : null,
        enc_icon: draft.icon ? await encryptText(draft.icon) : null,
        enc_parent_id: draft.parent_id ? await encryptText(draft.parent_id) : null,
        sort_order: categories.length,
        type: draft.type ?? "expense",
        ...buildHouseholdSignatureFields(),
      });
      if (e) throw new Error(e.message);
      await refresh();
    },
    [user, encryptText, categories.length, refresh, buildHouseholdSignatureFields],
  );

  const updateCategory = useCallback(
    async (
      id: string,
      patch: Partial<{
        name: string;
        color: string | null;
        icon: string | null;
        parent_id: string | null;
        type: CategoryType;
        sort_order: number;
      }>,
    ) => {
      const upd: Record<string, unknown> = {};
      if (patch.name !== undefined) upd.enc_name = await encryptText(patch.name);
      if (patch.color !== undefined)
        upd.enc_color = patch.color ? await encryptText(patch.color) : null;
      if (patch.icon !== undefined)
        upd.enc_icon = patch.icon ? await encryptText(patch.icon) : null;
      if (patch.parent_id !== undefined)
        upd.enc_parent_id = patch.parent_id ? await encryptText(patch.parent_id) : null;
      if (patch.type !== undefined) upd.type = patch.type;
      if (patch.sort_order !== undefined) upd.sort_order = patch.sort_order;
      if (Object.keys(upd).length === 0) return;
      Object.assign(upd, buildHouseholdSignatureFields());
      const { error: e } = await catTable()
        .update(upd as Database["public"]["Tables"]["categories"]["Update"])
        .eq("id", id);
      if (e) throw new Error(e.message);
      await refresh();
    },
    [encryptText, refresh, buildHouseholdSignatureFields],
  );

  // Count how many transactions reference a category (via blind-index HMAC).
  const countTransactionsInCategory = useCallback(
    async (categoryId: string): Promise<number> => {
      const hmac = await blindIndexHmac(categoryId, getHmacKey());
      const { count, error: e } = await txnsTable()
        .select("id", { count: "exact", head: true })
        .eq("hmac_category", hmac);
      if (e) throw new Error(e.message);
      return count ?? 0;
    },
    [getHmacKey],
  );

  // Reassign any transactions referencing `fromId` to `toId` (or clear them
  // if toId is null), then delete `fromId`. Child categories cascade to
  // become children of the deleted category's parent.
  const deleteCategory = useCallback(
    async (fromId: string, reassignTo: string | null) => {
      if (!user) throw new Error("Not signed in");
      const hmacKey = getHmacKey();
      const fromHmac = await blindIndexHmac(fromId, hmacKey);

      // Reassign transactions
      const enc_category_id = reassignTo ? await encryptText(reassignTo) : null;
      const hmac_category = reassignTo ? await blindIndexHmac(reassignTo, hmacKey) : null;
      const { error: reAssignErr } = await txnsTable()
        .update({ enc_category_id, hmac_category, ...buildHouseholdSignatureFields() })
        .eq("hmac_category", fromHmac);
      if (reAssignErr) throw new Error(reAssignErr.message);

      // Reparent child categories to the deleted category's parent
      const cat = categories.find((c) => c.id === fromId);
      const parentIdForChildren = cat?.parent_id ?? null;
      const encParent = parentIdForChildren ? await encryptText(parentIdForChildren) : null;
      for (const child of categories.filter((c) => c.parent_id === fromId)) {
        await catTable()
          .update({ enc_parent_id: encParent, ...buildHouseholdSignatureFields() })
          .eq("id", child.id);
      }

      const { error: delErr } = await catTable().delete().eq("id", fromId);
      if (delErr) throw new Error(delErr.message);
      await refresh();
    },
    [user, categories, encryptText, getHmacKey, refresh, buildHouseholdSignatureFields],
  );

  const reorderCategory = useCallback(
    async (id: string, newSortOrder: number) => {
      const { error: e } = await catTable()
        .update({ sort_order: newSortOrder, ...buildHouseholdSignatureFields() })
        .eq("id", id);
      if (e) throw new Error(e.message);
      await refresh();
    },
    [refresh, buildHouseholdSignatureFields],
  );

  return {
    categories,
    tree,
    loading,
    error,
    refresh,
    seedDefaults,
    createCategory,
    updateCategory,
    deleteCategory,
    reorderCategory,
    countTransactionsInCategory,
  };
}
