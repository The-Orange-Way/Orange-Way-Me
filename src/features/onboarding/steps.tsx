import { useEffect, useState } from "react";
import { StepShell } from "./onboarding-flow";
import type { OnboardingStep, OnboardingStepProps } from "./onboarding-flow";

/**
 * Screen copy below is VERBATIM from the locked specification:
 *
 *   "7-step onboarding flow specification" (covers both apps, design twins)
 *   Copy locked 2026-07-30. Spec locked 2026-07-31.
 *   Wiki doc id 13aecb24-1275-4f87-a986-a3cd6b299bdb
 *
 * CX owns this text. Do not reword it here. If a string has to change, change
 * the wiki first and port it down, so the two apps stay design twins.
 *
 * Hoisted into one object on purpose: it can be diffed against the wiki in a
 * single block, and the sibling app imports the same shape rather than
 * retyping strings.
 *
 * This file is presentation only. Argon2id derivation, BIP-39 generation and
 * WebAuthn PRF wrapping are DL-0414's lane and land behind these screens
 * without changing the step contract. Every seam is marked TODO(DL-0414).
 */
export const ONBOARDING_COPY = {
  name: {
    headline: "What should we call you?",
    body: "Optional. Skip it if you like, just a friendly touch.",
    cta: "Continue",
    secondary: "Skip",
  },
  email: {
    headline: "What's your email address?",
    body: "We'll send a one-time link to confirm it's you. No password yet.",
    cta: "Send my link",
  },
  education: {
    headline: "Your money stays yours.",
    body: "Orange Way is built so we can never see your balance, your keys, or your transactions. Not us. Not anyone. It lives on your device.",
    cta: "Got it",
  },
  vaultPassword: {
    headline: "Create your vault password.",
    body: "This unlocks everything in Orange Way. We can never reset it for you. That is what the next step is for.",
    cta: "Set my password",
  },
  recovery: {
    headline: "Save your recovery code.",
    body: "Write this somewhere safe, away from this device.",
    instruction: "This is the only way to add another phone or tablet. We do not store a copy.",
    cta: "I've written it down",
  },
  biometric: {
    headline: "Enable Face ID / fingerprint on this device.",
    body: "This replaces your vault password for everyday unlocking, faster and just as secure.",
    cta: "Enable",
    secondary: "I'll do this later",
  },
  biometricFallback: {
    headline: "Your device doesn't support this yet.",
    body: "You can still use your vault password to open Orange Way.",
    cta: "Continue",
  },
  success: {
    headline: "You're all set.",
    body: "Your wallet is protected and ready. Connect your Bitcoin wallet to see your balance.",
    cta: "Connect my wallet",
    secondary: "I'll do this later",
  },
} as const;

/**
 * COPY NOT LOCKED. The standalone verification screen exists only in the
 * 8-step reading of the spec (DL-0414) and CX has never written copy for it.
 * The wording below is a placeholder and needs CX sign-off before this mode
 * can ship to anyone.
 */
const VERIFY_COPY = {
  headline: "Confirm your recovery code.",
  body: "Type the three words we ask for, so we know the code is safely written down.",
  cta: "Confirm",
};

/**
 * 7 steps or 8 has been treated as a blocker for every screen numbered 5 and
 * above. It does not have to be one.
 *
 * The locked spec asks only this of Step 5: "Verification requires
 * confirmation via checkbox or re-entry pattern before CTA activates. No
 * bypass path." Both live readings satisfy that lock:
 *
 *   checkbox  The CX 7-step spec. "I've written it down" gates on a checkbox.
 *             Chosen to hold down dropout at the recovery-code screen.
 *   reentry   DL-0414. The parent types back 3 highlighted words on a screen
 *             of its own, which makes the flow 8 steps.
 *
 * So verification is a mode, not a step count. Flipping this constant inserts
 * or removes StepVerify and nothing else moves: no id changes, no copy
 * rewrites, no renumbering above step 4. Whichever way the call lands, it
 * costs one line, and the sibling app can start its twin now, not later.
 *
 * Default is "checkbox": it is the reading with locked copy behind it.
 */
export type RecoveryVerifyMode = "checkbox" | "reentry";

export const RECOVERY_VERIFY_MODE: RecoveryVerifyMode = "checkbox";

const FIELD_CLASS =
  "mt-6 w-full rounded-md border border-input bg-background px-4 py-3 text-lg text-foreground";

const RECOVERY_GRID_CLASS =
  "mt-6 grid grid-cols-3 gap-x-4 gap-y-2 rounded-md border border-dashed border-input p-4 font-mono text-sm";

const PASSWORD_MIN_LENGTH = 12;

const RECOVERY_WORD_COUNT = 12;

const VERIFY_WORD_POSITIONS = [3, 7, 11] as const;

const STRENGTH_LABELS = ["Too short", "Weak", "Fair", "Good", "Strong", "Strong"] as const;

function passwordScore(value: string) {
  let score = 0;
  if (value.length >= PASSWORD_MIN_LENGTH) score += 1;
  if (value.length >= 16) score += 1;
  if (/[a-z]/.test(value) && /[A-Z]/.test(value)) score += 1;
  if (/\d/.test(value)) score += 1;
  if (/[^\w\s]/.test(value)) score += 1;
  return score;
}

/**
 * Capability probe for Step 6. The parent never chooses between biometric and
 * password mode; the device decides which screen renders.
 *
 * TODO(DL-0414): a platform authenticator is necessary but not sufficient for
 * PRF. The real probe creates a credential and reads the prf extension
 * result. Until that exists this is the documented proxy, and it can only
 * over-offer, never dead-end, because the fallback stays reachable.
 */
function useHasPlatformAuthenticator() {
  const [available, setAvailable] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;

    if (typeof window === "undefined" || !window.PublicKeyCredential) {
      setAvailable(false);
      return;
    }

    window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()
      .then((result) => {
        if (!cancelled) setAvailable(result);
      })
      .catch(() => {
        if (!cancelled) setAvailable(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return available;
}

function StepName(props: OnboardingStepProps) {
  // TODO(DL-0414): lift to flow state. The name is written to the profile row
  // after the OTP round trip, not from here.
  const [name, setName] = useState("");
  const copy = ONBOARDING_COPY.name;

  return (
    <StepShell
      {...props}
      title={copy.headline}
      nextLabel={copy.cta}
      secondaryLabel={copy.secondary}
    >
      <p>{copy.body}</p>
      <input
        type="text"
        value={name}
        onChange={(event) => setName(event.target.value)}
        autoComplete="given-name"
        placeholder="First name"
        aria-label="First name"
        className={FIELD_CLASS}
      />
    </StepShell>
  );
}

function StepEmail(props: OnboardingStepProps) {
  // TODO(DL-0414): the CTA sends the one-time link. Advancing is gated on that
  // round trip, not on the field merely looking well formed.
  const [email, setEmail] = useState("");
  const copy = ONBOARDING_COPY.email;
  const looksLikeEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  return (
    <StepShell {...props} title={copy.headline} nextLabel={copy.cta} nextDisabled={!looksLikeEmail}>
      <p>{copy.body}</p>
      <input
        type="email"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        autoComplete="email"
        placeholder="you@example.com"
        aria-label="Email address"
        className={FIELD_CLASS}
      />
    </StepShell>
  );
}

// Non-skippable by construction: one CTA, no secondary link, nothing to
// dismiss. This is the trust moment, so the parent has to read past it.
function StepEducation(props: OnboardingStepProps) {
  const copy = ONBOARDING_COPY.education;

  return (
    <StepShell {...props} title={copy.headline} nextLabel={copy.cta}>
      <p>{copy.body}</p>
    </StepShell>
  );
}

function StepVaultPassword(props: OnboardingStepProps) {
  // TODO(DL-0414): this password never leaves the device. It is the input to
  // Argon2id (>= 64 MiB, >= 3 iterations, client-generated CSPRNG salt) and
  // the derived KEK wraps the vault key. Nothing typed here is transmitted.
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const copy = ONBOARDING_COPY.vaultPassword;
  const score = passwordScore(password);
  const matches = password.length > 0 && password === confirm;
  const strongEnough = password.length >= PASSWORD_MIN_LENGTH && score >= 3;

  return (
    <StepShell
      {...props}
      title={copy.headline}
      nextLabel={copy.cta}
      nextDisabled={!strongEnough || !matches}
    >
      <p>{copy.body}</p>
      <input
        type="password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        autoComplete="new-password"
        placeholder="Vault password"
        aria-label="Vault password"
        className={FIELD_CLASS}
      />
      <input
        type="password"
        value={confirm}
        onChange={(event) => setConfirm(event.target.value)}
        autoComplete="new-password"
        placeholder="Confirm vault password"
        aria-label="Confirm vault password"
        className={FIELD_CLASS}
      />
      <p className="mt-3 text-sm" aria-live="polite">
        Strength: {STRENGTH_LABELS[score]}
        {password.length > 0 && !matches ? " (passwords do not match yet)" : ""}
      </p>
    </StepShell>
  );
}

function StepRecovery(props: OnboardingStepProps) {
  // TODO(DL-0414): the 12 words come from BIP-39 generation on this device.
  // Rendering blank slots is deliberate. Faking plausible words would ship a
  // wordlist and invite someone to treat a placeholder as a real code.
  //
  // hideBack because going back to the vault password step would re-derive
  // the key and invalidate the code the parent was just told to write down.
  // That is exactly the dead end CX called out.
  const [confirmed, setConfirmed] = useState(false);
  const copy = ONBOARDING_COPY.recovery;

  return (
    <StepShell
      {...props}
      title={copy.headline}
      nextLabel={copy.cta}
      nextDisabled={!confirmed}
      hideBack
    >
      <p>{copy.body}</p>
      <ol className={RECOVERY_GRID_CLASS}>
        {Array.from({ length: RECOVERY_WORD_COUNT }, (_, index) => (
          <li key={index} className="flex items-center gap-2">
            <span className="w-4 text-right text-muted-foreground">{index + 1}</span>
            <span className="h-4 flex-1 rounded bg-muted" />
          </li>
        ))}
      </ol>
      <p className="mt-4 text-sm">{copy.instruction}</p>
      <label className="mt-4 flex items-center gap-3 text-sm">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(event) => setConfirmed(event.target.checked)}
          className="h-4 w-4 rounded border-input"
        />
        I have written down all {RECOVERY_WORD_COUNT} words.
      </label>
    </StepShell>
  );
}

// Only mounted when RECOVERY_VERIFY_MODE is "reentry".
function StepVerify(props: OnboardingStepProps) {
  // TODO(DL-0414): compare against the mnemonic generated in StepRecovery.
  // Spec: a wrong answer loops back to the recovery screen with a regenerated
  // code, and 3 wrong answers add a 5 second cooldown. None of that can be
  // built before the generator exists, so this gates on non-empty input only.
  const [answers, setAnswers] = useState<string[]>(() => VERIFY_WORD_POSITIONS.map(() => ""));
  const allFilled = answers.every((answer) => answer.trim().length > 0);

  return (
    <StepShell
      {...props}
      title={VERIFY_COPY.headline}
      nextLabel={VERIFY_COPY.cta}
      nextDisabled={!allFilled}
      hideBack
    >
      <p>{VERIFY_COPY.body}</p>
      {VERIFY_WORD_POSITIONS.map((position, index) => (
        <input
          key={position}
          type="text"
          value={answers[index] ?? ""}
          onChange={(event) => {
            const value = event.target.value;
            setAnswers((current) => current.map((answer, i) => (i === index ? value : answer)));
          }}
          autoComplete="off"
          placeholder={"Word " + position}
          aria-label={"Word " + position}
          className={FIELD_CLASS}
        />
      ))}
    </StepShell>
  );
}

function StepBiometric(props: OnboardingStepProps) {
  const available = useHasPlatformAuthenticator();

  // Probe still running. Show the headline with the CTA held shut rather than
  // flashing the fallback copy at a device that does support this.
  if (available === null) {
    return <StepShell {...props} title={ONBOARDING_COPY.biometric.headline} nextDisabled />;
  }

  if (!available) {
    const fallback = ONBOARDING_COPY.biometricFallback;
    return (
      <StepShell {...props} title={fallback.headline} nextLabel={fallback.cta}>
        <p>{fallback.body}</p>
      </StepShell>
    );
  }

  const copy = ONBOARDING_COPY.biometric;
  return (
    <StepShell
      {...props}
      title={copy.headline}
      nextLabel={copy.cta}
      secondaryLabel={copy.secondary}
    >
      <p>{copy.body}</p>
    </StepShell>
  );
}

function StepSuccess(props: OnboardingStepProps) {
  // "I'll do this later" opens an empty dashboard. onSecondary defaults to
  // onNext, and this is the last step, so it completes the wizard either way.
  // Per spec: acceptable, the aha moment was offered. Do not block on it.
  const copy = ONBOARDING_COPY.success;

  return (
    <StepShell
      {...props}
      title={copy.headline}
      nextLabel={copy.cta}
      secondaryLabel={copy.secondary}
      hideBack
    >
      <p>{copy.body}</p>
    </StepShell>
  );
}

export function buildOnboardingSteps(mode: RecoveryVerifyMode): OnboardingStep[] {
  return [
    { id: "name", title: "Name", Component: StepName },
    { id: "email", title: "Email", Component: StepEmail },
    { id: "education", title: "How Orange Way works", Component: StepEducation },
    { id: "vault-password", title: "Vault password", Component: StepVaultPassword },
    { id: "recovery-code", title: "Recovery code", Component: StepRecovery },
    ...(mode === "reentry"
      ? [{ id: "verify-recovery-code", title: "Confirm recovery code", Component: StepVerify }]
      : []),
    { id: "biometric", title: "Biometric unlock", Component: StepBiometric },
    { id: "success", title: "You are all set", Component: StepSuccess },
  ];
}

export const ONBOARDING_STEPS: OnboardingStep[] = buildOnboardingSteps(RECOVERY_VERIFY_MODE);
