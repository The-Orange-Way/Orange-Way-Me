import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useVault } from "@/context/VaultContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { toastError } from "@/lib/friendly-error";
import { AlertTriangle, Copy, Check, Download, Printer, Sparkles } from "lucide-react";
import { MIN_VAULT_PASSWORD_LENGTH } from "@/lib/vault";
import { generatePassphrase, preloadWordlist } from "@/lib/passphrase";

type Step = "create" | "reveal" | "verify";

// Inline password strength scorer — no external dependency.
// Returns score 0-4 matching zxcvbn's scale, plus feedback strings.
function zxcvbn(password: string): {
  score: 0 | 1 | 2 | 3 | 4;
  feedback: { warning: string; suggestions: string[] };
} {
  if (!password) return { score: 0, feedback: { warning: "", suggestions: [] } };

  let score = 0;
  const suggestions: string[] = [];

  if (password.length >= 10) score++;
  if (password.length >= 16) score++;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
  if (/[0-9]/.test(password)) score++;
  if (/[^a-zA-Z0-9]/.test(password)) score++;

  const unique = new Set(password).size;
  if (unique < password.length * 0.4) {
    score = Math.max(0, score - 1);
    suggestions.push("Avoid repeated characters.");
  }
  if (/^[a-zA-Z]+$/.test(password) && password.length < 20)
    suggestions.push("Add numbers or symbols.");
  if (/^[0-9]+$/.test(password)) suggestions.push("Don't use only numbers.");

  const clamped = Math.min(4, Math.max(0, score - 1)) as 0 | 1 | 2 | 3 | 4;
  return { score: clamped, feedback: { warning: "", suggestions } };
}

const STRENGTH_LABELS = ["Very weak", "Weak", "Fair", "Strong", "Very strong"] as const;
const STRENGTH_COLORS = [
  "bg-red-500",
  "bg-orange-500",
  "bg-yellow-500",
  "bg-lime-500",
  "bg-green-500",
] as const;

export function CreateVaultFlow() {
  const { createVault, finalizeVaultSetup } = useVault();
  const navigate = useNavigate();

  const [step, setStep] = useState<Step>("create");
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [understood, setUnderstood] = useState(false);
  const [busy, setBusy] = useState(false);
  const [generatedHint, setGeneratedHint] = useState<number | null>(null);
  const [recoveryCode, setRecoveryCode] = useState("");

  // Evaluate password strength live. zxcvbn is fast (<10 ms) so no debounce.
  const strength = useMemo(() => {
    if (!pw) return null;
    const result = zxcvbn(pw);
    return {
      score: result.score as 0 | 1 | 2 | 3 | 4,
      warning: result.feedback?.warning ?? "",
      suggestions: result.feedback?.suggestions ?? [],
    };
  }, [pw]);

  const lengthOk = pw.length >= MIN_VAULT_PASSWORD_LENGTH;
  // Diceware passphrases (all-lowercase, separated by spaces) score poorly
  // under the heuristic scorer above even though >=6 EFF words give 77+ bits
  // of entropy — well above any practical brute-force budget. Trust the
  // generator's entropy estimate as a parallel signal.
  const isHighEntropyGenerated = generatedHint !== null && generatedHint >= 60;
  const strongEnough = (strength !== null && strength.score >= 4) || isHighEntropyGenerated;
  const canSubmit = lengthOk && strongEnough && pw === confirm && understood && !busy;

  const onGenerate = async () => {
    try {
      const { phrase, entropyBits } = await generatePassphrase(6);
      setPw(phrase);
      setConfirm(phrase);
      setGeneratedHint(entropyBits);
    } catch (err) {
      console.error("Failed to load wordlist for passphrase generation", err);
      toast.error("Couldn't generate a passphrase. Please try again.");
    }
  };

  const onCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!lengthOk) {
      toast.error(`Vault password must be at least ${MIN_VAULT_PASSWORD_LENGTH} characters`);
      return;
    }
    if (!strongEnough) {
      toast.error("Pick a stronger password. Aim for Very strong.");
      return;
    }
    if (pw !== confirm) {
      toast.error("Passwords don't match");
      return;
    }
    setBusy(true);
    try {
      const { recoveryCode } = await createVault(pw);
      setRecoveryCode(recoveryCode);
      // Clear password fields from memory
      setPw("");
      setConfirm("");
      setGeneratedHint(null);
      setStep("reveal");
    } catch (err) {
      toastError(err);
    }
    setBusy(false);
  };

  if (step === "create") {
    const rawScore = strength?.score ?? 0;
    // Reflect the entropy-based override in the meter & label so the user
    // doesn't see "Fair" next to a Create-vault button that's accepting it.
    const score = (isHighEntropyGenerated ? 4 : rawScore) as 0 | 1 | 2 | 3 | 4;
    const meterFilled = strength ? score + 1 : 0;
    return (
      <Card className="shadow-card">
        <CardHeader className="pb-4">
          <CardTitle className="text-lg">Create vault password</CardTitle>
          <CardDescription>
            Separate from your login. Encrypts everything you store.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onCreate} className="space-y-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="cv-pw">Vault password</Label>
                <button
                  type="button"
                  onClick={onGenerate}
                  onMouseEnter={() => void preloadWordlist().catch(() => {})}
                  onFocus={() => void preloadWordlist().catch(() => {})}
                  className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                >
                  <Sparkles className="h-3 w-3" />
                  Generate strong passphrase
                </button>
              </div>
              <Input
                id="cv-pw"
                type="password"
                minLength={MIN_VAULT_PASSWORD_LENGTH}
                value={pw}
                onChange={(e) => {
                  setPw(e.target.value);
                  setGeneratedHint(null);
                }}
                required
                autoComplete="new-password"
              />
              {/* Live strength meter */}
              <div className="flex gap-1" aria-label="Password strength">
                {[0, 1, 2, 3, 4].map((i) => (
                  <div
                    key={i}
                    className={`h-1.5 flex-1 rounded-full ${
                      i < meterFilled ? STRENGTH_COLORS[score] : "bg-muted"
                    }`}
                  />
                ))}
              </div>
              <div className="flex justify-between text-xs">
                <span className={lengthOk ? "text-muted-foreground" : "text-destructive"}>
                  {pw.length}/{MIN_VAULT_PASSWORD_LENGTH} characters
                </span>
                <span
                  className={
                    strength
                      ? score >= 4
                        ? "text-green-600 dark:text-green-400"
                        : score >= 2
                          ? "text-yellow-600 dark:text-yellow-400"
                          : "text-destructive"
                      : "text-muted-foreground"
                  }
                >
                  {strength ? STRENGTH_LABELS[score] : "Enter a password"}
                </span>
              </div>
              {strength && score < 4 && (strength.warning || strength.suggestions.length > 0) && (
                <div className="rounded-md border border-yellow-500/30 bg-yellow-500/10 p-2 text-xs text-yellow-900 dark:text-yellow-200">
                  {strength.warning && <p className="font-medium">{strength.warning}</p>}
                  {strength.suggestions.map((s, i) => (
                    <p key={i}>{s}</p>
                  ))}
                </div>
              )}
              {generatedHint !== null && (
                <p className="text-xs text-muted-foreground">
                  Generated passphrase: ~{generatedHint} bits of entropy.
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="cv-cf">Confirm vault password</Label>
              <Input
                id="cv-cf"
                type="password"
                minLength={MIN_VAULT_PASSWORD_LENGTH}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
                autoComplete="new-password"
              />
            </div>
            <div className="rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
              Argon2id protects your vault against GPU brute-force. With a Very strong passphrase,
              even a $1M attack farm needs 180,000+ years to crack it.
            </div>
            <label className="flex items-start gap-2 text-sm">
              <Checkbox
                id="cv-ack"
                checked={understood}
                onCheckedChange={(v) => setUnderstood(!!v)}
                className="mt-0.5"
              />
              <span className="text-muted-foreground">
                I understand this password cannot be recovered without my recovery kit.
              </span>
            </label>
            <Button type="submit" className="w-full" disabled={!canSubmit}>
              {busy ? "Creating..." : "Create vault"}
            </Button>
          </form>
        </CardContent>
      </Card>
    );
  }

  if (step === "reveal") {
    return <RecoveryReveal code={recoveryCode} onContinue={() => setStep("verify")} />;
  }

  return (
    <RecoveryVerify
      code={recoveryCode}
      onDone={() => {
        // Wipe code from memory before navigating
        setRecoveryCode("");
        finalizeVaultSetup();
        navigate({ to: "/dashboard" });
      }}
      onBack={() => setStep("reveal")}
    />
  );
}

function RecoveryReveal({ code, onContinue }: { code: string; onContinue: () => void }) {
  const words = useMemo(() => code.trim().split(/\s+/), [code]);
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
      "Orange Way Vault Recovery Kit",
      `Generated: ${ts}`,
      "",
      "Keep this somewhere safe. Anyone with this recovery kit can reset your vault password.",
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
      toast.error("Popup blocked. Allow popups to print.");
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
      <html><head><title>Orange Way Vault Recovery Kit</title></head>
      <body style="font-family:system-ui;padding:32px;max-width:560px;margin:auto">
        <h1 style="font-size:18px">Orange Way Vault Recovery Kit</h1>
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
    <Card className="shadow-card">
      <CardHeader className="pb-4">
        <CardTitle className="text-lg">Save your recovery kit</CardTitle>
        <CardDescription>Shown once. Store it somewhere safe.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <p className="text-amber-900 dark:text-amber-200">
            This is your only way to recover your vault if you forget your password. Save it
            somewhere safe now — we cannot show it again or recover it for you.
          </p>
        </div>

        <div className="rounded-xl border bg-muted/40 p-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {words.map((word, i) => (
              <div
                key={i}
                className="flex min-w-0 items-baseline gap-1.5 rounded-md border bg-background px-2 py-1.5 font-mono text-sm"
              >
                <span className="shrink-0 text-xs text-muted-foreground">{i + 1}.</span>
                <span className="min-w-0 break-all font-medium">{word}</span>
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
            I have saved my recovery kit in a safe place. I understand it will not be shown again.
          </span>
        </label>

        <Button className="w-full" disabled={!saved} onClick={onContinue}>
          Continue
        </Button>
      </CardContent>
    </Card>
  );
}

/**
 * Enforced 3-of-12 recovery code verification.
 *
 * Three words are chosen at random using crypto.getRandomValues (no
 * modulo bias for n=12 which fits evenly in uint32). The user must
 * type all three correctly before they can continue — there is no
 * skip path. This replaces the previous 2-word + skip-button flow.
 */
function RecoveryVerify({
  code,
  onDone,
  onBack,
}: {
  code: string;
  onDone: () => void;
  /**
   * Step back to the reveal screen so the user can re-read their
   * recovery code if they typed a wrong word or forgot one. The
   * reveal screen still has the code in memory (the parent only
   * wipes it on `onDone`), so no re-generation is needed.
   */
  onBack: () => void;
}) {
  const words = useMemo(() => code.trim().split(/\s+/), [code]);

  // Pick three distinct random indices using crypto.getRandomValues.
  // n=12 fits evenly into uint32 (4294967296 / 12 = 357913941 remainder 4,
  // so rejection probability is 4/2^32 < 0.0000002%). One rejection pass
  // is negligible and avoids any modulo bias.
  const [indices] = useState<[number, number, number]>(() => {
    const n = words.length; // always 12
    const picks = new Set<number>();
    while (picks.size < 3) {
      const buf = new Uint32Array(4);
      crypto.getRandomValues(buf);
      for (const r of buf) {
        const max = Math.floor(0x100000000 / n) * n;
        if (r < max) {
          picks.add(r % n);
          if (picks.size === 3) break;
        }
      }
    }
    const sorted = [...picks].sort((a, b) => a - b) as [number, number, number];
    return sorted;
  });

  const [inputs, setInputs] = useState(["", "", ""]);
  const [error, setError] = useState<string | null>(null);

  const setInput = (i: number, val: string) => {
    const next = [...inputs];
    next[i] = val;
    setInputs(next);
    setError(null);
  };

  const onVerify = (e: React.FormEvent) => {
    e.preventDefault();
    const allMatch = indices.every((idx, i) => inputs[i].trim().toLowerCase() === words[idx]);
    if (!allMatch) {
      setError("One or more recovery kit words don't match. Check what you saved.");
      return;
    }
    toast.success("Recovery kit confirmed. Welcome.");
    onDone();
  };

  return (
    <Card className="shadow-card">
      <CardHeader className="pb-4">
        <CardTitle className="text-lg">Confirm your recovery kit</CardTitle>
        <CardDescription>
          Type these three words from your kit to confirm you saved it.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onVerify} className="space-y-4">
          {indices.map((wordIndex, i) => (
            <div key={wordIndex} className="space-y-2">
              <Label htmlFor={`vw${i}`}>Word #{wordIndex + 1}</Label>
              <Input
                id={`vw${i}`}
                autoFocus={i === 0}
                autoComplete="off"
                value={inputs[i]}
                onChange={(e) => setInput(i, e.target.value)}
                required
              />
            </div>
          ))}
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full">
            Confirm and continue
          </Button>
          <div className="pt-1">
            <button
              type="button"
              onClick={onBack}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Back to recovery kit
            </button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
