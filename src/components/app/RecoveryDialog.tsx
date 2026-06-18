import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useVault } from "@/context/VaultContext";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Eye, EyeOff, ShieldCheck } from "lucide-react";

const MIN_PW = 12;

type Step = "code" | "password" | "success";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function RecoveryDialog({ open, onOpenChange }: Props) {
  const { recoverWithCode } = useVault();
  const navigate = useNavigate();

  const [step, setStep] = useState<Step>("code");
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState<string | null>(null);
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pwError, setPwError] = useState<string | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);

  // Reset on close
  useEffect(() => {
    if (!open) {
      // Delay so the closing animation doesn't flash a step change
      const t = setTimeout(() => {
        setStep("code");
        setCode("");
        setCodeError(null);
        setPw("");
        setConfirm("");
        setPwError(null);
        setConfirmError(null);
        setShowPw(false);
        setBusy(false);
      }, 200);
      return () => clearTimeout(t);
    }
  }, [open]);

  // Auto-advance from success
  useEffect(() => {
    if (step !== "success") return;
    const t = setTimeout(() => {
      onOpenChange(false);
      navigate({ to: "/dashboard" });
    }, 1500);
    return () => clearTimeout(t);
  }, [step, navigate, onOpenChange]);

  const normalizedWords = code.trim().toLowerCase().split(/\s+/).filter(Boolean);

  const onContinueCode = (e: React.FormEvent) => {
    e.preventDefault();
    if (normalizedWords.length !== 12) {
      setCodeError(`Recovery code must be exactly 12 words (got ${normalizedWords.length}).`);
      return;
    }
    setCodeError(null);
    setStep("password");
  };

  const onResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    let bad = false;
    if (pw.length < MIN_PW) {
      setPwError(`Vault password must be at least ${MIN_PW} characters.`);
      bad = true;
    } else {
      setPwError(null);
    }
    if (pw !== confirm) {
      setConfirmError("Passwords don't match.");
      bad = true;
    } else {
      setConfirmError(null);
    }
    if (bad) return;

    setBusy(true);
    try {
      await recoverWithCode(normalizedWords.join(" "), pw);
      setStep("success");
    } catch (err) {
      const msg = (err as Error).message ?? "";
      if (/recovery|invalid|unwrap|decrypt/i.test(msg)) {
        // Send the user back to step 1 with a friendly inline error
        setStep("code");
        setCodeError(
          "That recovery code did not unlock your vault. Check for typos and try again.",
        );
      } else {
        setPwError(msg || "Could not reset vault password.");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" aria-describedby={undefined}>
        {step === "code" && (
          <form onSubmit={onContinueCode}>
            <DialogHeader>
              <DialogTitle>Enter your recovery code</DialogTitle>
              <DialogDescription>
                Paste the 12-word recovery code you saved when creating your vault.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2 py-4">
              <Label htmlFor="rc-code" className="sr-only">
                Recovery code
              </Label>
              <Textarea
                id="rc-code"
                value={code}
                onChange={(e) => {
                  setCode(e.target.value);
                  if (codeError) setCodeError(null);
                }}
                placeholder="word1 word2 word3 …"
                rows={3}
                autoFocus
                className="font-mono text-sm"
                aria-invalid={!!codeError}
              />
              {codeError ? (
                <p className="text-sm text-destructive">{codeError}</p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Case doesn't matter. Words separated by spaces or line breaks.
                </p>
              )}
            </div>
            <DialogFooter className="gap-2 sm:gap-2">
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit">Continue</Button>
            </DialogFooter>
          </form>
        )}

        {step === "password" && (
          <form onSubmit={onResetPassword}>
            <DialogHeader>
              <DialogTitle>Set a new vault password</DialogTitle>
              <DialogDescription>
                This replaces your old vault password. Your data is preserved.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="rc-pw">New vault password</Label>
                <div className="relative">
                  <Input
                    id="rc-pw"
                    type={showPw ? "text" : "password"}
                    value={pw}
                    onChange={(e) => {
                      setPw(e.target.value);
                      if (pwError) setPwError(null);
                    }}
                    minLength={MIN_PW}
                    autoFocus
                    aria-invalid={!!pwError}
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw((v) => !v)}
                    className="absolute inset-y-0 right-0 flex items-center px-3 text-muted-foreground hover:text-foreground"
                    aria-label={showPw ? "Hide password" : "Show password"}
                    tabIndex={-1}
                  >
                    {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                {pwError ? (
                  <p className="text-sm text-destructive">{pwError}</p>
                ) : (
                  <p className="text-xs text-muted-foreground">At least {MIN_PW} characters.</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="rc-confirm">Confirm new password</Label>
                <Input
                  id="rc-confirm"
                  type={showPw ? "text" : "password"}
                  value={confirm}
                  onChange={(e) => {
                    setConfirm(e.target.value);
                    if (confirmError) setConfirmError(null);
                  }}
                  minLength={MIN_PW}
                  aria-invalid={!!confirmError}
                />
                {confirmError && <p className="text-sm text-destructive">{confirmError}</p>}
              </div>
            </div>
            <DialogFooter className="gap-2 sm:gap-2">
              <Button type="button" variant="ghost" onClick={() => setStep("code")} disabled={busy}>
                Back
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? "Resetting…" : "Reset vault password"}
              </Button>
            </DialogFooter>
          </form>
        )}

        {step === "success" && (
          <div>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-primary" />
                Vault unlocked
              </DialogTitle>
              <DialogDescription>
                Your vault is open and your password has been reset.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="pt-4">
              <Button
                onClick={() => {
                  onOpenChange(false);
                  navigate({ to: "/dashboard" });
                }}
              >
                Continue
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
