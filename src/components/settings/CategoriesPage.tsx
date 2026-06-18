/**
 * CategoriesPage — manage the category tree (create, edit, reparent, delete
 * with reassignment). All data is encrypted at rest; display/edit happens
 * on decrypted copies held only in this component's state.
 */
import { useMemo, useState } from "react";
import { ArrowLeft, ChevronDown, ChevronRight, Edit2, Plus, Trash2 } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { toastError } from "@/lib/friendly-error";
import {
  useCategories,
  type CategoryTreeNode,
  type CategoryType,
  type DecryptedCategory,
} from "@/hooks/useCategories";
import { CategoryFormDialog } from "./CategoryFormDialog";
import { DeleteCategoryDialog } from "./DeleteCategoryDialog";

export function CategoriesPage() {
  const {
    categories,
    tree,
    loading,
    createCategory,
    updateCategory,
    deleteCategory,
    countTransactionsInCategory,
    seedDefaults,
  } = useCategories();

  const [formOpen, setFormOpen] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [editing, setEditing] = useState<DecryptedCategory | null>(null);
  const [parentForNew, setParentForNew] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DecryptedCategory | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  const toggleExpanded = (id: string) => {
    setExpanded((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const openCreate = (parentId: string | null) => {
    setEditing(null);
    setParentForNew(parentId);
    setFormOpen(true);
  };

  const openEdit = (c: DecryptedCategory) => {
    setEditing(c);
    setParentForNew(null);
    setFormOpen(true);
  };

  const handleSave = async (draft: {
    name: string;
    color: string;
    icon: string;
    parent_id: string | null;
    type: CategoryType;
  }) => {
    try {
      if (editing) {
        await updateCategory(editing.id, draft);
        toast.success("Category updated");
      } else {
        await createCategory(draft);
        toast.success("Category created");
      }
      setFormOpen(false);
    } catch (err) {
      toastError(err, "Save failed");
    }
  };

  const totalTop = useMemo(
    () => ({
      income: tree.filter((t) => t.type === "income").length,
      expense: tree.filter((t) => t.type === "expense").length,
      transfer: tree.filter((t) => t.type === "transfer").length,
    }),
    [tree],
  );

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
            <h1 className="text-2xl font-bold tracking-tight">Categories</h1>
            <p className="text-sm text-muted-foreground">
              {categories.length} total · {totalTop.income} income · {totalTop.expense} expense ·{" "}
              {totalTop.transfer} transfer
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            {categories.length === 0 && !loading && (
              <Button
                variant="outline"
                disabled={seeding}
                onClick={async () => {
                  setSeeding(true);
                  try {
                    await seedDefaults();
                    toast.success("Default categories added");
                  } catch (err) {
                    toastError(err, "Seed failed");
                  } finally {
                    setSeeding(false);
                  }
                }}
              >
                {seeding ? "Seeding…" : "Seed defaults"}
              </Button>
            )}
            <Button onClick={() => openCreate(null)}>
              <Plus className="mr-2 h-4 w-4" /> New category
            </Button>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="rounded-lg border border-border p-12 text-center text-sm text-muted-foreground">
          Decrypting categories…
        </div>
      ) : tree.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-12 text-center text-sm text-muted-foreground">
          No categories yet. Start with "Seed defaults" or create one manually.
        </div>
      ) : (
        <div className="rounded-lg border border-border">
          {tree.map((node) => (
            <CategoryRow
              key={node.id}
              node={node}
              depth={0}
              expanded={expanded}
              onToggle={toggleExpanded}
              onEdit={openEdit}
              onAddChild={(id) => openCreate(id)}
              onDelete={(c) => setDeleteTarget(c)}
            />
          ))}
        </div>
      )}

      <CategoryFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        initial={editing}
        defaultParentId={parentForNew}
        categories={categories}
        onSave={handleSave}
      />

      <DeleteCategoryDialog
        target={deleteTarget}
        categories={categories}
        countInCategory={countTransactionsInCategory}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={async (targetId, reassignTo) => {
          try {
            await deleteCategory(targetId, reassignTo);
            toast.success("Category deleted");
          } catch (err) {
            toastError(err, "Delete failed");
          } finally {
            setDeleteTarget(null);
          }
        }}
      />
    </div>
  );
}

function CategoryRow({
  node,
  depth,
  expanded,
  onToggle,
  onEdit,
  onAddChild,
  onDelete,
}: {
  node: CategoryTreeNode;
  depth: number;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  onEdit: (c: DecryptedCategory) => void;
  onAddChild: (id: string) => void;
  onDelete: (c: DecryptedCategory) => void;
}) {
  const hasChildren = node.children.length > 0;
  const isOpen = expanded.has(node.id);

  return (
    <>
      <div
        className="group flex items-center gap-2 border-b border-border px-3 py-2 last:border-b-0 hover:bg-muted/40"
        style={{ paddingLeft: 12 + depth * 20 }}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={() => onToggle(node.id)}
            className="flex h-6 w-6 items-center justify-center text-muted-foreground hover:text-foreground"
            aria-label={isOpen ? "Collapse" : "Expand"}
          >
            {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
        ) : (
          <div className="h-6 w-6" />
        )}

        <span
          className="h-3 w-3 shrink-0 rounded-full"
          style={{ background: node.color ?? "#94a3b8" }}
        />
        <span className="text-sm font-medium">{node.name}</span>
        <Badge variant="outline" className="text-[10px] capitalize">
          {node.type}
        </Badge>

        <div className="flex-1" />

        <div className="flex items-center opacity-0 transition-opacity group-hover:opacity-100">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onAddChild(node.id)}
            aria-label="Add child"
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" onClick={() => onEdit(node)} aria-label="Edit">
            <Edit2 className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onDelete(node)}
            aria-label="Delete"
            className="text-destructive"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {isOpen &&
        node.children.map((child) => (
          <CategoryRow
            key={child.id}
            node={child}
            depth={depth + 1}
            expanded={expanded}
            onToggle={onToggle}
            onEdit={onEdit}
            onAddChild={onAddChild}
            onDelete={onDelete}
          />
        ))}
    </>
  );
}
