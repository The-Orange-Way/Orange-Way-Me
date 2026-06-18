import { useRef, useState } from "react";
import { Download, Upload, X, FileText, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { toastError } from "@/lib/friendly-error";
import type { DecryptedTxn, TxnDraft } from "@/hooks/useTransactions";

const CSV_HEADERS = [
  "date",
  "amount",
  "currency",
  "merchant",
  "description",
  "category",
  "account",
  "tags",
  "memo",
];

const SAMPLE_ROWS = [
  [
    "2026-04-01",
    "-42.50",
    "USD",
    "Whole Foods",
    "Grocery run",
    "Groceries",
    "Chase Checking",
    "food",
    "",
  ],
  [
    "2026-04-03",
    "-12.00",
    "USD",
    "Netflix",
    "Monthly sub",
    "Streaming",
    "Chase Checking",
    "subscriptions",
    "",
  ],
  ["2026-04-05", "3500.00", "USD", "Employer Inc", "Salary", "Salary", "Chase Checking", "", ""],
  [
    "2026-04-08",
    "-0.00150000",
    "BTC",
    "",
    "DCA buy",
    "DCA purchase",
    "Cold Storage",
    "bitcoin",
    "",
  ],
];

function toCsv(rows: string[][]): string {
  const escape = (v: string) =>
    v.includes(",") || v.includes('"') ? `"${v.replace(/"/g, '""')}"` : v;
  return [CSV_HEADERS, ...rows].map((r) => r.map(escape).join(",")).join("\n");
}

function txnsToCsvRows(
  txns: DecryptedTxn[],
  categoryMap: Map<string, string>,
  accountMap: Map<string, string>,
): string[][] {
  return txns.map((t) => [
    t.date,
    t.amount,
    t.currency,
    t.merchant ?? "",
    t.description,
    t.category_id ? (categoryMap.get(t.category_id) ?? "") : "",
    accountMap.get(t.account_id) ?? "",
    (t.tags ?? []).join(";"),
    t.memo ?? "",
  ]);
}

function downloadCsv(content: string, filename: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else inQ = !inQ;
    } else if (ch === "," && !inQ) {
      out.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur.trim());
  return out;
}

interface ParsedRow {
  date: string;
  amount: string;
  currency: string;
  merchant: string;
  description: string;
  category: string;
  account: string;
  tags: string;
  memo: string;
  valid: boolean;
  error?: string;
}

function parseFile(text: string): ParsedRow[] {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const header = parseCsvLine(lines[0]).map((h) => h.toLowerCase());
  const idx = (name: string) => header.indexOf(name);
  return lines.slice(1).map((line) => {
    const cols = parseCsvLine(line);
    const get = (name: string) => cols[idx(name)] ?? "";
    const date = get("date");
    const amount = get("amount");
    const currency = get("currency") || "USD";
    const valid = /^\d{4}-\d{2}-\d{2}$/.test(date) && !isNaN(Number(amount));
    return {
      date,
      amount,
      currency,
      merchant: get("merchant"),
      description: get("description"),
      category: get("category"),
      account: get("account"),
      tags: get("tags"),
      memo: get("memo"),
      valid,
      error: valid ? undefined : `Bad date or amount`,
    };
  });
}

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  transactions: DecryptedTxn[];
  categoryMap: Map<string, string>;
  accountMap: Map<string, string>;
  onImport: (rows: TxnDraft[], defaultAccountId: string) => Promise<void>;
  defaultAccountId: string;
}

export function TxnImportExportDialog({
  open,
  onOpenChange,
  transactions,
  categoryMap,
  accountMap,
  onImport,
  defaultAccountId,
}: Props) {
  const [tab, setTab] = useState<"export" | "import">("export");
  const [preview, setPreview] = useState<ParsedRow[] | null>(null);
  const [fileName, setFileName] = useState("");
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleExport = () => {
    const rows = txnsToCsvRows(transactions, categoryMap, accountMap);
    const csv = toCsv(rows);
    const date = new Date().toISOString().slice(0, 10);
    downloadCsv(csv, `orangeway-transactions-${date}.csv`);
    toast.success(`Exported ${transactions.length} transactions`);
  };

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    file.text().then((text) => {
      const rows = parseFile(text);
      setPreview(rows);
    });
  };

  const handleImport = async () => {
    if (!preview) return;
    const valid = preview.filter((r) => r.valid);
    if (valid.length === 0) {
      toast.error("No valid rows to import");
      return;
    }
    setImporting(true);
    try {
      const drafts: TxnDraft[] = valid.map((r) => ({
        date: r.date,
        amount: r.amount,
        currency: r.currency || "USD",
        description: r.description || r.merchant || "Imported",
        merchant: r.merchant || undefined,
        memo: r.memo || undefined,
        tags: r.tags ? r.tags.split(";").filter(Boolean) : [],
        account_id: defaultAccountId,
      }));
      await onImport(drafts, defaultAccountId);
      toast.success(`Imported ${valid.length} transactions`);
      setPreview(null);
      setFileName("");
      onOpenChange(false);
    } catch (err) {
      toastError(err, "Import failed");
    } finally {
      setImporting(false);
    }
  };

  const validCount = preview?.filter((r) => r.valid).length ?? 0;
  const errorCount = preview ? preview.length - validCount : 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          setPreview(null);
          setFileName("");
        }
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import / Export</DialogTitle>
        </DialogHeader>

        {/* Tab bar */}
        <div className="flex gap-1 rounded-lg bg-muted p-1">
          {(["export", "import"] as const).map((t) => (
            <button
              key={t}
              onClick={() => {
                setTab(t);
                setPreview(null);
                setFileName("");
              }}
              className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium capitalize transition-colors ${
                tab === t
                  ? "bg-background shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t === "export" ? (
                <>
                  <Download className="mr-1.5 inline h-3.5 w-3.5" />
                  Export
                </>
              ) : (
                <>
                  <Upload className="mr-1.5 inline h-3.5 w-3.5" />
                  Import
                </>
              )}
            </button>
          ))}
        </div>

        {tab === "export" && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Downloads all <strong>{transactions.length}</strong> visible transactions as a plain
              CSV file. Open in Excel, Numbers, or any spreadsheet app.
            </p>

            {/* Sample preview */}
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-xs">
                <thead className="border-b border-border bg-muted/50">
                  <tr>
                    {CSV_HEADERS.map((h) => (
                      <th key={h} className="px-2 py-1.5 text-left font-mono text-muted-foreground">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {SAMPLE_ROWS.map((row, i) => (
                    <tr key={i} className="border-b border-border/50 last:border-0">
                      {row.map((cell, j) => (
                        <td key={j} className="px-2 py-1.5 font-mono">
                          {cell || <span className="text-muted-foreground/40">—</span>}
                        </td>
                      ))}
                    </tr>
                  ))}
                  <tr className="bg-muted/20">
                    <td
                      colSpan={CSV_HEADERS.length}
                      className="px-2 py-1 text-center text-muted-foreground"
                    >
                      … {transactions.length} rows total
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button onClick={handleExport} disabled={transactions.length === 0}>
                <Download className="mr-2 h-4 w-4" /> Download CSV
              </Button>
            </div>
          </div>
        )}

        {tab === "import" && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Upload a CSV with columns:{" "}
              <span className="font-mono text-xs">{CSV_HEADERS.join(", ")}</span>. Only{" "}
              <strong>date</strong> and <strong>amount</strong> are required.
            </p>

            {!preview ? (
              <div
                className="flex cursor-pointer flex-col items-center gap-3 rounded-xl border-2 border-dashed border-border p-10 text-center transition-colors hover:border-primary/50 hover:bg-muted/30"
                onClick={() => fileRef.current?.click()}
              >
                <FileText className="h-8 w-8 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">Click to choose a CSV file</p>
                  <p className="text-xs text-muted-foreground">or drag and drop</p>
                </div>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".csv"
                  className="hidden"
                  onChange={handleFile}
                />
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">{fileName}</span>
                  <button
                    onClick={() => {
                      setPreview(null);
                      setFileName("");
                      if (fileRef.current) fileRef.current.value = "";
                    }}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <div className="flex gap-3 text-sm">
                  <span className="text-emerald-600 dark:text-emerald-400">
                    ✓ {validCount} valid
                  </span>
                  {errorCount > 0 && (
                    <span className="text-destructive flex items-center gap-1">
                      <AlertCircle className="h-3.5 w-3.5" /> {errorCount} skipped
                    </span>
                  )}
                </div>

                <div className="max-h-48 overflow-y-auto rounded-lg border border-border">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 border-b border-border bg-muted/80">
                      <tr>
                        <th className="px-2 py-1.5 text-left">date</th>
                        <th className="px-2 py-1.5 text-left">amount</th>
                        <th className="px-2 py-1.5 text-left">currency</th>
                        <th className="px-2 py-1.5 text-left">merchant</th>
                        <th className="px-2 py-1.5 text-left">status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.map((row, i) => (
                        <tr
                          key={i}
                          className={`border-b border-border/50 last:border-0 ${row.valid ? "" : "bg-destructive/5"}`}
                        >
                          <td className="px-2 py-1 font-mono">{row.date}</td>
                          <td className="px-2 py-1 font-mono">{row.amount}</td>
                          <td className="px-2 py-1 font-mono">{row.currency}</td>
                          <td className="px-2 py-1">{row.merchant || "—"}</td>
                          <td className="px-2 py-1">
                            {row.valid ? (
                              <span className="text-emerald-600 dark:text-emerald-400">✓</span>
                            ) : (
                              <span className="text-destructive text-[10px]">{row.error}</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button onClick={handleImport} disabled={!preview || validCount === 0 || importing}>
                <Upload className="mr-2 h-4 w-4" />
                {importing ? "Importing…" : `Import ${validCount} rows`}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
