/**
 * useSignupForm — shared state + submit logic for the marketing
 * email-capture forms ("/" Book signup, "/landing-classic" BookForm,
 * "/landing-classic" WaitlistForm).
 *
 * Why a hook instead of a shared <BookEmailForm /> component:
 *   - Each route's marketing form has its own palette, button shape,
 *     microcopy, and layout. Wrapping all three in one component would
 *     mean threading styling props through every call site, and the
 *     visual divergence between "/" (orange-deep palette, single email
 *     field) and "/landing-classic" (cream-burnt palette, email + kids
 *     select) is intentional, not accidental.
 *   - Hoisting just the LOGIC keeps the schema (zod 4 z.email() with
 *     trim-before-validate via .pipe()), the submit handler, and the
 *     network call in one place. Each route renders its own JSX
 *     against the returned state.
 *   - The non-React core lives in `buildSignupEmailSchema` + `postSignup`
 *     below so the unit tests can exercise the full validation +
 *     network pipeline without needing @testing-library/react in the
 *     dev tree.
 *
 * Wire-format: POSTs `{form, email[, kids]}` to /api/signup. The
 * Cloudflare Pages function at functions/api/signup.ts routes by the
 * `form` discriminator and sends a transactional confirmation via
 * Resend. Endpoint hardening (rate limit, unsubscribe in the
 * confirmation HTML, record-of-consent persistence) is tracked
 * separately; this hook layer does not change that surface.
 */

import { useState, type FormEvent } from "react";
import { z } from "zod";

export type SignupKidsAge = "not_yet" | "little" | "bigger" | "just_me";
export type SignupFormType = "waitlist" | "book";

export interface SignupFormConfig {
  /** Which list to post the email to. The Resend confirmation copy
   *  branches on this in functions/api/signup.ts. */
  form: SignupFormType;
  /** When true, the form captures + posts the kids age segmentation.
   *  The /api/signup endpoint accepts kids as optional; the value is
   *  used in the Resend confirmation copy when present. Defaults to
   *  false so the simpler "/" form doesn't need to set it. */
  withKids?: boolean;
  /** Optional override for the email validation error message. */
  emailErrorMessage?: string;
}

export interface SignupFormState {
  email: string;
  setEmail: (v: string) => void;
  kids: SignupKidsAge;
  setKids: (v: SignupKidsAge) => void;
  err: string | null;
  done: boolean;
  submitting: boolean;
  onSubmit: (e: FormEvent) => Promise<void>;
}

const DEFAULT_EMAIL_ERROR = "That doesn't look like an email";

/**
 * Build the zod schema for the email field. The `.pipe()` pattern is
 * load-bearing: it preserves trim-before-validate UX so pasted emails
 * with stray whitespace still pass under zod 4 `z.email()`. A bare
 * `z.email().trim().max()` chain would run the email regex on the raw
 * input first and reject `"  foo@bar.com  "`.
 */
export function buildSignupEmailSchema(errorMessage: string = DEFAULT_EMAIL_ERROR) {
  return z.object({
    email: z.string().trim().pipe(z.email(errorMessage).max(255)),
  });
}

export type SignupPostResult = { ok: true } | { ok: false; err: string };

/**
 * Core submit pipeline. Validates the raw input via the schema, posts
 * the parsed body to /api/signup, and returns a discriminated-union
 * result the React hook (or any other consumer) can use to update its
 * state machine. Pure: takes a fetch impl so tests can stub it.
 */
export async function postSignup(args: {
  form: SignupFormType;
  email: string;
  kids?: SignupKidsAge;
  errorMessage?: string;
  fetchImpl?: typeof fetch;
}): Promise<SignupPostResult> {
  const fetchFn = args.fetchImpl ?? fetch;
  const schema = buildSignupEmailSchema(args.errorMessage);
  const parsed = schema.safeParse({ email: args.email });
  if (!parsed.success) {
    return { ok: false, err: parsed.error.issues[0]?.message ?? "Something is off." };
  }
  const body: Record<string, unknown> = {
    form: args.form,
    email: parsed.data.email,
  };
  if (args.kids !== undefined) {
    body.kids = args.kids;
  }
  try {
    const resp = await fetchFn("/api/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      return { ok: false, err: "Something went wrong. Try again in a minute." };
    }
    return { ok: true };
  } catch {
    return { ok: false, err: "Network error. Try again in a minute." };
  }
}

export function useSignupForm(config: SignupFormConfig): SignupFormState {
  const [email, setEmail] = useState("");
  const [kids, setKids] = useState<SignupKidsAge>("little");
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setErr(null);
    setSubmitting(true);
    const result = await postSignup({
      form: config.form,
      email,
      kids: config.withKids ? kids : undefined,
      errorMessage: config.emailErrorMessage,
    });
    setSubmitting(false);
    if (result.ok) {
      setDone(true);
      return;
    }
    setErr(result.err);
  };

  return { email, setEmail, kids, setKids, err, done, submitting, onSubmit };
}
