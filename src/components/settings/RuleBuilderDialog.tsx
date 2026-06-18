/**
 * RuleBuilderDialog — create / edit a rule. Builds conditions + actions via
 * stacked field pickers. No raw JSON editing — the goal is approachable UX.
 */
import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, Trash2 } from "lucide-react";
import type { Account } from "@/lib/connectors";
import type { DecryptedCategory } from "@/hooks/useCategories";
import type { RuleDraft } from "@/hooks/useRules";
import type {
  MatchMode,
  Rule,
  RuleAction,
  RuleActionType,
  RuleCondition,
  RuleField,
  RuleOperator,
} from "@/lib/rules/types";

const FIELD_OPTIONS: Array<{ value: RuleField; label: string }> = [
  { value: "merchant", label: "Merchant" },
  { value: "description", label: "Description" },
  { value: "amount", label: "Amount" },
  { value: "account_id", label: "Account" },
  { value: "day_of_week", label: "Day of week" },
  { value: "day_of_month", label: "Day of month" },
];

const STRING_OPERATORS: Array<{ value: RuleOperator; label: string }> = [
  { value: "contains", label: "contains" },
  { value: "equals", label: "equals" },
  { value: "starts_with", label: "starts with" },
  { value: "ends_with", label: "ends with" },
  { value: "matches_regex", label: "matches regex" },
];

const NUMERIC_OPERATORS: Array<{ value: RuleOperator; label: string }> = [
  { value: "greater_than", label: ">" },
  { value: "less_than", label: "<" },
  { value: "between", label: "between" },
  { value: "equals", label: "equals" },
];

const ACCOUNT_OPERATORS: Array<{ value: RuleOperator; label: string }> = [
  { value: "equals", label: "is" },
];

const ACTION_OPTIONS: Array<{ value: RuleActionType; label: string }> = [
  { value: "set_category", label: "Set category" },
  { value: "set_merchant", label: "Rename merchant" },
  { value: "add_tag", label: "Add tag" },
  { value: "set_memo", label: "Set memo" },
  { value: "mark_reviewed", label: "Mark reviewed" },
  { value: "hide", label: "Hide from lists" },
];

function operatorsForField(field: RuleField) {
  if (field === "account_id") return ACCOUNT_OPERATORS;
  if (field === "amount" || field === "day_of_week" || field === "day_of_month") {
    return NUMERIC_OPERATORS;
  }
  return STRING_OPERATORS;
}

const EMPTY_CONDITION: RuleCondition = {
  field: "merchant",
  operator: "contains",
  value: "",
};

const EMPTY_ACTION: RuleAction = { type: "set_category", value: "" };

export function RuleBuilderDialog({
  open,
  onOpenChange,
  initial,
  categories,
  accounts,
  onSave,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initial: Rule | null;
  categories: DecryptedCategory[];
  accounts: Account[];
  onSave: (draft: RuleDraft) => Promise<void>;
}) {
  const isEdit = Boolean(initial);

  const [name, setName] = useState("");
  const [matchMode, setMatchMode] = useState<MatchMode>("all");
  const [conditions, setConditions] = useState<RuleCondition[]>([EMPTY_CONDITION]);
  const [actions, setActions] = useState<RuleAction[]>([EMPTY_ACTION]);
  const [enabled, setEnabled] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (initial) {
      setName(initial.name);
      setMatchMode(initial.match_mode);
      setConditions(initial.conditions.length ? initial.conditions : [EMPTY_CONDITION]);
      setActions(initial.actions.length ? initial.actions : [EMPTY_ACTION]);
      setEnabled(initial.is_enabled);
    } else {
      setName("");
      setMatchMode("all");
      setConditions([EMPTY_CONDITION]);
      setActions([EMPTY_ACTION]);
      setEnabled(true);
    }
  }, [open, initial]);

  const catById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const accById = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);

  const updateCondition = (i: number, patch: Partial<RuleCondition>) => {
    setConditions((arr) => arr.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
  };
  const addCondition = () => setConditions((arr) => [...arr, { ...EMPTY_CONDITION }]);
  const removeCondition = (i: number) =>
    setConditions((arr) => (arr.length <= 1 ? arr : arr.filter((_, idx) => idx !== i)));

  const updateAction = (i: number, patch: Partial<RuleAction>) => {
    setActions((arr) => arr.map((a, idx) => (idx === i ? { ...a, ...patch } : a)));
  };
  const addAction = () => setActions((arr) => [...arr, { ...EMPTY_ACTION }]);
  const removeAction = (i: number) =>
    setActions((arr) => (arr.length <= 1 ? arr : arr.filter((_, idx) => idx !== i)));

  const canSubmit =
    name.trim().length > 0 &&
    conditions.every((c) => c.value.trim().length > 0) &&
    actions.every(
      (a) => a.type === "mark_reviewed" || a.type === "hide" || a.value.trim().length > 0,
    );

  const submit = async () => {
    if (!canSubmit) return;
    setSaving(true);
    try {
      await onSave({
        name: name.trim(),
        match_mode: matchMode,
        conditions,
        actions,
        is_enabled: enabled,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit rule" : "New rule"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="rb-name">Rule name</Label>
            <Input
              id="rb-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Starbucks → Coffee"
              autoFocus
            />
          </div>

          <Tabs defaultValue="when">
            <TabsList>
              <TabsTrigger value="when">Conditions</TabsTrigger>
              <TabsTrigger value="do">Actions</TabsTrigger>
            </TabsList>

            <TabsContent value="when" className="space-y-3 pt-3">
              <div className="flex items-center gap-2 text-xs">
                <span className="text-muted-foreground">Match</span>
                <Select value={matchMode} onValueChange={(v) => setMatchMode(v as MatchMode)}>
                  <SelectTrigger className="h-7 w-28">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">ALL of</SelectItem>
                    <SelectItem value="any">ANY of</SelectItem>
                  </SelectContent>
                </Select>
                <span className="text-muted-foreground">these conditions</span>
              </div>

              <div className="space-y-2">
                {conditions.map((c, i) => (
                  <ConditionRow
                    key={i}
                    condition={c}
                    accounts={accounts}
                    accById={accById}
                    onChange={(patch) => updateCondition(i, patch)}
                    onRemove={() => removeCondition(i)}
                    removable={conditions.length > 1}
                  />
                ))}
                <Button variant="outline" size="sm" onClick={addCondition}>
                  <Plus className="mr-2 h-3.5 w-3.5" /> Add condition
                </Button>
              </div>
            </TabsContent>

            <TabsContent value="do" className="space-y-3 pt-3">
              {actions.map((a, i) => (
                <ActionRow
                  key={i}
                  action={a}
                  categories={categories}
                  catById={catById}
                  onChange={(patch) => updateAction(i, patch)}
                  onRemove={() => removeAction(i)}
                  removable={actions.length > 1}
                />
              ))}
              <Button variant="outline" size="sm" onClick={addAction}>
                <Plus className="mr-2 h-3.5 w-3.5" /> Add action
              </Button>
            </TabsContent>
          </Tabs>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            <span>Enabled</span>
          </label>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!canSubmit || saving}>
            {saving ? "Saving…" : isEdit ? "Save changes" : "Create rule"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ConditionRow({
  condition,
  accounts,
  accById,
  onChange,
  onRemove,
  removable,
}: {
  condition: RuleCondition;
  accounts: Account[];
  accById: Map<string, Account>;
  onChange: (patch: Partial<RuleCondition>) => void;
  onRemove: () => void;
  removable: boolean;
}) {
  const operators = operatorsForField(condition.field);
  const valueIsAccount = condition.field === "account_id";

  return (
    <div className="grid grid-cols-[140px_140px_1fr_auto] items-center gap-2">
      <Select
        value={condition.field}
        onValueChange={(v) => {
          const field = v as RuleField;
          const ops = operatorsForField(field);
          onChange({
            field,
            operator: ops[0].value,
            value: "",
            value2: undefined,
          });
        }}
      >
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {FIELD_OPTIONS.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={condition.operator}
        onValueChange={(v) => onChange({ operator: v as RuleOperator })}
      >
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {operators.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {valueIsAccount ? (
        <Select
          value={condition.value || (accounts[0]?.id ?? "")}
          onValueChange={(v) => onChange({ value: v })}
        >
          <SelectTrigger>
            <SelectValue placeholder="Pick account" />
          </SelectTrigger>
          <SelectContent>
            {accounts.map((a) => (
              <SelectItem key={a.id} value={a.id}>
                {a.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : condition.operator === "between" ? (
        <div className="grid grid-cols-2 gap-2">
          <Input
            value={condition.value}
            onChange={(e) => onChange({ value: e.target.value })}
            placeholder="min"
          />
          <Input
            value={condition.value2 ?? ""}
            onChange={(e) => onChange({ value2: e.target.value })}
            placeholder="max"
          />
        </div>
      ) : (
        <Input
          value={condition.value}
          onChange={(e) => onChange({ value: e.target.value })}
          placeholder={condition.field === "amount" ? "e.g. 100" : "value"}
        />
      )}

      {removable && (
        <Button variant="ghost" size="icon" onClick={onRemove} aria-label="Remove condition">
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  );
}

function ActionRow({
  action,
  categories,
  catById,
  onChange,
  onRemove,
  removable,
}: {
  action: RuleAction;
  categories: DecryptedCategory[];
  catById: Map<string, DecryptedCategory>;
  onChange: (patch: Partial<RuleAction>) => void;
  onRemove: () => void;
  removable: boolean;
}) {
  const isCategory = action.type === "set_category";
  const isValueless = action.type === "mark_reviewed" || action.type === "hide";

  return (
    <div className="grid grid-cols-[180px_1fr_auto] items-center gap-2">
      <Select
        value={action.type}
        onValueChange={(v) => onChange({ type: v as RuleActionType, value: "" })}
      >
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {ACTION_OPTIONS.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {isValueless ? (
        <span className="text-xs text-muted-foreground">No value needed</span>
      ) : isCategory ? (
        <Select
          value={action.value || (categories[0]?.id ?? "")}
          onValueChange={(v) => onChange({ value: v })}
        >
          <SelectTrigger>
            <SelectValue placeholder="Pick category" />
          </SelectTrigger>
          <SelectContent className="max-h-60">
            {categories.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <Input
          value={action.value}
          onChange={(e) => onChange({ value: e.target.value })}
          placeholder={
            action.type === "add_tag"
              ? "e.g. subscription"
              : action.type === "set_merchant"
                ? "e.g. Starbucks"
                : "value"
          }
        />
      )}

      {removable && (
        <Button variant="ghost" size="icon" onClick={onRemove} aria-label="Remove action">
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  );
}
