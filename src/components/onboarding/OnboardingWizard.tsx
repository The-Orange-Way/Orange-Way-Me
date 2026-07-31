/**
 * OnboardingWizard - DL-0414 PR1: the 7-step onboarding shell.
 *
 * This is the navigation spine only. It is a pure state machine plus
 * step routing with ZERO cryptography: no email OTP, no vault password
 * derivation, no recovery code generation, no passkey enrollment. Each
 * of those lands in its own follow-up PR (with an Auditor pass on the
 * crypto-bearing steps) and slots into the step body below.
 *
 * Steps (locked product spec, TypeForm single-idea-per-screen pace):
 *   1. Name (optional)
 *   2. Email
 *   3. What zero-knowledge means (plain-language education)
 *   4. Create vault password        (placeholder in this PR)
 *   5. Save your recovery code       (placeholder in this PR)
 *   6. Turn on quick unlock          (placeholder in this PR)
 *   7. You are all set (success)
 *
 * Copy rule mirrors the rest of the app: plain English, no technical
 * terms leak to the UI.
 */
import { useState, type ComponentType } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Sparkles,
  Mail,
  ShieldCheck,
  KeyRound,
  LifeBuoy,
  Fingerprint,
  PartyPopper,
} from "lucide-react";

const STEPS = [1, 2, 3, 4, 5, 6, 7] as const;
export type OnboardingStep = (typeof STEPS)[number];
const LAST_STEP: OnboardingStep = 7;

const stepIcon: Record<OnboardingStep, ComponentType<{ className?: string }>> = {
  1: Sparkles,
  2: Mail,
  3: ShieldCheck,
  4: KeyRound,
  5: LifeBuoy,
  6: Fingerprint,
  7: PartyPopper,
};

const stepTitle: Record<OnboardingStep, string> = {
  1: "What should we call you?",
  2: "What is your email?",
  3: "Only you can read your data",
  4: "Create your vault password",
  5: "Save your recovery code",
  6: "Enable Face ID or fingerprint on this device",
  7: "You're all set",
};

const stepDescription: Record<OnboardingStep, string> = {
  1: "This is optional. It just helps us greet you.",
  2: "We send a one-time link here so there is no password to forget.",
  3: "Here is the promise behind Orange Way, in plain words.",
  4: "One password protects everything. We never see it.",
  5: "Write this somewhere safe, away from this device.",
  6: "This replaces your vault password for everyday unlocking, faster and just as secure.",
  7: "Your wallet is protected and ready.",
};

/**
 * Draft state carried across steps. Only the non-sensitive fields live
 * here in PR1 (name, email). Password, recovery code, and passkey state
 * are intentionally absent until their steps are implemented.
 */
interface OnboardingDraft {
  name: string;
  email: string;
}

export function OnboardingWizard() {
  const navigate = useNavigate();
  const [step, setStep] = useState<OnboardingStep>(1);
  const [draft, setDraft] = useState<OnboardingDraft>({ name: "", email: "" });
  // Step 5 is non-skippable: the parent confirms they wrote the recovery code
  // down before Continue activates. Pure UI gate, no cryptography here.
  const [recoveryConfirmed, setRecoveryConfirmed] = useState(false);

  const percent = Math.round((step / LAST_STEP) * 100);
  const Icon = stepIcon[step];

  const goNext = () => setStep((s) => (s < LAST_STEP ? ((s + 1) as OnboardingStep) : s));
  const goBack = () => setStep((s) => (s > 1 ? ((s - 1) as OnboardingStep) : s));

  // Steps that gate advancing: step 2 needs an email, step 5 needs the
  // written-it-down confirm. Every other step advances freely.
  let canAdvance = true;
  if (step === 2) canAdvance = draft.email.trim().length > 0;
  else if (step === 5) canAdvance = recoveryConfirmed;

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <Card className="w-full max-w-md shadow-card">
        <CardHeader className="pb-4">
          <div className="mb-3 space-y-2">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Step {step} of {LAST_STEP}
            </p>
            <Progress value={percent} className="h-1.5" />
          </div>
          <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <Icon className="h-5 w-5" />
          </div>
          <CardTitle className="text-lg">{stepTitle[step]}</CardTitle>
          <CardDescription>{stepDescription[step]}</CardDescription>
        </CardHeader>

        <CardContent className="space-y-6">
          <div className="min-h-[7rem] text-sm">
            {step === 1 && (
              <div className="space-y-2">
                <Label htmlFor="ob-name">Your name</Label>
                <Input
                  id="ob-name"
                  autoComplete="given-name"
                  placeholder="Optional"
                  value={draft.name}
                  onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                />
              </div>
            )}

            {step === 2 && (
              <div className="space-y-2">
                <Label htmlFor="ob-email">Email</Label>
                <Input
                  id="ob-email"
                  type="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  value={draft.email}
                  onChange={(e) => setDraft((d) => ({ ...d, email: e.target.value }))}
                />
              </div>
            )}

            {step === 3 && (
              <div className="space-y-3 text-muted-foreground">
                <p>
                  Orange Way locks your family money data with a key only you hold. Your information
                  is scrambled on your device before it ever leaves it.
                </p>
                <p>
                  That means we cannot read it, and no one else can either. The next few steps set
                  up that lock.
                </p>
              </div>
            )}

            {step === 4 && (
              <PlaceholderBody label="Vault password setup arrives in the next PR. This shell reserves its place in the flow." />
            )}

            {step === 5 && (
              <div className="space-y-4 text-muted-foreground">
                <p>This is the only way to add another phone or tablet. We do not store a copy.</p>
                <label className="flex items-start gap-2 text-foreground">
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4"
                    checked={recoveryConfirmed}
                    onChange={(e) => setRecoveryConfirmed(e.target.checked)}
                  />
                  <span>I have written it down somewhere safe.</span>
                </label>
              </div>
            )}

            {step === 6 && (
              <PlaceholderBody label="Quick unlock (Face ID or fingerprint) arrives in a later PR, with a graceful fallback to your vault password." />
            )}

            {step === 7 && (
              <div className="space-y-3 text-muted-foreground">
                <p>Your vault is ready. From here you can connect a wallet and start budgeting.</p>
              </div>
            )}
          </div>

          <div className="flex items-center justify-between gap-3">
            {step > 1 ? (
              <Button variant="outline" onClick={goBack}>
                Back
              </Button>
            ) : (
              <span />
            )}

            {step < LAST_STEP ? (
              <Button onClick={goNext} disabled={!canAdvance}>
                {step === 1 && draft.name.trim().length === 0 ? "Skip" : "Continue"}
              </Button>
            ) : (
              <Button onClick={() => navigate({ to: "/dashboard" })}>Go to dashboard</Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function PlaceholderBody({ label }: { label: string }) {
  return (
    <div className="rounded-md border border-dashed border-border bg-muted/30 p-3 text-muted-foreground">
      {label}
    </div>
  );
}

export default OnboardingWizard;
