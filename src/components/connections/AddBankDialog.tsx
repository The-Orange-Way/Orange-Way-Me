/**
 * AddBankDialog — orchestrates the Quiltt bank-link flow end to end.
 *
 * State machine:
 *
 *   idle  →  connecting (quick-connect API + popup open)
 *         →  awaiting-link (popup is up, waiting for OR_QUILTT_LINK_COMPLETE)
 *         →  discovering (calling owm-or-discover-quiltt with retry backoff)
 *         →  review (user names accounts + sets opening balances)
 *         →  saving (one connection_account_map insert per account)
 *         →  done (close dialog, refresh ConnectionsPage)
 *
 *   any step →  error (toast + back to idle)
 *
 * ZKA boundary:
 *   - cred_key + txn_key are derived from the unlocked vault MEK and
 *     piped to OR in the popup URL fragment ONLY.
 *   - The vault password never leaves the browser.
 *   - Account metadata returned by discovery (name, mask, institution,
 *     currency, kind) is plaintext-OK — same fields visible in the bank
 *     UI. Server-side ZKA columns (enc_name, enc_institution, etc.) get
 *     encrypted client-side at save time before INSERT.
 *
 * Per-user privacy: no household_id is set on the rows we create here.
 * Account-sharing into the household scope is an explicit later step
 * via household-osk wrapping (existing infra).
 */

import { useState, useCallback } from "react";
import { useVault } from "@/context/VaultContext";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  quickConnect,
  buildBankPopupUrl,
  openBankPopup,
  discoverQuilttAccounts,
  type QuilttDiscoveredAccount,
} from "@/lib/or/bank-connect";
import { Building2, Loader2, AlertCircle, Check, Lock, EyeOff, Zap } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { humanizeError } from "@/lib/friendly-error";

/** Compact icon-led trust point for the connect intro. */
function TrustPoint({
  icon: Icon,
  title,
  children,
}: {
  icon: LucideIcon;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted">
        <Icon className="h-4 w-4 text-foreground" />
      </div>
      <div className="space-y-0.5">
        <p className="text-sm font-medium leading-tight">{title}</p>
        <p className="text-xs text-muted-foreground">{children}</p>
      </div>
    </div>
  );
}

/** Map a Quiltt account kind to an Orange Way account type. Falls back to
 *  "checking" — a sane default for an unrecognized bank account. */
function quilttKindToAccountType(kind: string | null): string {
  switch ((kind ?? "").toUpperCase()) {
    case "CHECKING":
      return "checking";
    case "SAVINGS":
      return "savings";
    case "CREDIT_CARD":
    case "CREDIT":
      return "credit";
    case "BROKERAGE":
    case "INVESTMENT":
    case "IRA":
    case "401K":
      return "investment";
    case "LOAN":
    case "MORTGAGE":
    case "STUDENT_LOAN":
      return "loan";
    default:
      return "checking";
  }
}

type Step =
  | "idle"
  // "preparing": after Continue is clicked, while we mint the Quiltt session
  // and OR connection (1-3s). Dialog stays visible with a spinner so the
  // user never stares at a blank screen.
  | "preparing"
  | "connecting"
  | "discovering"
  | "review"
  | "saving"
  | "done";

interface PendingAccount {
  source: QuilttDiscoveredAccount;
  displayName: string;
  openingBalance: string;
  saved: boolean;
}

export interface AddBankDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after accounts are saved. Receives the OR connection id so the
   *  caller can kick off the first OPK sync for it. */
  onConnected: (orConnectionId: string | null) => void;
}

export function AddBankDialog({ open, onOpenChange, onConnected }: AddBankDialogProps) {
  const { exportOrCredsKey, exportOrTxnsKey, encryptText, isUnlocked } = useVault();
  const [step, setStep] = useState<Step>("idle");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingAccount[]>([]);
  const [linkCtx, setLinkCtx] = useState<{
    quilttConnectionId: string;
    orConnectionId?: string;
  } | null>(null);

  const reset = useCallback(() => {
    setStep("idle");
    setError(null);
    setPending([]);
    setLinkCtx(null);
  }, []);

  const handleStart = useCallback(async () => {
    setStep("preparing");
    setError(null);
    try {
      const credKeyB64 = await exportOrCredsKey();
      const txnKeyB64 = await exportOrTxnsKey();
      const qc = await quickConnect();
      const url = buildBankPopupUrl({ quickConnect: qc, credKeyB64, txnKeyB64 });
      // Now switch to "connecting" so our dialog hides while the popup
      // window is open (avoids the "popup inside popup" feel).
      setStep("connecting");
      const complete = await openBankPopup(url);

      setLinkCtx({
        quilttConnectionId: complete.quilttConnectionId,
        orConnectionId: complete.orConnectionId,
      });
      setStep("discovering");

      const accounts = await discoverQuilttAccounts(complete.quilttConnectionId);
      if (accounts.length === 0) {
        throw new Error("Your bank connected, but no accounts came through. Try again.");
      }
      const today = new Date().toISOString().slice(0, 10);
      setPending(
        accounts.map((a) => ({
          source: a,
          displayName: a.mask ? `${a.name} ••${a.mask}` : a.name,
          // Pre-fill with Quiltt's current balance if the bank exposes it;
          // user can still edit. Falls back to empty string (= "0" when saved).
          openingBalance:
            typeof a.balance_current === "number" && Number.isFinite(a.balance_current)
              ? String(a.balance_current)
              : "",
          saved: false,
        })),
      );
      void today;
      setStep("review");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg === "User cancelled" || msg === "Popup closed before completion") {
        // User backed out. Quiet close — no error toast.
        reset();
        onOpenChange(false);
        return;
      }
      console.error("[AddBankDialog] start failed", err);
      setError(humanizeError(err));
      setStep("idle");
    }
  }, [exportOrCredsKey, exportOrTxnsKey, reset, onOpenChange]);

  const handleSave = useCallback(async () => {
    if (!linkCtx || !isUnlocked) {
      setError("Vault not unlocked");
      return;
    }
    setStep("saving");
    setError(null);

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in");

      // One accounts row + one connection_account_map row per Quiltt account.
      // We do these in series for tighter error reporting; the count is
      // small (typical bank link yields 1-5 accounts).
      const updated = [...pending];
      for (let i = 0; i < updated.length; i++) {
        if (updated[i].saved) continue;
        const p = updated[i];
        const src = p.source;

        // 1. Create the accounts row with all enc_* columns AES-GCM
        //    under the user MEK.
        const enc_name = await encryptText(p.displayName);
        const enc_type = await encryptText(quilttKindToAccountType(src.kind));
        const enc_currency = await encryptText(src.currency ?? "USD");
        const enc_institution = src.institution_name
          ? await encryptText(src.institution_name)
          : null;
        const enc_balance = await encryptText(p.openingBalance || "0");
        const enc_metadata = await encryptText(
          JSON.stringify({
            quiltt_account_id: src.id,
            mask: src.mask,
            kind: src.kind,
            state: src.state,
          }),
        );

        // Bank accounts import historical transactions, so default the
        // opening date to 2 years back. Otherwise the opened_at invariant
        // (transactions can't predate the account's open date) rejects
        // every historical bank transaction. The user can refine this date
        // later from account settings.
        const openedAt = new Date();
        openedAt.setFullYear(openedAt.getFullYear() - 2);

        const { data: account, error: acctErr } = await supabase
          .from("accounts")
          .insert({
            user_id: user.id,
            connector_type: "orange_rails",
            provider_slug: "quiltt",
            opened_at: openedAt.toISOString(),
            enc_name,
            enc_type,
            enc_currency,
            enc_institution,
            enc_balance,
            enc_metadata,
          })
          .select("id")
          .single();

        if (acctErr || !account) {
          throw new Error(acctErr?.message ?? "We couldn't save that account. Please try again.");
        }

        // 2. Insert connection_account_map row binding (OR connection, OR
        //    external wallet) → MEK-encrypted accounts.id. The Orange Way
        //    client is the only thing that can decrypt encrypted_account_id
        //    at sync time and route transactions correctly.
        const encryptedAccountId = await encryptText(account.id);
        const orConnectionId = linkCtx.orConnectionId ?? linkCtx.quilttConnectionId;
        const { error: mapErr } = await supabase.from("connection_account_map").insert({
          user_id: user.id,
          or_connection_id: orConnectionId,
          or_external_wallet_id: src.id,
          encrypted_account_id: encryptedAccountId,
        });

        if (mapErr) {
          throw new Error(mapErr.message);
        }

        updated[i] = { ...p, saved: true };
        setPending([...updated]);
      }

      setStep("done");
      toast.success(`Connected ${updated.length} ${updated.length === 1 ? "account" : "accounts"}`);
      const orConnId = linkCtx.orConnectionId ?? linkCtx.quilttConnectionId;
      // Cache the institution name (e.g. "Mercury") locally keyed by OR
      // connection id so the Connections card can show the real bank name
      // Bank name (e.g. "Mercury", "TD") is shown on the Connections card.
      // We previously cached this in localStorage cleartext, which leaks
      // exactly the identifier connections.encrypted_label is supposed to
      // protect to anyone with read access to the browser profile (stolen
      // laptop, hostile extension). Drop the cache; the Connections page
      // derives the institution from connection_account_map → accounts on
      // every mount, which works for every connection that has wallets
      // discovered (i.e. all of them after a successful Save).
      void orConnId;
      // Brief pause so the user sees the success state, then close.
      setTimeout(() => {
        onConnected(orConnId);
        reset();
        onOpenChange(false);
      }, 1200);
    } catch (err) {
      console.error("[AddBankDialog] save failed", err);
      setError(humanizeError(err));
      setStep("review");
    }
  }, [linkCtx, isUnlocked, encryptText, pending, onConnected, reset, onOpenChange]);

  // ── Render ──────────────────────────────────────────────────────────

  const isBusy = step === "connecting" || step === "discovering" || step === "saving";
  // Steps where a stray outside-click would lose user state mid-flow. The
  // bank connection has ALREADY been created on OR by the time we reach
  // discovering / review — closing here leaves a "No wallets configured"
  // orphan card the user has to fix later. Block dismissal entirely.
  const blockDismiss =
    step === "preparing" ||
    step === "connecting" ||
    step === "discovering" ||
    step === "review" ||
    step === "saving";

  return (
    <Dialog
      // Hide Orange Way's dialog entirely while the bank-connect popup is
      // open (step === "connecting"). The "preparing" step KEEPS the dialog
      // open with a spinner so the user never stares at a blank screen
      // during the 1-3 second pre-popup setup. Reappears for review.
      open={open && step !== "connecting"}
      onOpenChange={(o) => {
        // Treat outside-click / Esc as a no-op during any data-bearing step
        // so a stray click can't lose a freshly created bank connection.
        if (!o && !blockDismiss) {
          reset();
          onOpenChange(false);
        }
      }}
    >
      <DialogContent className="max-w-md">
        {/* Visually-hidden title/description keep the dialog accessible while
            the idle screen below carries the real, simpler layout. */}
        <DialogHeader className="sr-only">
          <DialogTitle>Connect a bank</DialogTitle>
          <DialogDescription>
            Securely import your bank transactions. Your password stays with your bank.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            <p className="text-destructive">{error}</p>
          </div>
        )}

        {step === "idle" && (
          <div className="space-y-6 py-2 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-orange-50">
              <Building2 className="h-7 w-7 text-orange-500" />
            </div>
            <div className="space-y-1">
              <h2 className="text-lg font-semibold">Connect a bank</h2>
              <p className="text-sm text-muted-foreground">
                Import your transactions automatically.
              </p>
            </div>

            <div className="space-y-3 text-left">
              <TrustPoint icon={Lock} title="Your password stays with your bank">
                You sign in on your bank's own secure page. We never see it.
              </TrustPoint>
              <TrustPoint icon={EyeOff} title="Only you can read your data">
                Encrypted with your vault key. No one else can see your transactions.
              </TrustPoint>
              <TrustPoint icon={Zap} title="Stays up to date">
                New transactions flow in automatically.
              </TrustPoint>
            </div>

            <Button className="w-full" size="lg" onClick={handleStart}>
              Continue
            </Button>
          </div>
        )}

        {/* "Preparing" — dialog stays visible with a spinner during the
            1-3 second pre-popup setup so the user isn't staring at a blank
            screen wondering if their click registered. */}
        {step === "preparing" && (
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <Loader2 className="h-8 w-8 animate-spin text-orange-500" />
            <p className="text-sm font-medium">Preparing your secure connection…</p>
            <p className="max-w-xs text-xs text-muted-foreground">
              We'll open your bank's sign-in window in a moment.
            </p>
          </div>
        )}

        {/* While the popup is open we go quiet — no competing spinner. The
            user's attention is on the popup window; this dialog just waits. */}
        {step === "connecting" && (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <Building2 className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm font-medium">Continue in the pop-up window</p>
            <p className="max-w-xs text-xs text-muted-foreground">
              Finish connecting your bank in the window that just opened. We'll pick up
              automatically here when you're done.
            </p>
          </div>
        )}

        {/* The popup has closed by now; this spinner doesn't compete with it. */}
        {step === "discovering" && (
          <div className="flex flex-col items-center gap-3 py-8">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Reading your accounts…</p>
          </div>
        )}

        {step === "review" && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Name each account as you'd like to see it in Orange Way. Opening balance is optional —
              we'll fill it in from your bank automatically if left blank.
            </p>
            <div className="space-y-3 max-h-[40vh] overflow-auto pr-2">
              {pending.map((p, i) => (
                <div key={p.source.id} className="space-y-2 rounded-lg border bg-muted/30 p-3">
                  <div className="text-xs text-muted-foreground">
                    {p.source.institution_name ?? "Bank"}
                    {p.source.mask ? ` · ••${p.source.mask}` : ""}
                    {p.source.kind ? ` · ${p.source.kind}` : ""}
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={`acct-name-${i}`} className="text-xs">
                      Display name
                    </Label>
                    <Input
                      id={`acct-name-${i}`}
                      value={p.displayName}
                      onChange={(e) => {
                        const next = [...pending];
                        next[i] = { ...p, displayName: e.target.value };
                        setPending(next);
                      }}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={`acct-bal-${i}`} className="text-xs">
                      Opening balance ({p.source.currency ?? "USD"})
                    </Label>
                    <Input
                      id={`acct-bal-${i}`}
                      placeholder="Optional"
                      value={p.openingBalance}
                      onChange={(e) => {
                        const next = [...pending];
                        next[i] = { ...p, openingBalance: e.target.value };
                        setPending(next);
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
            <Button
              className="w-full"
              onClick={handleSave}
              disabled={pending.some((p) => !p.displayName.trim())}
            >
              Save {pending.length} {pending.length === 1 ? "account" : "accounts"}
            </Button>
          </div>
        )}

        {step === "saving" && (
          <div className="flex flex-col items-center gap-3 py-8">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">
              Saved {pending.filter((p) => p.saved).length} of {pending.length} wallets…
            </p>
          </div>
        )}

        {step === "done" && (
          <div className="flex flex-col items-center gap-3 py-8">
            <Check className="h-8 w-8 text-green-600 dark:text-green-400" />
            <p className="text-sm">Connected!</p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
