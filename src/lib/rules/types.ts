/**
 * Rule engine types.
 *
 * A rule has:
 *  - 1+ conditions (all or any must match)
 *  - 1+ actions (applied in order to the transaction draft)
 *
 * All rule evaluation happens client-side in the browser after decryption.
 * The database only sees encrypted JSON blobs for the conditions + actions.
 */

export type RuleField =
  | "merchant"
  | "description"
  | "amount"
  | "account_id"
  | "day_of_week"
  | "day_of_month";

export type RuleOperator =
  | "equals"
  | "contains"
  | "starts_with"
  | "ends_with"
  | "matches_regex"
  | "greater_than"
  | "less_than"
  | "between";

export interface RuleCondition {
  field: RuleField;
  operator: RuleOperator;
  value: string;
  /** Used only when operator is 'between'. */
  value2?: string;
}

export type RuleActionType =
  | "set_merchant"
  | "set_category"
  | "add_tag"
  | "set_memo"
  | "mark_reviewed"
  | "hide";

export interface RuleAction {
  type: RuleActionType;
  /** For set_* actions: the new value. For add_tag: the tag. For mark_reviewed / hide: ignored. */
  value: string;
}

export type MatchMode = "all" | "any";

export interface Rule {
  id: string;
  name: string;
  match_mode: MatchMode;
  conditions: RuleCondition[];
  actions: RuleAction[];
  is_enabled: boolean;
  sort_order: number;
  last_fired_at: string | null;
  fire_count: number;
}

/** Draft shape rules operate on (subset of DecryptedTxn). */
export interface RuleTxnDraft {
  account_id: string;
  date: string;
  amount: string;
  description: string;
  merchant: string | null;
  category_id: string | null;
  memo: string | null;
  tags: string[] | null;
  is_hidden?: boolean;
  is_reviewed?: boolean;
}
