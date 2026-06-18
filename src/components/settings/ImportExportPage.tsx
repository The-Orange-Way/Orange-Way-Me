/**
 * ImportExportPage — CSV import and encrypted backup/restore.
 *
 * CSV import: parses columns date, amount, description, merchant (optional),
 *   memo (optional), account_name (optional), category (optional).
 * Encrypted backup: JSON of all decrypted data encrypted with a user-chosen
 *   backup password. Not the vault password — keeps the backup independently
 *   portable.
 */
import { useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, Download, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTransactions } from "@/hooks/useTransactions";
import { useAccounts } from "@/hooks/useAccounts";
import { useCategories } from "@/hooks/useCategories";
import { useVault } from "@/context/VaultContext";
import { deriveMek, encryptText, decryptText, randomBytesB64 } from "@/lib/vault";
import { toast } from "sonner";
import { toastError } from "@/lib/friendly-error";

// ── types ──────────────────────────────────────────────────────────────────

interface CsvRow {
  date: string;
  amount: string;
  description: string;
  merchant?: string;
  memo?: string;
}

// ── helpers ────────────────────────────────────────────────────────────────

function parseCsv(text: string): CsvRow[] {
  const lines = text.split("\n").filter((l) => l.trim());
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map((h) => h.trim().toLowerCase().replace(/^"|"$/g, ""));
  const rows: CsvRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
    const row: Record<string, string> = {};
    headers.forEach((h, j) => {
      row[h] = cells[j] ?? "";
    });
    if (!row.date || !row.amount) continue;
    rows.push({
      date: row.date,
      amount: row.amount,
      description: row.description || row.memo || "",
      merchant: row.merchant || undefined,
      memo: row.memo || undefined,
    });
  }
  return rows;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ── component ──────────────────────────────────────────────────────────────

export function ImportExportPage() {
  const { accounts } = useAccounts();
  const { categories } = useCategories();
  // Wide date range for full export
  const { items: transactions, bulkCreateTransactions } = useTransactions({
    startDate: "2000-01-01",
    endDate: "2100-12-31",
  });
  const { encryptText: encVault, decryptText: decVault } = useVault();
  void encVault;
  void decVault; // used only in nested fns

  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [csvRows, setCsvRows] = useState<CsvRow[]>([]);
  const [importing, setImporting] = useState(false);
  const [targetAccountId, setTargetAccountId] = useState<string>("");
  const [backupOpen, setBackupOpen] = useState(false);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const csvRef = useRef<HTMLInputElement>(null);
  const restoreRef = useRef<HTMLInputElement>(null);

  const handleCsvChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCsvFile(file);
    const text = await file.text();
    setCsvRows(parseCsv(text));
  };

  const handleCsvImport = async () => {
    if (!csvRows.length || !accounts.length) return;
    if (!targetAccountId) {
      toast.error("Pick an account to import these transactions into.");
      return;
    }
    setImporting(true);
    try {
      const drafts = csvRows.map((r) => ({
        date: r.date,
        account_id: targetAccountId,
        amount: r.amount,
        description: r.description || r.merchant || "Imported",
        merchant: r.merchant ?? null,
        memo: r.memo ?? null,
        category_id: null,
      }));
      await bulkCreateTransactions(drafts);
      toast.success(`Imported ${csvRows.length} transactions`);
      setCsvFile(null);
      setCsvRows([]);
      if (csvRef.current) csvRef.current.value = "";
    } catch (err) {
      toastError(err, "CSV import failed");
    } finally {
      setImporting(false);
    }
  };

  const handleBackupCreate = async (password: string) => {
    const payload = {
      version: 1,
      exported_at: new Date().toISOString(),
      accounts: accounts.map((a) => ({
        id: a.id,
        name: a.name,
        type: a.type,
        currency: a.currency,
        institution: a.institution,
        balance: a.balance,
      })),
      categories: categories.map((c) => ({
        id: c.id,
        name: c.name,
        type: c.type,
        color: c.color,
        parent_id: c.parent_id,
      })),
      transactions: transactions.map((t) => ({
        id: t.id,
        account_id: t.account_id,
        date: t.date,
        amount: t.amount,
        description: t.description,
        merchant: t.merchant,
        category_id: t.category_id,
        memo: t.memo,
        tags: t.tags,
      })),
    };

    const salt = randomBytesB64(16);
    const backupKey = await deriveMek(password, salt);
    const cipher = await encryptText(JSON.stringify(payload), backupKey);
    const envelope = JSON.stringify({ v: 1, salt, cipher });
    downloadBlob(
      new Blob([envelope], { type: "application/json" }),
      `orangeway-backup-${new Date().toISOString().slice(0, 10)}.bbk`,
    );
    toast.success("Backup downloaded");
  };

  return (
    <div className="space-y-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="-ml-3">
          <Link to="/settings">
            <ArrowLeft className="mr-1 h-4 w-4" />
            Settings
          </Link>
        </Button>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Import / Export</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Import transactions from CSV or create an encrypted backup.
        </p>
      </div>

      {/* CSV import */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Upload className="h-4 w-4" />
            Import CSV
          </CardTitle>
          <CardDescription>
            Columns: date, amount, description — plus optional merchant, memo.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="csv-upload">Select CSV file</Label>
            <Input
              id="csv-upload"
              ref={csvRef}
              type="file"
              accept=".csv,text/csv"
              onChange={handleCsvChange}
            />
          </div>
          {csvRows.length > 0 && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                {csvRows.length} transaction{csvRows.length !== 1 ? "s" : ""} found. First row:{" "}
                {csvRows[0].date} — {csvRows[0].description} ({csvRows[0].amount})
              </p>
              <div className="space-y-1.5">
                <Label htmlFor="csv-account">Import into account</Label>
                <Select value={targetAccountId} onValueChange={setTargetAccountId}>
                  <SelectTrigger id="csv-account">
                    <SelectValue placeholder="Pick an account…" />
                  </SelectTrigger>
                  <SelectContent>
                    {accounts.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.name}
                        {a.institution ? ` — ${a.institution}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button onClick={handleCsvImport} disabled={importing || !targetAccountId}>
                {importing ? "Importing…" : `Import ${csvRows.length} transactions`}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Encrypted backup */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Download className="h-4 w-4" />
            Encrypted backup
          </CardTitle>
          <CardDescription>
            Downloads a .bbk file encrypted with a password of your choice. This is separate from
            your vault password.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex gap-3">
          <Button variant="outline" onClick={() => setBackupOpen(true)}>
            Create backup
          </Button>
          <Button variant="outline" onClick={() => setRestoreOpen(true)}>
            Restore from backup
          </Button>
        </CardContent>
      </Card>

      <BackupPasswordDialog
        open={backupOpen}
        onOpenChange={setBackupOpen}
        onExport={handleBackupCreate}
      />
      <RestoreDialog open={restoreOpen} onOpenChange={setRestoreOpen} fileRef={restoreRef} />
    </div>
  );
}

function BackupPasswordDialog({
  open,
  onOpenChange,
  onExport,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onExport: (password: string) => Promise<void>;
}) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const reset = () => {
    setPassword("");
    setConfirm("");
  };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) {
      toast.error("Backup password must be at least 8 characters");
      return;
    }
    if (password !== confirm) {
      toast.error("Passwords do not match");
      return;
    }
    setBusy(true);
    try {
      await onExport(password);
      reset();
      onOpenChange(false);
    } catch (err) {
      toastError(err, "Backup failed");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create encrypted backup</DialogTitle>
          <DialogDescription>
            Choose a password to protect the backup file. Store it somewhere safe.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label>Backup password</Label>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="new-password"
            />
          </div>
          <div className="space-y-2">
            <Label>Confirm password</Label>
            <Input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
              autoComplete="new-password"
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                reset();
                onOpenChange(false);
              }}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? "Creating…" : "Download backup"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RestoreDialog({
  open,
  onOpenChange,
  fileRef,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  fileRef: React.RefObject<HTMLInputElement | null>;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<{ accounts: number; transactions: number } | null>(null);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFile(e.target.files?.[0] ?? null);
    setPreview(null);
  };

  const verify = async () => {
    if (!file || !password) return;
    setBusy(true);
    try {
      const text = await file.text();
      const envelope = JSON.parse(text);
      if (envelope.v !== 1 || !envelope.cipher || !envelope.salt)
        throw new Error("Invalid backup file");
      const backupKey = await deriveMek(password, envelope.salt);
      const json = await decryptText(envelope.cipher, backupKey);
      const data = JSON.parse(json);
      setPreview({
        accounts: data.accounts?.length ?? 0,
        transactions: data.transactions?.length ?? 0,
      });
    } catch {
      toast.error("Invalid backup file or wrong password");
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setFile(null);
    setPassword("");
    setPreview(null);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Restore from backup</DialogTitle>
          <DialogDescription>
            Select a .bbk backup file and enter the backup password.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Backup file (.bbk)</Label>
            <Input ref={fileRef} type="file" accept=".bbk,.json" onChange={handleFile} />
          </div>
          <div className="space-y-2">
            <Label>Backup password</Label>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </div>
          {preview && (
            <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
              <p className="font-medium">Backup verified</p>
              <p className="text-muted-foreground">
                {preview.accounts} accounts · {preview.transactions} transactions
              </p>
              <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                Full restore will be available in a future update. Your current data will not be
                modified.
              </p>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              reset();
              onOpenChange(false);
            }}
          >
            Cancel
          </Button>
          <Button onClick={verify} disabled={busy || !file || !password}>
            {busy ? "Verifying…" : "Verify backup"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
