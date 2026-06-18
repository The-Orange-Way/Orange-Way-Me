import { useMemo, useState } from "react";
import Papa from "papaparse";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Alert, AlertDescription } from "@/components/ui/alert";
import type { AccountTypeKey, ConnectorFlowProps, TransactionDraft } from "../types";
import { ACCOUNT_TYPES, CURRENCIES } from "../constants";

type Step = "upload" | "map" | "confirm";

interface ParsedCsv {
  headers: string[];
  rows: Record<string, string>[];
}

interface Mapping {
  date: string;
  description: string;
  amount: string;
  category: string; // optional ("" = none)
}

const NONE = "__none__";

function guessMapping(headers: string[]): Mapping {
  const lower = headers.map((h) => h.toLowerCase());
  const find = (...keys: string[]) => {
    for (const k of keys) {
      const i = lower.findIndex((h) => h.includes(k));
      if (i >= 0) return headers[i];
    }
    return "";
  };
  return {
    date: find("date", "posted"),
    description: find("description", "name", "merchant", "memo", "details"),
    amount: find("amount", "value"),
    category: find("category"),
  };
}

function parseAmount(raw: string): string | null {
  if (raw == null) return null;
  // Strip currency symbols, spaces, and thousand separators (US/EU heuristic).
  let s = raw.trim().replace(/[\s$£€]/g, "");
  // Parens = negative (accounting style).
  const parenNeg = /^\(.*\)$/.test(s);
  if (parenNeg) s = s.slice(1, -1);
  // If both . and , present, assume , is thousand separator.
  if (s.includes(",") && s.includes(".")) {
    s = s.replace(/,/g, "");
  } else if (s.includes(",") && !s.includes(".")) {
    // Likely European decimal.
    s = s.replace(/\./g, "").replace(",", ".");
  }
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  if (parenNeg && !s.startsWith("-")) s = `-${s}`;
  return s;
}

function parseDate(raw: string): string | null {
  if (!raw) return null;
  const t = raw.trim();
  // YYYY-MM-DD already
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10);
  // MM/DD/YYYY or M/D/YYYY
  const us = t.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
  if (us) {
    const [, m, d, y] = us;
    const yyyy = y.length === 2 ? `20${y}` : y;
    return `${yyyy}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  const dt = new Date(t);
  if (!Number.isNaN(dt.getTime())) {
    return dt.toISOString().slice(0, 10);
  }
  return null;
}

export function CsvFlow({ onComplete, onCancel }: ConnectorFlowProps) {
  const [step, setStep] = useState<Step>("upload");
  const [parsed, setParsed] = useState<ParsedCsv | null>(null);
  const [mapping, setMapping] = useState<Mapping>({
    date: "",
    description: "",
    amount: "",
    category: "",
  });
  const [name, setName] = useState("");
  const [type, setType] = useState<AccountTypeKey>("checking");
  const [currency, setCurrency] = useState("USD");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const onFile = (file: File) => {
    setError(null);
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const headers = results.meta.fields ?? [];
        if (!headers.length) {
          setError("No columns detected in the file.");
          return;
        }
        const rows = results.data.filter((r) =>
          Object.values(r).some((v) => v && String(v).trim()),
        );
        setParsed({ headers, rows });
        setMapping(guessMapping(headers));
        if (!name) setName(file.name.replace(/\.[^.]+$/, ""));
        setStep("map");
      },
      error: (err) => setError(err.message),
    });
  };

  const draftTxns: TransactionDraft[] = useMemo(() => {
    if (!parsed || !mapping.date || !mapping.description || !mapping.amount) return [];
    const out: TransactionDraft[] = [];
    for (const row of parsed.rows) {
      const date = parseDate(row[mapping.date] ?? "");
      const amount = parseAmount(row[mapping.amount] ?? "");
      const description = (row[mapping.description] ?? "").trim();
      if (!date || amount == null || !description) continue;
      out.push({
        date,
        amount,
        description,
        category_id:
          mapping.category && mapping.category !== NONE ? row[mapping.category] || null : null,
      });
    }
    return out;
  }, [parsed, mapping]);

  const computedBalance = useMemo(() => {
    let total = 0;
    for (const t of draftTxns) total += Number(t.amount);
    return total.toFixed(2);
  }, [draftTxns]);

  const onSubmit = async () => {
    if (!name.trim() || draftTxns.length === 0) return;
    setSubmitting(true);
    try {
      await onComplete({
        name: name.trim(),
        type,
        currency,
        institution: null,
        balance: computedBalance,
        metadata: { source: "csv", imported_count: draftTxns.length },
        seedTransactions: draftTxns,
      });
    } finally {
      setSubmitting(false);
    }
  };

  if (step === "upload") {
    return (
      <div className="space-y-4">
        <label
          htmlFor="csv-file"
          className="flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-border bg-muted/30 p-10 text-center transition-colors hover:bg-muted/50"
        >
          <Upload className="h-7 w-7 text-muted-foreground" />
          <div>
            <div className="text-sm font-medium">Click to upload a CSV</div>
            <div className="text-xs text-muted-foreground">
              Most banks let you export statements as CSV.
            </div>
          </div>
          <input
            id="csv-file"
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onFile(f);
            }}
          />
        </label>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <div className="flex justify-end">
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  if (step === "map" && parsed) {
    const headerOpts = parsed.headers;
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Detected {parsed.headers.length} columns and {parsed.rows.length} rows. Map them to Orange
          Way fields.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <MapField
            label="Date *"
            value={mapping.date}
            onChange={(v) => setMapping({ ...mapping, date: v })}
            options={headerOpts}
          />
          <MapField
            label="Description *"
            value={mapping.description}
            onChange={(v) => setMapping({ ...mapping, description: v })}
            options={headerOpts}
          />
          <MapField
            label="Amount *"
            value={mapping.amount}
            onChange={(v) => setMapping({ ...mapping, amount: v })}
            options={headerOpts}
          />
          <MapField
            label="Category"
            value={mapping.category}
            onChange={(v) => setMapping({ ...mapping, category: v })}
            options={headerOpts}
            optional
          />
        </div>
        <div className="flex justify-between">
          <Button variant="ghost" onClick={() => setStep("upload")}>
            Back
          </Button>
          <Button
            onClick={() => setStep("confirm")}
            disabled={
              !mapping.date || !mapping.description || !mapping.amount || draftTxns.length === 0
            }
          >
            Preview ({draftTxns.length} rows)
          </Button>
        </div>
      </div>
    );
  }

  if (step === "confirm") {
    const preview = draftTxns.slice(0, 10);
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-3">
          <div className="space-y-2">
            <Label htmlFor="acc-name">Account name</Label>
            <Input id="acc-name" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="space-y-2">
            <Label>Type</Label>
            <Select value={type} onValueChange={(v) => setType(v as AccountTypeKey)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ACCOUNT_TYPES.map((t) => (
                  <SelectItem key={t.key} value={t.key}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Currency</Label>
            <Select value={currency} onValueChange={setCurrency}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CURRENCIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-28">Date</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {preview.map((t, i) => (
                <TableRow key={i}>
                  <TableCell className="font-mono text-xs">{t.date}</TableCell>
                  <TableCell className="max-w-[280px] truncate">{t.description}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{t.amount}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <p className="text-xs text-muted-foreground">
          Showing first 10 of {draftTxns.length} valid rows. Net total:{" "}
          <span className="font-mono">{computedBalance}</span>
        </p>

        <div className="flex justify-between">
          <Button variant="ghost" onClick={() => setStep("map")} disabled={submitting}>
            Back
          </Button>
          <Button onClick={onSubmit} disabled={submitting || !name.trim()}>
            {submitting ? "Encrypting & importing…" : `Import ${draftTxns.length} transactions`}
          </Button>
        </div>
      </div>
    );
  }

  return null;
}

function MapField({
  label,
  value,
  onChange,
  options,
  optional,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
  optional?: boolean;
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Select
        value={value || (optional ? NONE : undefined)}
        onValueChange={(v) => onChange(v === NONE ? "" : v)}
      >
        <SelectTrigger>
          <SelectValue placeholder="Select column…" />
        </SelectTrigger>
        <SelectContent>
          {optional && <SelectItem value={NONE}>— None —</SelectItem>}
          {options.map((o) => (
            <SelectItem key={o} value={o}>
              {o}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
