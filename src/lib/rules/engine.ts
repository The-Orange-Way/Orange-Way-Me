/**
 * Rule engine — pure functions, client-side only.
 *
 * Evaluates rule conditions against a transaction draft and applies any
 * matching rule's actions. Rules run in sort_order; later rules can
 * overwrite fields set by earlier ones.
 */
import type { Rule, RuleAction, RuleCondition, RuleTxnDraft } from "./types";

// ---------------------------------------------------------------------------
// Condition matching
// ---------------------------------------------------------------------------

function getFieldValue(txn: RuleTxnDraft, field: RuleCondition["field"]): string | number | null {
  switch (field) {
    case "merchant":
      return txn.merchant ?? "";
    case "description":
      return txn.description ?? "";
    case "amount":
      return Number(txn.amount);
    case "account_id":
      return txn.account_id;
    case "day_of_week": {
      // 0 = Sunday, 6 = Saturday
      return new Date(txn.date + "T00:00:00").getDay();
    }
    case "day_of_month": {
      return new Date(txn.date + "T00:00:00").getDate();
    }
    default:
      return null;
  }
}

export function matchesCondition(txn: RuleTxnDraft, c: RuleCondition): boolean {
  const actual = getFieldValue(txn, c.field);
  if (actual === null) return false;

  // Numeric operators
  if (c.operator === "greater_than" || c.operator === "less_than" || c.operator === "between") {
    const actualNum = typeof actual === "number" ? actual : Number(actual);
    if (!Number.isFinite(actualNum)) return false;
    const v1 = Number(c.value);
    if (c.operator === "greater_than") return actualNum > v1;
    if (c.operator === "less_than") return actualNum < v1;
    if (c.operator === "between") {
      const v2 = c.value2 != null ? Number(c.value2) : NaN;
      return actualNum >= Math.min(v1, v2) && actualNum <= Math.max(v1, v2);
    }
    return false;
  }

  // String operators (case-insensitive for natural matching)
  const actualStr = typeof actual === "number" ? String(actual) : actual;
  const a = actualStr.toLowerCase();
  const b = (c.value ?? "").toLowerCase();

  switch (c.operator) {
    case "equals":
      return a === b;
    case "contains":
      return a.includes(b);
    case "starts_with":
      return a.startsWith(b);
    case "ends_with":
      return a.endsWith(b);
    case "matches_regex":
      try {
        return new RegExp(c.value, "i").test(actualStr);
      } catch {
        return false;
      }
    default:
      return false;
  }
}

export function matchesRule(txn: RuleTxnDraft, rule: Rule): boolean {
  if (!rule.is_enabled) return false;
  if (rule.conditions.length === 0) return false;
  if (rule.match_mode === "all") {
    return rule.conditions.every((c) => matchesCondition(txn, c));
  }
  return rule.conditions.some((c) => matchesCondition(txn, c));
}

// ---------------------------------------------------------------------------
// Action application
// ---------------------------------------------------------------------------

export function applyActions(txn: RuleTxnDraft, actions: RuleAction[]): RuleTxnDraft {
  const draft: RuleTxnDraft = { ...txn, tags: txn.tags ? [...txn.tags] : null };
  for (const action of actions) {
    switch (action.type) {
      case "set_merchant":
        draft.merchant = action.value;
        break;
      case "set_category":
        draft.category_id = action.value;
        break;
      case "add_tag": {
        const tag = action.value.trim();
        if (!tag) break;
        const existing = draft.tags ?? [];
        if (!existing.includes(tag)) {
          draft.tags = [...existing, tag];
        }
        break;
      }
      case "set_memo":
        draft.memo = action.value;
        break;
      case "mark_reviewed":
        draft.is_reviewed = true;
        break;
      case "hide":
        draft.is_hidden = true;
        break;
    }
  }
  return draft;
}

// ---------------------------------------------------------------------------
// Full pipeline
// ---------------------------------------------------------------------------

export interface RuleApplyResult {
  draft: RuleTxnDraft;
  firedRuleIds: string[];
}

export function applyRulesToTransaction(
  txn: RuleTxnDraft,
  rules: Rule[],
  opts: { skipSetCategory?: boolean } = {},
): RuleApplyResult {
  let current = txn;
  const fired: string[] = [];

  // Ensure deterministic ordering
  const ordered = [...rules].sort((a, b) => a.sort_order - b.sort_order);

  for (const rule of ordered) {
    if (!matchesRule(current, rule)) continue;
    fired.push(rule.id);
    // If the caller is re-running rules against a manually-categorized
    // transaction, suppress set_category actions but still honor other effects.
    const actions = opts.skipSetCategory
      ? rule.actions.filter((a) => a.type !== "set_category")
      : rule.actions;
    current = applyActions(current, actions);
  }

  return { draft: current, firedRuleIds: fired };
}

export function applyRulesToBatch(
  txns: Array<RuleTxnDraft & { id: string; is_manual_category?: boolean }>,
  rules: Rule[],
): Array<RuleApplyResult & { id: string }> {
  return txns.map((t) => ({
    id: t.id,
    ...applyRulesToTransaction(t, rules, { skipSetCategory: !!t.is_manual_category }),
  }));
}

// ---------------------------------------------------------------------------
// Humanized summaries (for the rule card UI)
// ---------------------------------------------------------------------------

const FIELD_LABELS: Record<RuleCondition["field"], string> = {
  merchant: "Merchant",
  description: "Description",
  amount: "Amount",
  account_id: "Account",
  day_of_week: "Day of week",
  day_of_month: "Day of month",
};

const OPERATOR_LABELS: Record<RuleCondition["operator"], string> = {
  equals: "is",
  contains: "contains",
  starts_with: "starts with",
  ends_with: "ends with",
  matches_regex: "matches",
  greater_than: ">",
  less_than: "<",
  between: "is between",
};

export function summarizeCondition(c: RuleCondition): string {
  const label = FIELD_LABELS[c.field] ?? c.field;
  const op = OPERATOR_LABELS[c.operator] ?? c.operator;
  if (c.operator === "between") {
    return `${label} ${op} ${c.value} and ${c.value2 ?? ""}`;
  }
  return `${label} ${op} "${c.value}"`;
}

export function summarizeActions(
  actions: RuleAction[],
  categoryNameById?: Map<string, string>,
): string[] {
  return actions.map((a) => {
    switch (a.type) {
      case "set_merchant":
        return `Rename merchant to "${a.value}"`;
      case "set_category": {
        const name = categoryNameById?.get(a.value);
        return `Set category to ${name ?? a.value}`;
      }
      case "add_tag":
        return `Add tag #${a.value}`;
      case "set_memo":
        return `Set memo to "${a.value}"`;
      case "mark_reviewed":
        return `Mark reviewed`;
      case "hide":
        return `Hide from lists`;
      default:
        return String(a.type);
    }
  });
}
