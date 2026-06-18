/**
 * RulesPage — list, create, edit, duplicate, delete, reorder, and bulk
 * re-run rules against all of the user's transactions.
 */
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, Copy, Edit2, Play, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { toastError } from "@/lib/friendly-error";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useCategories } from "@/hooks/useCategories";
import { useRules, type RuleDraft } from "@/hooks/useRules";
import type { Rule } from "@/lib/rules/types";
import { summarizeActions, summarizeCondition } from "@/lib/rules/engine";
import { RuleBuilderDialog } from "./RuleBuilderDialog";
import { useAccounts } from "@/hooks/useAccounts";
import { useBulkRerunRules } from "@/hooks/useBulkRerunRules";

export function RulesPage() {
  const { rules, loading, createRule, updateRule, deleteRule, duplicateRule } = useRules();
  const { categories } = useCategories();
  const { accounts } = useAccounts();
  const { run: runBulk, busy: bulkBusy, progress: bulkProgress } = useBulkRerunRules();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Rule | null>(null);
  const [confirmRerun, setConfirmRerun] = useState(false);

  const catNameById = new Map(categories.map((c) => [c.id, c.name]));

  const openCreate = () => {
    setEditing(null);
    setFormOpen(true);
  };
  const openEdit = (r: Rule) => {
    setEditing(r);
    setFormOpen(true);
  };

  const handleSave = async (draft: RuleDraft) => {
    try {
      if (editing) {
        await updateRule(editing.id, draft);
        toast.success("Rule updated");
      } else {
        await createRule(draft);
        toast.success("Rule created");
      }
      setFormOpen(false);
    } catch (err) {
      toastError(err, "Save failed");
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteRule(id);
      toast.success("Rule deleted");
    } catch (err) {
      toastError(err, "Delete failed");
    }
  };

  const handleRerun = async () => {
    setConfirmRerun(false);
    try {
      const n = await runBulk();
      toast.success(`Re-ran rules against ${n} transactions`);
    } catch (err) {
      toastError(err, "Re-run failed");
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <Button asChild variant="ghost" size="sm" className="-ml-2 mb-2 h-8">
          <Link to="/settings">
            <ArrowLeft className="mr-2 h-4 w-4" /> Settings
          </Link>
        </Button>
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Rules</h1>
            <p className="text-sm text-muted-foreground">
              Auto-categorize, rename merchants, and tag transactions. Rules run when you add or
              edit a transaction, or when you click Re-run.
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              variant="outline"
              onClick={() => setConfirmRerun(true)}
              disabled={rules.length === 0 || bulkBusy}
            >
              <Play className="mr-2 h-4 w-4" />
              {bulkBusy
                ? `Re-running… ${bulkProgress.done}/${bulkProgress.total}`
                : "Re-run on all"}
            </Button>
            <Button onClick={openCreate}>
              <Plus className="mr-2 h-4 w-4" /> New rule
            </Button>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="rounded-lg border border-border p-12 text-center text-sm text-muted-foreground">
          Decrypting rules…
        </div>
      ) : rules.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-12 text-center text-sm text-muted-foreground">
          No rules yet. Create one to auto-categorize matching transactions.
        </div>
      ) : (
        <div className="space-y-2">
          {rules.map((r) => (
            <RuleCard
              key={r.id}
              rule={r}
              catNameById={catNameById}
              onToggle={async (enabled) => {
                try {
                  await updateRule(r.id, { is_enabled: enabled });
                } catch (err) {
                  toastError(err, "Toggle failed");
                }
              }}
              onEdit={() => openEdit(r)}
              onDuplicate={async () => {
                try {
                  await duplicateRule(r.id);
                  toast.success("Rule duplicated");
                } catch (err) {
                  toastError(err, "Duplicate failed");
                }
              }}
              onDelete={() => handleDelete(r.id)}
            />
          ))}
        </div>
      )}

      <RuleBuilderDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        initial={editing}
        categories={categories}
        accounts={accounts}
        onSave={handleSave}
      />

      <AlertDialog open={confirmRerun} onOpenChange={setConfirmRerun}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Re-run rules on all transactions?</AlertDialogTitle>
            <AlertDialogDescription>
              This re-applies all enabled rules to every transaction. Transactions you manually
              categorized are preserved — rules will not overwrite their category, though they may
              still add tags or update merchants.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleRerun}>Re-run</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function RuleCard({
  rule,
  catNameById,
  onToggle,
  onEdit,
  onDuplicate,
  onDelete,
}: {
  rule: Rule;
  catNameById: Map<string, string>;
  onToggle: (enabled: boolean) => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const conditions = rule.conditions.map(summarizeCondition);
  const actions = summarizeActions(rule.actions, catNameById);

  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-semibold">{rule.name}</span>
            {!rule.is_enabled && <Badge variant="outline">Disabled</Badge>}
            <span className="text-xs text-muted-foreground">
              · Fired {rule.fire_count} time{rule.fire_count === 1 ? "" : "s"}
            </span>
          </div>
          <div className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">When </span>
            {conditions.length === 0 ? (
              <span>(no conditions)</span>
            ) : (
              conditions.map((c, i) => (
                <span key={i}>
                  {c}
                  {i < conditions.length - 1 && (
                    <span className="mx-1 text-[10px] uppercase">
                      {rule.match_mode === "all" ? "AND" : "OR"}
                    </span>
                  )}
                </span>
              ))
            )}
          </div>
          <div className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">Do </span>
            {actions.length === 0 ? (
              <span>(no actions)</span>
            ) : (
              actions.map((a, i) => (
                <span key={i}>
                  {a}
                  {i < actions.length - 1 && <span className="mx-1">·</span>}
                </span>
              ))
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Switch checked={rule.is_enabled} onCheckedChange={onToggle} />
          <Button variant="ghost" size="icon" onClick={onEdit} aria-label="Edit">
            <Edit2 className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" onClick={onDuplicate} aria-label="Duplicate">
            <Copy className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={onDelete}
            aria-label="Delete"
            className="text-destructive"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}
