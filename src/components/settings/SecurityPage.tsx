import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useAsyncAction } from "@/hooks/useAsyncAction";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  Copy,
  Download,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  Printer,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useVault } from "@/context/VaultContext";
import { useDashboardPrefs } from "@/hooks/useDashboardPrefs";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { toastError } from "@/lib/friendly-error";
import { MIN_VAULT_PASSWORD_LENGTH } from "@/lib/vault";

export function SecurityPage() {
  const { changeVaultPassword, regenerateRecoveryCode, vaultKeyVersion } = useVault();
  const { prefs, update } = useDashboardPrefs();
  const [recoveryWords, setRecoveryWords] = useState<string | null>(null);
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  // Single-flight regeneration. Without this, a double-click would rotate
  // the recovery code twice and silently invalidate the first set the user
  // just saw — a real footgun on a security-relevant action.
  const [regenerateRecovery, regenerating] = useAsyncAction(async () => {
    try {
      const code = await regenerateRecoveryCode();
      setRecoveryWords(code);
      setRecoveryOpen(true);
    } catch (err) {
      toastError(err, "Failed");
    }
  });
  const [vaultPwOpen, setVaultPwOpen] = useState(false);
  const [acctPwOpen, setAcctPwOpen] = useState(false);

  return (
    <div className="space-y-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="-ml-3">
          <Link to="/settings">
            <ArrowLeft className="mr-1 h-4 w-4" />
            Settings
          </Link>
        </Button>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Security</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Vault password, recovery code, and auto-lock controls.
        </p>
      </div>

      {/* Vault encryption status */}
      <VaultEncryptionCard vaultKeyVersion={vaultKeyVersion} />

      {/* Vault password */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="h-4 w-4" />
            Vault password
          </CardTitle>
          <CardDescription>
            Your vault password encrypts all financial data. It never leaves this device.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" onClick={() => setVaultPwOpen(true)}>
            <KeyRound className="mr-2 h-4 w-4" />
            Change vault password
          </Button>
        </CardContent>
      </Card>

      {/* Recovery code */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <RefreshCw className="h-4 w-4" />
            Recovery code
          </CardTitle>
          <CardDescription>
            12 words that can restore access if you forget your vault password. Store them somewhere
            safe.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            variant="outline"
            onClick={() => void regenerateRecovery()}
            disabled={regenerating}
          >
            {regenerating ? "Regenerating…" : "Regenerate recovery code"}
          </Button>
          <p className="mt-2 text-xs text-muted-foreground">
            This invalidates your previous recovery code immediately.
          </p>
        </CardContent>
      </Card>

      {/* Account password */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Account password</CardTitle>
          <CardDescription>
            Your Supabase account password (for sign-in). Separate from the vault password.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" onClick={() => setAcctPwOpen(true)}>
            Change account password
          </Button>
        </CardContent>
      </Card>

      {/* Auto-lock */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Auto-lock</CardTitle>
          <CardDescription>Lock the vault after a period of inactivity.</CardDescription>
        </CardHeader>
        <CardContent>
          <Select
            value={String(prefs.autoLockMinutes)}
            onValueChange={(v) => update({ autoLockMinutes: Number(v) })}
          >
            <SelectTrigger className="max-w-[200px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="0">Off</SelectItem>
              <SelectItem value="5">5 minutes</SelectItem>
              <SelectItem value="10">10 minutes</SelectItem>
              <SelectItem value="30">30 minutes</SelectItem>
              <SelectItem value="60">1 hour</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {/* Dialogs */}
      <ChangeVaultPasswordDialog
        open={vaultPwOpen}
        onOpenChange={setVaultPwOpen}
        onChange={changeVaultPassword}
      />
      <ChangeAccountPasswordDialog open={acctPwOpen} onOpenChange={setAcctPwOpen} />
      <RecoveryCodeDialog
        open={recoveryOpen}
        onOpenChange={setRecoveryOpen}
        code={recoveryWords ?? ""}
      />
    </div>
  );
}

function VaultEncryptionCard({ vaultKeyVersion }: { vaultKeyVersion: number | null }) {
  // Null means the metadata row hasn't loaded yet. Every vault is Argon2id v1;
  // there is no legacy tier and no upgrade path to surface.
  if (vaultKeyVersion === null) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Lock className="h-4 w-4" />
          Vault encryption
        </CardTitle>
        <CardDescription>
          Protected by Argon2id — 64 MiB memory-hard key derivation. Your data is encrypted on this
          device before it ever reaches our servers.
        </CardDescription>
      </CardHeader>
    </Card>
  );
}

function ChangeVaultPasswordDialog({
  open,
  onOpenChange,
  onChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onChange: (current: string, next: string) => Promise<void>;
}) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNext, setShowNext] = useState(false);
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setCurrent("");
    setNext("");
    setConfirm("");
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (next.length < MIN_VAULT_PASSWORD_LENGTH) {
      toast.error(`New password must be at least ${MIN_VAULT_PASSWORD_LENGTH} characters`);
      return;
    }
    if (next !== confirm) {
      toast.error("Passwords do not match");
      return;
    }
    setSaving(true);
    try {
      await onChange(current, next);
      toast.success("Vault password changed");
      reset();
      onOpenChange(false);
    } catch (err) {
      toastError(err, "Failed");
    } finally {
      setSaving(false);
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
          <DialogTitle>Change vault password</DialogTitle>
          <DialogDescription>
            Your encrypted data stays intact — only the password wrapper changes.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label>Current password</Label>
            <div className="relative">
              <Input
                type={showCurrent ? "text" : "password"}
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
                required
                autoComplete="current-password"
              />
              <button
                type="button"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                onClick={() => setShowCurrent((s) => !s)}
              >
                {showCurrent ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
          <div className="space-y-2">
            <Label>New password</Label>
            <div className="relative">
              <Input
                type={showNext ? "text" : "password"}
                value={next}
                onChange={(e) => setNext(e.target.value)}
                required
                autoComplete="new-password"
              />
              <button
                type="button"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                onClick={() => setShowNext((s) => !s)}
              >
                {showNext ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
          <div className="space-y-2">
            <Label>Confirm new password</Label>
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
              disabled={saving}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : "Change password"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ChangeAccountPasswordDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setNext("");
    setConfirm("");
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (next !== confirm) {
      toast.error("Passwords do not match");
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: next });
      if (error) throw new Error(error.message);
      toast.success("Account password updated");
      reset();
      onOpenChange(false);
    } catch (err) {
      toastError(err, "Failed");
    } finally {
      setSaving(false);
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
          <DialogTitle>Change account password</DialogTitle>
          <DialogDescription>
            This is your sign-in password, not your vault password.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label>New password</Label>
            <Input
              type="password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              required
              autoComplete="new-password"
            />
          </div>
          <div className="space-y-2">
            <Label>Confirm new password</Label>
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
              disabled={saving}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : "Update password"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RecoveryCodeDialog({
  open,
  onOpenChange,
  code,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  code: string;
}) {
  const [step, setStep] = useState<"reveal" | "verify">("reveal");

  // Reset to reveal step every time the dialog opens with a new code.
  // (Each open() is a regenerate; previous state should not leak.)
  if (open && !code) {
    // Defensive: if opened without a code, close.
    setTimeout(() => onOpenChange(false), 0);
  }
  const reset = () => setStep("reveal");

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-w-lg">
        {step === "reveal" ? (
          <RecoveryRegenReveal code={code} onContinue={() => setStep("verify")} />
        ) : (
          <RecoveryRegenVerify
            code={code}
            onDone={() => {
              onOpenChange(false);
              reset();
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function RecoveryRegenReveal({ code, onContinue }: { code: string; onContinue: () => void }) {
  const words = code.trim().split(/\s+/);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);

  const onCopy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const onDownload = () => {
    const ts = new Date().toISOString();
    const body = [
      "Orange Way - Vault recovery code",
      `Generated: ${ts}`,
      "",
      "Keep this somewhere safe. Anyone with this code can reset your vault password.",
      "",
      code,
      "",
    ].join("\n");
    const blob = new Blob([body], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `orangeway-recovery-${ts.slice(0, 10)}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const onPrint = () => {
    const w = window.open("", "_blank", "width=600,height=700");
    if (!w) {
      toast.error("Pop-up blocked - allow pop-ups to print");
      return;
    }
    const ts = new Date().toLocaleString();
    const grid = words
      .map(
        (word, i) =>
          `<div style="padding:8px 12px;border:1px solid #ddd;border-radius:6px;font-family:monospace"><span style="color:#888;font-size:12px">${i + 1}.</span> <strong>${word}</strong></div>`,
      )
      .join("");
    w.document.write(`
      <html><head><title>Orange Way Vault Recovery Code</title></head>
      <body style="font-family:system-ui;padding:32px;max-width:560px;margin:auto">
        <h1 style="font-size:18px">Orange Way - Vault recovery code</h1>
        <p style="color:#666;font-size:13px">Generated: ${ts}</p>
        <p style="font-size:13px"><strong>Keep this somewhere safe.</strong> Anyone with this code can reset your vault password.</p>
        <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin-top:16px">${grid}</div>
      </body></html>
    `);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 250);
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>New recovery code</DialogTitle>
        <DialogDescription>
          This replaces your previous recovery code. Store it somewhere safe.
        </DialogDescription>
      </DialogHeader>

      <div className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
        <p className="text-amber-900 dark:text-amber-200">
          This is your only way to recover your vault if you forget your password. Save it somewhere
          safe now - we cannot show it again or recover it for you.
        </p>
      </div>

      <div className="rounded-xl border bg-muted/40 p-3">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {words.map((word, i) => (
            <div
              key={i}
              className="flex items-baseline gap-1.5 rounded-md border bg-background px-2 py-1.5 font-mono text-sm"
            >
              <span className="text-xs text-muted-foreground">{i + 1}.</span>
              <span className="font-medium">{word}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Button variant="outline" size="sm" onClick={onCopy}>
          {copied ? (
            <Check className="mr-1.5 h-3.5 w-3.5" />
          ) : (
            <Copy className="mr-1.5 h-3.5 w-3.5" />
          )}
          {copied ? "Copied" : "Copy"}
        </Button>
        <Button variant="outline" size="sm" onClick={onDownload}>
          <Download className="mr-1.5 h-3.5 w-3.5" />
          Download
        </Button>
        <Button variant="outline" size="sm" onClick={onPrint}>
          <Printer className="mr-1.5 h-3.5 w-3.5" />
          Print
        </Button>
      </div>

      <label className="flex items-start gap-2 text-sm">
        <Checkbox checked={saved} onCheckedChange={(v) => setSaved(!!v)} className="mt-0.5" />
        <span className="text-muted-foreground">
          I have saved my recovery code in a safe place. I understand it will not be shown again.
        </span>
      </label>

      <DialogFooter>
        <Button className="w-full" disabled={!saved} onClick={onContinue}>
          Continue
        </Button>
      </DialogFooter>
    </>
  );
}

function RecoveryRegenVerify({ code, onDone }: { code: string; onDone: () => void }) {
  const words = code.trim().split(/\s+/);
  const [indices] = useState(() => {
    const a = Math.floor(Math.random() * words.length);
    let b = Math.floor(Math.random() * words.length);
    while (b === a) b = Math.floor(Math.random() * words.length);
    return [a, b].sort((x, y) => x - y);
  });
  const [w1, setW1] = useState("");
  const [w2, setW2] = useState("");
  const [error, setError] = useState<string | null>(null);

  const onVerify = (e: React.FormEvent) => {
    e.preventDefault();
    const ok =
      w1.trim().toLowerCase() === words[indices[0]] &&
      w2.trim().toLowerCase() === words[indices[1]];
    if (!ok) {
      setError("One or both words don't match. Check your saved recovery code.");
      return;
    }
    toast.success("Recovery code confirmed.");
    onDone();
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Confirm your new recovery code</DialogTitle>
        <DialogDescription>
          Type two words from your code so we know you saved it.
        </DialogDescription>
      </DialogHeader>
      <form onSubmit={onVerify} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="rv-w1">Word #{indices[0] + 1}</Label>
          <Input
            id="rv-w1"
            autoFocus
            autoComplete="off"
            value={w1}
            onChange={(e) => {
              setW1(e.target.value);
              setError(null);
            }}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="rv-w2">Word #{indices[1] + 1}</Label>
          <Input
            id="rv-w2"
            autoComplete="off"
            value={w2}
            onChange={(e) => {
              setW2(e.target.value);
              setError(null);
            }}
            required
          />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter className="flex-col gap-2 sm:flex-col">
          <Button type="submit" className="w-full">
            Confirm and continue
          </Button>
          <button
            type="button"
            onClick={onDone}
            className="block w-full text-center text-xs text-muted-foreground hover:text-foreground"
          >
            Skip verification
          </button>
        </DialogFooter>
      </form>
    </>
  );
}
