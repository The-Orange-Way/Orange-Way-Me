/**
 * FiltersDrawer — multi-faceted filter sheet for the transactions list.
 */
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import type { Account } from "@/lib/connectors";
import type { DecryptedCategory } from "@/hooks/useCategories";

export type TxnTypeFilter = "all" | "expense" | "income" | "transfer";

export interface TxnFilters {
  accountIds: string[];
  categoryIds: string[];
  amountMin: string;
  amountMax: string;
  hasMemo: boolean;
  type: TxnTypeFilter;
}

export const EMPTY_FILTERS: TxnFilters = {
  accountIds: [],
  categoryIds: [],
  amountMin: "",
  amountMax: "",
  hasMemo: false,
  type: "all",
};

export function FiltersDrawer({
  open,
  onOpenChange,
  accounts,
  categories,
  filters,
  onApply,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  accounts: Account[];
  categories: DecryptedCategory[];
  filters: TxnFilters;
  onApply: (next: TxnFilters) => void;
}) {
  const set = (patch: Partial<TxnFilters>) => onApply({ ...filters, ...patch });
  const toggleId = (key: "accountIds" | "categoryIds", id: string) => {
    const cur = filters[key];
    set({
      [key]: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id],
    } as Partial<TxnFilters>);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[420px] overflow-y-auto sm:max-w-[420px]">
        <SheetHeader>
          <SheetTitle>Filters</SheetTitle>
        </SheetHeader>

        <div className="mt-4 space-y-6">
          <section>
            <div className="mb-2 flex items-center justify-between">
              <Label>Type</Label>
            </div>
            <RadioGroup
              value={filters.type}
              onValueChange={(v) => set({ type: v as TxnTypeFilter })}
            >
              {(["all", "expense", "income", "transfer"] as TxnTypeFilter[]).map((t) => (
                <div key={t} className="flex items-center gap-2">
                  <RadioGroupItem id={`type-${t}`} value={t} />
                  <Label htmlFor={`type-${t}`} className="capitalize">
                    {t}
                  </Label>
                </div>
              ))}
            </RadioGroup>
          </section>

          <section>
            <div className="mb-2 flex items-center justify-between">
              <Label>Accounts</Label>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => set({ accountIds: accounts.map((a) => a.id) })}
                >
                  All
                </Button>
                <Button size="sm" variant="ghost" onClick={() => set({ accountIds: [] })}>
                  None
                </Button>
              </div>
            </div>
            <div className="space-y-1.5">
              {accounts.map((a) => (
                <label key={a.id} className="flex cursor-pointer items-center gap-2">
                  <Checkbox
                    checked={filters.accountIds.includes(a.id)}
                    onCheckedChange={() => toggleId("accountIds", a.id)}
                  />
                  <span className="text-sm">{a.name}</span>
                </label>
              ))}
              {accounts.length === 0 && (
                <div className="text-xs text-muted-foreground">No accounts.</div>
              )}
            </div>
          </section>

          <section>
            <div className="mb-2 flex items-center justify-between">
              <Label>Categories</Label>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => set({ categoryIds: categories.map((c) => c.id) })}
                >
                  All
                </Button>
                <Button size="sm" variant="ghost" onClick={() => set({ categoryIds: [] })}>
                  None
                </Button>
              </div>
            </div>
            <div className="max-h-64 space-y-1.5 overflow-y-auto rounded-md border border-border p-2">
              {categories.map((c) => (
                <label key={c.id} className="flex cursor-pointer items-center gap-2">
                  <Checkbox
                    checked={filters.categoryIds.includes(c.id)}
                    onCheckedChange={() => toggleId("categoryIds", c.id)}
                  />
                  <span
                    className="inline-block h-2 w-2 rounded-full"
                    style={{ background: c.color ?? "#94a3b8" }}
                  />
                  <span className="text-sm">{c.name}</span>
                </label>
              ))}
              {categories.length === 0 && (
                <div className="text-xs text-muted-foreground">No categories.</div>
              )}
            </div>
          </section>

          <section>
            <Label>Amount range</Label>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <Input
                type="number"
                placeholder="Min"
                value={filters.amountMin}
                onChange={(e) => set({ amountMin: e.target.value })}
              />
              <Input
                type="number"
                placeholder="Max"
                value={filters.amountMax}
                onChange={(e) => set({ amountMax: e.target.value })}
              />
            </div>
          </section>

          <section className="flex items-center justify-between rounded-md border border-border p-3">
            <div>
              <Label>Has memo</Label>
              <div className="text-xs text-muted-foreground">Only transactions with notes</div>
            </div>
            <Switch checked={filters.hasMemo} onCheckedChange={(v) => set({ hasMemo: v })} />
          </section>
        </div>

        <SheetFooter className="mt-6">
          <Button variant="outline" onClick={() => onApply(EMPTY_FILTERS)}>
            Reset all
          </Button>
          <Button onClick={() => onOpenChange(false)}>Done</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
