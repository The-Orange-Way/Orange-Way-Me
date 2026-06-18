/**
 * TransactionsList — proper HTML <table> with table-fixed columns so amounts,
 * accounts, and categories line up perfectly across every row. Click a row
 * to expand details. Hover-reveal action buttons.
 */
import { Fragment, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Check, ChevronDown, Edit2, Split, Trash2, Tag } from "lucide-react";
import { format, parseISO } from "date-fns";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { formatCurrencyWithMode } from "@/lib/format";
import { useDashboardPrefs } from "@/hooks/useDashboardPrefs";
import { numberLocale } from "@/lib/locale";
import type { Account } from "@/lib/connectors";
import type { DecryptedCategory } from "@/hooks/useCategories";
import type { DecryptedTxn } from "@/hooks/useTransactions";
import {
  useBudgetForMonth,
  type BudgetRecord,
  type CategoryBudgetData,
  type FlexBudgetData,
  type FlexBucketKey,
} from "@/hooks/useBudgets";

export interface RowAction {
  onEdit: (t: DecryptedTxn) => void;
  onSplit: (t: DecryptedTxn) => void;
  onCategorize: (t: DecryptedTxn) => void;
  onDelete: (t: DecryptedTxn) => void;
  /** Quick-pick category change from the expanded row's combobox. */
  onSetCategory?: (t: DecryptedTxn, categoryId: string | null) => Promise<void>;
}

export function TransactionsList({
  items,
  accounts,
  categories,
  selected,
  onToggleSelect,
  highlight,
  rowActions,
}: {
  items: DecryptedTxn[];
  accounts: Account[];
  categories: DecryptedCategory[];
  selected: Set<string>;
  onToggleSelect: (id: string) => void;
  highlight?: string;
  rowActions: RowAction;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const navigate = useNavigate();
  const { prefs } = useDashboardPrefs();
  const loc = numberLocale(prefs.numberFormat);

  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const catById = new Map(categories.map((c) => [c.id, c]));

  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-12 text-center text-sm text-muted-foreground">
        No transactions match.
      </div>
    );
  }

  // Day-grouped buckets feed the Monarch-style mobile card view. Same items,
  // different shell. Items are already sorted newest-first by the caller.
  const dayBuckets = items.reduce<Array<{ date: string; total: number; rows: DecryptedTxn[] }>>(
    (acc, t) => {
      const last = acc[acc.length - 1];
      const n = Number(t.amount);
      if (last && last.date === t.date) {
        last.total += n;
        last.rows.push(t);
      } else {
        acc.push({ date: t.date, total: n, rows: [t] });
      }
      return acc;
    },
    [],
  );

  return (
    <>
      {/* Mobile card view — Monarch-inspired day-grouped rows. */}
      <div className="space-y-3 md:hidden">
        {dayBuckets.map((bucket) => (
          <div key={bucket.date} className="overflow-hidden rounded-lg border border-border">
            <div className="flex items-center justify-between bg-muted/40 px-3 py-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              <span>{format(parseISO(bucket.date), "EEE, MMM d")}</span>
              <span
                className={cn(
                  "font-mono tabular-nums",
                  bucket.total < 0 ? "text-destructive" : "text-emerald-600 dark:text-emerald-400",
                )}
              >
                {`${bucket.total < 0 ? "-" : "+"}${formatCurrencyWithMode(
                  Math.abs(bucket.total),
                  bucket.rows[0]?.currency ||
                    accountById.get(bucket.rows[0]?.account_id ?? "")?.currency ||
                    "USD",
                  prefs.btcDisplayMode,
                  loc,
                )}`}
              </span>
            </div>
            <ul className="divide-y divide-border">
              {bucket.rows.map((t) => {
                const acc = accountById.get(t.account_id);
                const cat = t.category_id ? catById.get(t.category_id) : null;
                const n = Number(t.amount);
                const negative = n < 0;
                const name = (t.merchant ?? t.description ?? "").trim();
                return (
                  <li
                    key={t.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => rowActions.onEdit(t)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        rowActions.onEdit(t);
                      }
                    }}
                    className="flex cursor-pointer items-center gap-3 px-3 py-3 hover:bg-muted/30"
                  >
                    <span
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold"
                      style={{
                        background: (cat?.color ?? "#94a3b8") + "22",
                        color: cat?.color ?? "#94a3b8",
                      }}
                      aria-hidden="true"
                    >
                      {(name.match(/[A-Za-z]/)?.[0] ?? "?").toUpperCase()}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold text-foreground">
                        {name || (
                          <span className="italic text-muted-foreground">(no description)</span>
                        )}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        {[cat?.name, acc?.name].filter(Boolean).join(" · ") || "Uncategorized"}
                      </div>
                    </div>
                    <div
                      className={cn(
                        "shrink-0 font-mono text-base font-semibold tabular-nums",
                        negative ? "text-destructive" : "text-emerald-600 dark:text-emerald-400",
                      )}
                    >
                      {`${negative ? "-" : "+"}${formatCurrencyWithMode(
                        Math.abs(n),
                        t.currency || acc?.currency || "USD",
                        prefs.btcDisplayMode,
                        loc,
                      )}`}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>

      {/* Desktop table — full feature set with bulk select + inline category
          pick. Hidden on mobile in favor of the card view above. */}
      <div className="hidden overflow-hidden rounded-lg border border-border md:block">
        <div className="max-h-[640px] overflow-y-auto">
          <table className="w-full table-fixed text-sm">
            <colgroup>
              <col className="w-10" />
              <col className="w-20" />
              <col />
              <col className="w-32" />
              <col className="w-36" />
              <col className="w-40" />
              <col className="w-28" />
            </colgroup>
            <tbody className="divide-y divide-border">
              {items.map((t) => {
                const acc = accountById.get(t.account_id);
                const cat = t.category_id ? catById.get(t.category_id) : null;
                const n = Number(t.amount);
                const negative = n < 0;
                const isSelected = selected.has(t.id);
                const isExpanded = expanded === t.id;

                return (
                  <Fragment key={t.id}>
                    <tr
                      className={cn(
                        "group bg-background transition-colors hover:bg-muted/40",
                        isSelected && "bg-primary/5",
                      )}
                    >
                      <td className="px-3 py-2.5 align-middle">
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={() => onToggleSelect(t.id)}
                          aria-label="Select transaction"
                        />
                      </td>
                      <td
                        className="cursor-pointer px-2 py-2.5 align-middle font-mono text-xs text-muted-foreground"
                        onClick={() => setExpanded(isExpanded ? null : t.id)}
                      >
                        {format(parseISO(t.date), "MMM d")}
                      </td>
                      <td
                        className="cursor-pointer px-2 py-2.5 align-middle"
                        onClick={() => setExpanded(isExpanded ? null : t.id)}
                      >
                        <div className="flex items-center gap-2">
                          <div className="min-w-0 flex-1 truncate text-sm font-semibold">
                            {(() => {
                              const name = (t.merchant ?? t.description ?? "").trim();
                              if (name) return highlightMatch(name, highlight);
                              return (
                                <span className="italic text-muted-foreground">
                                  (no description)
                                </span>
                              );
                            })()}
                          </div>
                          {t.is_split_parent && (
                            <Badge variant="outline" className="shrink-0 text-[10px]">
                              SPLIT
                            </Badge>
                          )}
                          {t.transfer_group_id && (
                            <Badge variant="outline" className="shrink-0 text-[10px]">
                              TRANSFER
                            </Badge>
                          )}
                        </div>
                        {t.merchant && t.description && t.merchant !== t.description && (
                          <div className="truncate text-xs text-muted-foreground">
                            {highlightMatch(t.description, highlight)}
                          </div>
                        )}
                      </td>
                      <td className="hidden px-2 py-2.5 align-middle md:table-cell">
                        {cat ? (
                          <span
                            className="inline-flex max-w-full items-center gap-1.5 truncate rounded-full px-2 py-0.5 text-xs"
                            style={{
                              background: (cat.color ?? "#94a3b8") + "22",
                              color: cat.color ?? "#94a3b8",
                            }}
                          >
                            <span
                              className="h-1.5 w-1.5 shrink-0 rounded-full"
                              style={{ background: cat.color ?? "#94a3b8" }}
                            />
                            <span className="truncate">{cat.name}</span>
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="hidden px-2 py-2.5 align-middle text-xs text-muted-foreground md:table-cell">
                        {acc ? (
                          <span
                            role="link"
                            tabIndex={0}
                            onClick={(e) => {
                              e.stopPropagation();
                              void navigate({ to: "/accounts/$id", params: { id: acc.id } });
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                void navigate({ to: "/accounts/$id", params: { id: acc.id } });
                              }
                            }}
                            className="block cursor-pointer truncate hover:text-foreground hover:underline"
                          >
                            {acc.name}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td
                        className={cn(
                          "px-3 py-2.5 text-right align-middle font-mono text-xs tabular-nums",
                          "whitespace-nowrap",
                          negative ? "text-destructive" : "text-emerald-600 dark:text-emerald-400",
                        )}
                      >
                        {`${negative ? "-" : "+"}${formatCurrencyWithMode(
                          Math.abs(n),
                          t.currency || (acc?.currency ?? "USD"),
                          prefs.btcDisplayMode,
                          loc,
                        )}`}
                      </td>
                      <td className="hidden px-1 py-1 align-middle md:table-cell">
                        <div className="flex items-center justify-end gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => rowActions.onEdit(t)}
                            aria-label="Edit"
                          >
                            <Edit2 className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => rowActions.onSplit(t)}
                            aria-label="Split"
                          >
                            <Split className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => rowActions.onCategorize(t)}
                            aria-label="Categorize"
                          >
                            <Tag className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => rowActions.onDelete(t)}
                            aria-label="Delete"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr className="bg-muted/20">
                        <td colSpan={7} className="px-3 py-3 text-sm sm:px-6">
                          <dl className="grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2">
                            <Detail label="Description" value={t.description} />
                            <Detail label="Account" value={acc?.name ?? "—"} />
                            <div>
                              <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">
                                Category
                              </dt>
                              <dd className="mt-0.5">
                                {rowActions.onSetCategory ? (
                                  <CategoryPicker
                                    txn={t}
                                    current={cat ?? null}
                                    categories={categories}
                                    onChange={rowActions.onSetCategory}
                                  />
                                ) : (
                                  <span>{cat?.name ?? "Uncategorized"}</span>
                                )}
                              </dd>
                            </div>
                            <Detail label="Date" value={format(parseISO(t.date), "MMM d, yyyy")} />
                            {t.memo && <Detail label="Memo" value={t.memo} fullWidth />}
                            {t.tags && t.tags.length > 0 && (
                              <Detail label="Tags" value={t.tags.join(", ")} fullWidth />
                            )}
                          </dl>
                          <BudgetHint txn={t} category={cat ?? null} categories={categories} />

                          {/* Action buttons — always visible (works on mobile and desktop) */}
                          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border/40 pt-3">
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-8"
                              onClick={() => rowActions.onEdit(t)}
                            >
                              <Edit2 className="mr-1.5 h-3.5 w-3.5" />
                              Edit
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-8"
                              onClick={() => rowActions.onSplit(t)}
                            >
                              <Split className="mr-1.5 h-3.5 w-3.5" />
                              Split
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-8"
                              onClick={() => rowActions.onCategorize(t)}
                            >
                              <Tag className="mr-1.5 h-3.5 w-3.5" />
                              Categorize
                            </Button>
                            <div className="ml-auto">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
                                onClick={() => rowActions.onDelete(t)}
                              >
                                <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                                Delete
                              </Button>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function Detail({
  label,
  value,
  fullWidth,
}: {
  label: string;
  value: string;
  fullWidth?: boolean;
}) {
  return (
    <div className={fullWidth ? "col-span-2" : undefined}>
      <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</dt>
      <dd className="text-sm">{value}</dd>
    </div>
  );
}

/**
 * BudgetHint — single muted line in the expanded transaction detail showing
 * what % of the relevant budget bucket / category this transaction consumes.
 */
function BudgetHint({
  txn,
  category,
  categories,
}: {
  txn: DecryptedTxn;
  category: DecryptedCategory | null;
  categories: DecryptedCategory[];
}) {
  const monthAnchor = parseISO(txn.date);
  const budget = useBudgetForMonth(monthAnchor);
  const amt = Math.abs(Number(txn.amount));
  if (!budget || amt <= 0 || txn.split_parent_id || txn.transfer_group_id) return null;
  if (Number(txn.amount) >= 0) return null;
  if (!category) return null;

  const monthName = format(monthAnchor, "MMMM");
  const hint = computeBudgetHint(budget, category, categories, amt, monthName);
  if (!hint) return null;
  return <div className="mt-2 text-xs text-muted-foreground">{hint}</div>;
}

function computeBudgetHint(
  budget: BudgetRecord,
  category: DecryptedCategory,
  categories: DecryptedCategory[],
  amount: number,
  monthName: string,
): string | null {
  if (budget.mode === "flex") {
    const data = budget.data as FlexBudgetData;
    const bucket: FlexBucketKey = data.categoryBucketMap[category.id] ?? "essentials";
    const target = data.buckets[bucket]?.target ?? 0;
    if (target <= 0) return null;
    const pct = (amount / target) * 100;
    return `This transaction uses ${pct.toFixed(1)}% of your ${bucketLabel(bucket)} budget for ${monthName}.`;
  }
  const data = budget.data as CategoryBudgetData;
  const cfg = data.categories[category.id];
  if (!cfg || cfg.target <= 0) {
    let cur: DecryptedCategory | undefined = category;
    const seen = new Set<string>();
    while (cur && cur.parent_id && !seen.has(cur.id)) {
      seen.add(cur.id);
      cur = categories.find((c) => c.id === cur!.parent_id);
      const parentTarget = cur ? (data.categories[cur.id]?.target ?? 0) : 0;
      if (cur && parentTarget > 0) {
        return `This transaction uses ${((amount / parentTarget) * 100).toFixed(1)}% of your ${cur.name} budget for ${monthName}.`;
      }
    }
    return null;
  }
  const pct = (amount / cfg.target) * 100;
  return `This transaction uses ${pct.toFixed(1)}% of your ${category.name} budget for ${monthName}.`;
}

function bucketLabel(b: FlexBucketKey): string {
  if (b === "essentials") return "Essentials";
  if (b === "wants") return "Wants";
  return "Savings & debt";
}

/**
 * CategoryPicker — searchable inline category selector for the expanded row.
 * Click → Popover with a Command (search input + filtered list of categories).
 * Selecting a category calls onChange and closes the popover.
 */
function CategoryPicker({
  txn,
  current,
  categories,
  onChange,
}: {
  txn: DecryptedTxn;
  current: DecryptedCategory | null;
  categories: DecryptedCategory[];
  onChange: (txn: DecryptedTxn, categoryId: string | null) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleSelect = async (categoryId: string | null) => {
    setSaving(true);
    try {
      await onChange(txn, categoryId);
      setOpen(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          disabled={saving}
          className="h-8 justify-between gap-2 px-3 font-normal"
        >
          {current ? (
            <span className="flex items-center gap-1.5">
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ background: current.color ?? "#94a3b8" }}
              />
              {current.name}
            </span>
          ) : (
            <span className="text-muted-foreground">Uncategorized</span>
          )}
          <ChevronDown className="h-3 w-3 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        <Command>
          <CommandInput placeholder="Search category…" className="h-9" />
          <CommandList>
            <CommandEmpty>No category found.</CommandEmpty>
            <CommandGroup>
              <CommandItem value="__uncategorized__" onSelect={() => void handleSelect(null)}>
                <span className="text-muted-foreground">Uncategorized</span>
                {!current && <Check className="ml-auto h-4 w-4" />}
              </CommandItem>
              {categories.map((c) => (
                <CommandItem key={c.id} value={c.name} onSelect={() => void handleSelect(c.id)}>
                  <span
                    className="mr-2 h-2 w-2 shrink-0 rounded-full"
                    style={{ background: c.color ?? "#94a3b8" }}
                  />
                  {c.name}
                  {current?.id === c.id && <Check className="ml-auto h-4 w-4" />}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function highlightMatch(text: string, needle?: string) {
  if (!needle) return text;
  const idx = text.toLowerCase().indexOf(needle.toLowerCase());
  if (idx < 0) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="rounded bg-yellow-300/40 px-0.5 text-foreground">
        {text.slice(idx, idx + needle.length)}
      </mark>
      {text.slice(idx + needle.length)}
    </>
  );
}
