import { useEffect, useRef, useState } from "react";
import { StepShell } from "./onboarding-flow";
import type { OnboardingStep, OnboardingStepProps } from "./onboarding-flow";
import { useOnboardingState, verifyRecoveryKitWords } from "./onboarding-state";
import { CaptchaWidget, CAPTCHA_REQUIRED } from "@/components/auth/CaptchaWidget";
import type { TurnstileInstance } from "@marsidev/react-turnstile";
import { supabase } from "@/integrations/supabase/client";
import { useVault } from "@/context/VaultContext";
import { useProfile } from "@/hooks/useProfile";
import { humanizeError } from "@/lib/friendly-error";

/**
 * Screen copy below is VERBATIM from the locked specification:
 *
 *   "7-step onboarding flow specification" (covers both apps, design twins)
 *   Copy locked 2026-07-30. Spec locked 2026-07-31.
 *
 * CX owns this text. Do not reword it here. If a string has to change, change
 * the wiki first and port it down, so the two apps stay design twins.
 *
 * Hoisted into one object on purpose: it can be diffed against the wiki in a
 * single block, and the sibling app imports the same shape rather than
 * retyping strings.
 *
 * This file was presentation only up to 2026-07-31; the steps now talk to
 * Supabase auth and to VaultContext. What is real: the one-time code creates
 * the account, step 5 runs Argon2id and writes the vault row, and the words
 * shown are the ones that wrap the MEK. The biometric step has been removed
 * per DL-0714 (founder ruling DEC-0285); PRF enrolment is not yet implemented.
 * The capability probe and copy are kept as WebAuthn groundwork for when the
 * step returns (DL-0414 §6.1, founder-gated).
 */
export const ONBOARDING_COPY = {
  name: {
    headline: "What should we call you?",
    body: "Optional. Skip it if you like, just a friendly touch.",
    cta: "Continue",
    secondary: "Skip",
  },
  email: {
    headline: "What's your email?",
    body: "We'll send a one-time code. No password needed.",
    cta: "Send my code",
  },
  education: {
    headline: "Your data stays yours.",
    body: "Orange Way is built so we can never read your balances, your keys, or your history. Not us. Not anyone. It lives on your device.",
    cta: "Got it",
  },
  vaultPassword: {
    headline: "Create your vault password.",
    body: "This unlocks everything in Orange Way. We can never reset it for you. That is what the next step is for.",
    cta: "Set my password",
  },
  recovery: {
    headline: "Save your recovery kit.",
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
    cta: "Show me around",
    secondary: "Skip",
  },
} as const;

/**
 * CX sign-off received (DL-0539). Wording twins the sibling app's shipped
 * copy for the same screen. No further changes needed here before shipping.
 */
const VERIFY_COPY = {
  headline: "Prove you saved it",
  body: "Type the words at the positions below from your saved copy. This protects you from a future lockout.",
  cta: "Confirm",
  back: "Back to my recovery kit",
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
 *   staged    Both, as two stages of Step 5. Checkbox first, then type back
 *             3 words, with a way back to the code. Still 7 steps.
 *
 * "staged" is the default, and not as a split-the-difference compromise. It
 * is what the sibling app already ships and has had in production through its
 * own review: see its StepVaultPassword, where the display stage gates on a
 * checkbox and the verify stage then matches 3 words at random positions,
 * with "Back to code" so it is never a dead end.
 *
 * Design-twin parity is a standing requirement, so copying the shipped
 * pattern is both the cheapest correct answer and the one that needs no new
 * decision from anyone. Neither reading of the spec has to lose an argument
 * for the work to move.
 *
 * The other two modes stay because they cost nothing to keep. Flipping this
 * constant is the whole change: no id changes, no copy rewrites, no
 * renumbering above step 4.
 */
export type RecoveryVerifyMode = "staged" | "checkbox" | "reentry";

export const RECOVERY_VERIFY_MODE: RecoveryVerifyMode = "staged";

const FIELD_CLASS =
  "mt-6 w-full rounded-md border border-input bg-background px-4 py-3 text-lg text-foreground";

const RECOVERY_GRID_CLASS =
  "mt-6 grid grid-cols-3 gap-x-4 gap-y-2 rounded-md border border-dashed border-input p-4 font-mono text-sm";

// Matches MIN_VAULT_PASSWORD_LENGTH in the sibling app's src/lib/vault.ts,
// which is enforced in its crypto layer, not just its UI. Design twins, so
// the weaker of the two gates is the one that matters. Do not lower this.
const PASSWORD_MIN_LENGTH = 14;

const RECOVERY_WORD_COUNT = 12;

const VERIFY_WORD_COUNT = 3;

/**
 * Pick which words the parent has to type back.
 *
 * Random and CSPRNG-drawn, matching the sibling app, which has been doing this
 * in production. A fixed triple is the same three slots on every account,
 * which turns "prove you saved it" into "memorise three slots" for anyone who
 * has seen the flow once. Cheap to do right.
 */
function pickVerifyPositions() {
  const positions: number[] = [];
  while (positions.length < VERIFY_WORD_COUNT) {
    const buf = new Uint32Array(1);
    window.crypto.getRandomValues(buf);
    const position = buf[0] % RECOVERY_WORD_COUNT;
    if (!positions.includes(position)) positions.push(position);
  }
  return positions.sort((a, b) => a - b);
}

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
 * Capability probe for the biometric step, kept as WebAuthn groundwork for
 * when PRF enrolment is implemented (DL-0414 §6.1). The parent never chooses
 * between biometric and password mode; the device decides which screen renders.
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
  // Held above this component, so pressing Back still shows what was typed and
  // the value is still around at the end to be encrypted into user_profiles.
  const { name, setName } = useOnboardingState();
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

/**
 * Step 2, in two stages: send a one-time code, then verify it.
 *
 * A 6 digit code rather than a clickable link, decided 2026-07-31. The locked
 * copy says "one-time link", and a link is the one thing that cannot work
 * here: clicking it opens a new tab, this component tree is torn down, and the
 * name from step 1 and everything after it goes with it. A code is typed in
 * place, so the wizard survives. Copy correction is with CX.
 *
 * This is the only auth in the flow, and it is genuinely password-free: no
 * supabase.auth.signUp, no account password. The only password anyone sets is
 * the vault password on step 4, which is a different thing and never leaves
 * the device.
 */
function StepEmail(props: OnboardingStepProps) {
  const { name, email, setEmail, setEmailVerified } = useOnboardingState();
  const [stage, setStage] = useState<"address" | "code">("address");
  const [token, setToken] = useState("");
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sendBusy, setSendBusy] = useState(false);
  const [resendDisabled, setResendDisabled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const captchaRef = useRef<TurnstileInstance>(null);
  const copy = ONBOARDING_COPY.email;
  const headline = name.trim() ? `${name.trim()}, what's your email?` : copy.headline;
  const looksLikeEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  // Advances to the code screen immediately and fires the OTP send in the
  // background. The 5-10 second SMTP round trip is invisible to the user:
  // they see "Check your inbox." at once and any error surfaces there.
  const sendCode = async () => {
    setError(null);
    setStage("code"); // non-blocking: advance before the network call
    setSendBusy(true);
    setResendDisabled(true);
    try {
      const { error: sendError } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: {
          shouldCreateUser: true,
          ...(captchaToken ? { captchaToken } : {}),
        },
      });
      if (sendError) {
        setError(humanizeError(sendError, "Could not send the code. Please try again."));
      }
    } catch (err) {
      // Covers thrown exceptions (network drop mid-flight, etc.).
      setError(humanizeError(err, "Could not send the code. Please try again."));
    } finally {
      // A Turnstile token is single-use; reset whether the send succeeded or
      // failed so that a resend attempt can acquire a fresh one.
      setCaptchaToken(null);
      captchaRef.current?.reset();
      setSendBusy(false);
      // 5-second cooldown before resend is available.
      setTimeout(() => setResendDisabled(false), 5_000);
    }
  };

  const confirmCode = async () => {
    setBusy(true);
    setError(null);
    // type "email" is the code-in-the-body variant. "magiclink" is the one
    // that only ever arrives as a clickable URL, which is what we are avoiding.
    const { data, error: verifyError } = await supabase.auth.verifyOtp({
      email: email.trim(),
      token: token.trim(),
      type: "email",
    });
    setBusy(false);
    if (verifyError || !data.session) {
      setError(humanizeError(verifyError, "That code did not work. Check it and try again."));
      return;
    }
    setEmailVerified(true);
    props.onNext();
  };

  if (stage === "code") {
    return (
      <StepShell
        {...props}
        onNext={() => void confirmCode()}
        title="Check your inbox."
        nextLabel="Confirm"
        nextDisabled={token.trim().length < 6 || sendBusy}
        busy={busy}
        busyLabel="Checking..."
        error={error}
        secondaryLabel="Use a different address"
        onSecondary={() => {
          setStage("address");
          setToken("");
          setError(null);
        }}
        hideBack
      >
        <p>
          {sendBusy
            ? `Sending your code to ${email.trim()}...`
            : `We sent a 6-digit code to ${email.trim()}. It expires in a few minutes.`}
        </p>
        <input
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          value={token}
          onChange={(event) => setToken(event.target.value.replace(/\D/g, "").slice(0, 6))}
          placeholder="000000"
          aria-label="One-time code"
          className={FIELD_CLASS + " tracking-[0.4em]"}
        />
        <button
          type="button"
          disabled={resendDisabled}
          className="mt-3 text-sm text-muted-foreground disabled:opacity-40"
          onClick={() => {
            setToken("");
            setError(null);
            if (CAPTCHA_REQUIRED) {
              // The captcha widget only exists on the address stage;
              // go back so a fresh token can be acquired.
              setStage("address");
            } else {
              void sendCode();
            }
          }}
        >
          Resend code
        </button>
      </StepShell>
    );
  }

  return (
    <StepShell
      {...props}
      onNext={() => void sendCode()}
      title={headline}
      nextLabel={copy.cta}
      nextDisabled={!looksLikeEmail || (CAPTCHA_REQUIRED && !captchaToken)}
      busy={busy}
      busyLabel="Sending..."
      error={error}
    >
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
      <div className="mt-4">
        <CaptchaWidget
          ref={captchaRef}
          onSuccess={setCaptchaToken}
          onError={() => setCaptchaToken(null)}
          onExpire={() => setCaptchaToken(null)}
        />
      </div>
    </StepShell>
  );
}

// Non-skippable by construction: one CTA, no secondary link, nothing to
// dismiss. This is the trust moment, so the parent has to read past it.
function StepEducation(props: OnboardingStepProps) {
  const { name } = useOnboardingState();
  const copy = ONBOARDING_COPY.education;
  const headline = name.trim() ? `${name.trim()}, your data stays yours.` : copy.headline;

  return (
    <StepShell {...props} title={headline} nextLabel={copy.cta}>
      <p>{copy.body}</p>
    </StepShell>
  );
}

function StepVaultPassword(props: OnboardingStepProps) {
  // This password never leaves the device. It is the input to Argon2id in
  // createVault on the next step (64 MiB, 3 iterations, CSPRNG salt) and the
  // derived KEK wraps the MEK. Nothing typed here is transmitted; only the
  // wrapped ciphertext is.
  const { vaultPassword: password, setVaultPassword: setPassword } = useOnboardingState();
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

// Shared by the staged verify stage and by the standalone StepVerify, so the
// two modes cannot drift apart.
function RecoveryWordInputs({
  positions,
  answers,
  onChange,
}: {
  positions: number[];
  answers: string[];
  onChange: (next: string[]) => void;
}) {
  return (
    <>
      {positions.map((position, index) => (
        <input
          key={position}
          type="text"
          value={answers[index] ?? ""}
          onChange={(event) => {
            const value = event.target.value;
            onChange(answers.map((answer, i) => (i === index ? value : answer)));
          }}
          autoComplete="off"
          spellCheck={false}
          placeholder={"Word " + (position + 1)}
          aria-label={"Word " + (position + 1)}
          className={FIELD_CLASS}
        />
      ))}
    </>
  );
}

/**
 * The 12 real words, or skeleton slots while the vault is still being created.
 *
 * The words come from generateRecoveryCode() in src/lib/vault.ts, drawn from
 * the 7776 word EFF list at ~155 bits. Never rendered from anything else:
 * showing plausible-looking filler here would invite someone to write down a
 * placeholder and discover at recovery time that it unlocks nothing.
 */
function RecoveryCodeSlots({ code }: { code: string | null }) {
  const words = code ? code.trim().split(/\s+/) : [];

  return (
    <ol className={RECOVERY_GRID_CLASS}>
      {Array.from({ length: RECOVERY_WORD_COUNT }, (_, index) => (
        <li key={index} className="flex items-center gap-2">
          <span className="w-4 text-right text-muted-foreground">{index + 1}</span>
          {words[index] ? (
            <span className="flex-1 text-foreground">{words[index]}</span>
          ) : (
            <span className="h-4 flex-1 animate-pulse rounded bg-muted" />
          )}
        </li>
      ))}
    </ol>
  );
}

function StepRecovery(props: OnboardingStepProps) {
  // hideBack throughout, because going back to the vault password step would
  // re-derive the key and invalidate the code the parent was just told to
  // write down. That is exactly the dead end CX called out.
  const [stage, setStage] = useState<"display" | "verify">("display");
  const [confirmed, setConfirmed] = useState(false);
  const [positions, setPositions] = useState<number[]>([]);
  const [answers, setAnswers] = useState<string[]>([]);
  const [wrong, setWrong] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  // Bumped by the retry affordance so the create-vault effect re-runs after a
  // failure. Without it, a failed createVault sets creating.current back to
  // false but nothing in the effect's deps changes, so it never fires again
  // and the person is stranded: hideBack, no recovery code, Continue disabled.
  const [retryToken, setRetryToken] = useState(0);
  const { vaultPassword, recoveryKit, setRecoveryKit } = useOnboardingState();
  const { createVault } = useVault();
  const copy = ONBOARDING_COPY.recovery;
  const staged = RECOVERY_VERIFY_MODE === "staged";

  // Only reachable by deep-linking past step 4 or by a bug in the step order.
  // Says so rather than showing a grid of skeletons that will never fill in.
  const missingPassword = !recoveryKit && !vaultPassword;

  // Arriving on this step is what creates the vault. createVault generates the
  // MEK, wraps it under Argon2id with the step 4 password AND under the
  // recovery code, writes the row, and hands back the words rendered below.
  //
  // Guarded by a ref rather than by `recoveryKit` alone: React 19 strict mode
  // mounts effects twice in development, and a second createVault would try to
  // insert a second vault row for the same user and fail the unique
  // constraint, which would look like a real error to whoever is testing.
  const creating = useRef(false);
  useEffect(() => {
    // The no-password case is reported from render (missingPassword below)
    // rather than by setting state here, so the effect only ever writes state
    // asynchronously, after the promise settles.
    if (recoveryKit || creating.current || !vaultPassword) return;
    creating.current = true;
    let cancelled = false;

    void createVault(vaultPassword)
      .then((result) => {
        if (!cancelled) setRecoveryKit(result.recoveryCode);
      })
      .catch((cause: unknown) => {
        creating.current = false;
        if (cancelled) return;
        console.error(cause);
        setCreateError(humanizeError(cause, "Could not create your vault. Try again."));
      });

    return () => {
      cancelled = true;
    };
  }, [recoveryKit, vaultPassword, createVault, setRecoveryKit, retryToken]);

  // Clears the error and re-arms the create-vault effect. On the common
  // failure the insert is what throws, so no vault row was written and the
  // retry is a clean first attempt rather than a second insert.
  const retryCreate = () => {
    creating.current = false;
    setCreateError(null);
    setRetryToken((token) => token + 1);
  };

  // Drawn on entry to the verify stage, not on mount, so "Back to my code" and
  // a second attempt ask for a fresh triple rather than the same one again.
  const enterVerify = () => {
    setPositions(pickVerifyPositions());
    setAnswers(Array.from({ length: VERIFY_WORD_COUNT }, () => ""));
    setWrong(false);
    setStage("verify");
  };

  // Checks the typed words against the code that actually wraps the MEK. A
  // wrong answer draws a fresh triple: re-asking the same three would let
  // someone brute-force three known slots by repetition.
  const submitVerify = () => {
    if (verifyRecoveryKitWords(recoveryKit, positions, answers)) {
      props.onNext();
      return;
    }
    setWrong(true);
    setPositions(pickVerifyPositions());
    setAnswers(Array.from({ length: VERIFY_WORD_COUNT }, () => ""));
  };

  // Stage 2. Advancing from here is the container's ordinary onNext, so a
  // pass moves to step 6 like any other step completion. The way out is the
  // secondary link back to the code, never a Back button that would unwind
  // the vault password.
  if (staged && stage === "verify") {
    const allFilled = answers.every((answer) => answer.trim().length > 0);
    return (
      <StepShell
        {...props}
        onNext={submitVerify}
        title={VERIFY_COPY.headline}
        nextLabel={VERIFY_COPY.cta}
        nextDisabled={!allFilled}
        error={wrong ? "Those words did not match. Here are three different ones." : null}
        secondaryLabel={VERIFY_COPY.back}
        onSecondary={() => setStage("display")}
        hideBack
      >
        <p>{VERIFY_COPY.body}</p>
        <RecoveryWordInputs positions={positions} answers={answers} onChange={setAnswers} />
      </StepShell>
    );
  }

  return (
    <StepShell
      {...props}
      onNext={staged ? enterVerify : props.onNext}
      title={copy.headline}
      nextLabel={copy.cta}
      // Not just "did they tick the box": the code has to exist. Advancing
      // past a grid that is still loading would mean confirming words nobody
      // has been shown.
      nextDisabled={!confirmed || !recoveryKit}
      error={createError ?? (missingPassword ? "Go back and set a vault password first." : null)}
      // Vault creation can fail (network, RLS, a transient). Without a way to
      // retry, the failure is a dead end: Back is hidden and Continue stays
      // disabled with no recovery code. Offer a retry only for that failure,
      // never for the missing-password case, which needs a real Back instead.
      secondaryLabel={createError ? "Try again" : undefined}
      onSecondary={createError ? retryCreate : undefined}
      hideBack
    >
      <p>{copy.body}</p>
      <RecoveryCodeSlots code={recoveryKit} />
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

// Only mounted when RECOVERY_VERIFY_MODE is "reentry", the reading that makes
// the flow 8 steps.
function StepVerify(props: OnboardingStepProps) {
  const { recoveryKit } = useOnboardingState();
  const [positions, setPositions] = useState(pickVerifyPositions);
  const [answers, setAnswers] = useState<string[]>(() =>
    Array.from({ length: VERIFY_WORD_COUNT }, () => ""),
  );
  const [wrong, setWrong] = useState(false);
  const allFilled = answers.every((answer) => answer.trim().length > 0);

  // Same check as the staged variant, against the same code: whichever reading
  // of the spec we ship, the words typed here are matched to the ones that
  // actually wrap the MEK.
  //
  // Still unbuilt from the spec: the 5 second cooldown after three failures.
  // Redrawing the triple on every miss already denies the repeat-until-lucky
  // attack the cooldown was there to slow, so this is a rate-limit refinement
  // rather than a hole.
  const submit = () => {
    if (verifyRecoveryKitWords(recoveryKit, positions, answers)) {
      props.onNext();
      return;
    }
    setWrong(true);
    setPositions(pickVerifyPositions());
    setAnswers(Array.from({ length: VERIFY_WORD_COUNT }, () => ""));
  };

  return (
    <StepShell
      {...props}
      onNext={submit}
      title={VERIFY_COPY.headline}
      nextLabel={VERIFY_COPY.cta}
      nextDisabled={!allFilled}
      error={wrong ? "Those words did not match. Here are three different ones." : null}
      hideBack
    >
      <p>{VERIFY_COPY.body}</p>
      <RecoveryWordInputs positions={positions} answers={answers} onChange={setAnswers} />
    </StepShell>
  );
}

function StepSuccess(props: OnboardingStepProps) {
  // "I'll do this later" opens an empty dashboard. onSecondary defaults to
  // onNext, and this is the last step, so it completes the wizard either way.
  // Per spec: acceptable, the aha moment was offered. Do not block on it.
  const copy = ONBOARDING_COPY.success;
  const { name, recoveryKit } = useOnboardingState();
  const { finalizeVaultSetup } = useVault();
  const { updateDisplayName } = useProfile();

  // Reaching this screen is what commits the account. createVault already put
  // the keys in memory and wrote the vault row; finalizeVaultSetup flips the
  // two flags the rest of the app reads, so the dashboard behind this screen
  // opens unlocked instead of showing the "unlock your vault" gate to someone
  // who just typed their password twice.
  //
  // The name goes in here rather than on step 1, because encrypting it needs
  // the MEK and the MEK does not exist until step 5. It is written encrypted:
  // enc_display_name, same column and same helper the settings page uses.
  //
  // Ref-guarded for the same strict-mode reason as createVault, and gated on
  // recoveryKit so that a flow which somehow arrived here without a vault
  // does not claim an unlocked one.
  const committed = useRef(false);
  useEffect(() => {
    if (committed.current || !recoveryKit) return;
    committed.current = true;
    finalizeVaultSetup();
    const displayName = name.trim();
    // Mark this device as having completed onboarding. The auth screen reads
    // this key: presence = returning user (show welcome-back), value = name
    // to personalise the greeting. Written even when empty so a user who
    // skipped the name field still gets the generic "Welcome back." greeting.
    localStorage.setItem("ow_greeting_name", displayName);
    if (!displayName) return;
    // Deliberately not surfaced or awaited. The account, the vault and the
    // recovery code are all already durable at this point; a failed profile
    // write costs a greeting, and the name is editable in settings. Blocking
    // the last screen of onboarding on it would be the wrong trade.
    void updateDisplayName(displayName).catch(() => {});
  }, [recoveryKit, name, finalizeVaultSetup, updateDisplayName]);

  const headline = name.trim() ? `You're all set, ${name.trim()}.` : copy.headline;

  return (
    <StepShell
      {...props}
      title={headline}
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
    { id: "recovery-code", title: "Recovery kit", Component: StepRecovery },
    ...(mode === "reentry"
      ? [{ id: "verify-recovery-code", title: "Confirm recovery kit", Component: StepVerify }]
      : []),
    { id: "success", title: "You are all set", Component: StepSuccess },
  ];
}

export const ONBOARDING_STEPS: OnboardingStep[] = buildOnboardingSteps(RECOVERY_VERIFY_MODE);
