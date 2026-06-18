/**
 * BulkActionsBar — appears above the list when ≥1 transaction is selected.
 */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ChevronDown, Tag, Trash2 } from "lucide-react";
import type { DecryptedCategory } from "@/hooks/useCategories";

export function BulkActionsBar({
  count,
  categories,
  onClear,
  onCategorize,
  onAddTag,
  onDelete,
}: {
  count: number;
  categories: DecryptedCategory[];
  onClear: () => void;
  onCategorize: (categoryId: string) => void;
  onAddTag: (tag: string) => void;
  onDelete: () => void;
}) {
  const [tagInput, setTagInput] = useState("");
  const [tagOpen, setTagOpen] = useState(false);

  if (count === 0) return null;

  const submitTag = () => {
    const t = tagInput.trim();
    if (!t) return;
    onAddTag(t);
    setTagInput("");
    setTagOpen(false);
  };

  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm">
      <span className="font-medium">{count} selected</span>
      <span className="flex-1" />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="gap-1">
            Categorize <ChevronDown className="h-3 w-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="max-h-72 overflow-y-auto">
          {categories.map((c) => (
            <DropdownMenuItem key={c.id} onClick={() => onCategorize(c.id)}>
              <span
                className="mr-2 h-2 w-2 rounded-full"
                style={{ background: c.color ?? "#94a3b8" }}
              />
              {c.name}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <Popover open={tagOpen} onOpenChange={setTagOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="gap-1">
            <Tag className="h-3.5 w-3.5" />
            Add tag <ChevronDown className="h-3 w-3" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-64 p-3">
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">Tag name</label>
            <Input
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  submitTag();
                }
              }}
              placeholder="e.g. vacation"
              autoFocus
            />
            <div className="flex justify-end gap-1 pt-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setTagInput("");
                  setTagOpen(false);
                }}
              >
                Cancel
              </Button>
              <Button size="sm" onClick={submitTag} disabled={!tagInput.trim()}>
                Add
              </Button>
            </div>
          </div>
        </PopoverContent>
      </Popover>

      <Button variant="ghost" size="sm" onClick={onDelete} className="text-destructive">
        <Trash2 className="mr-1 h-4 w-4" /> Delete
      </Button>
      <Button variant="ghost" size="sm" onClick={onClear}>
        Clear
      </Button>
    </div>
  );
}
