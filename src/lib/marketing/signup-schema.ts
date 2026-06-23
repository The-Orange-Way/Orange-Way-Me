/**
 * Signup schema + submit pipeline — React-free, isomorphic core.
 *
 * Imported by two surfaces:
 *   1. src/lib/marketing/useSignupForm.ts — the React hook used by
 *      the three marketing email-capture forms (/ Book signup,
 *      /landing-classic BookForm, /landing-classic WaitlistForm).
 *   2. functions/api/signup.ts — the Cloudflare Pages function that
 *      receives the POST. Using the same schema on both sides means
 *      the validation rules cannot drift between client and server.
 *
 * Keep this module free of React (and of the `useState` / `FormEvent`
 * imports that pulled React into the Worker bundle when both sides
 * shared one file).
 */

import { z } from "zod";

export type SignupKidsAge = "not_yet" | "little" | "bigger" | "just_me";
export type SignupFormType = "waitlist" | "book";

export const DEFAULT_SIGNUP_EMAIL_ERROR = "That doesn't look like an email";

/**
 * Build the zod schema for the email field. The `.pipe()` pattern is
 * load-bearing: it preserves trim-before-validate UX so pasted emails
 * with stray whitespace still pass under zod 4 `z.email()`. A bare
 * `z.email().trim().max()` chain would run the email regex on the raw
 * input first and reject `"  foo@bar.com  "`.
 */
export function buildSignupEmailSchema(errorMessage: string = DEFAULT_SIGNUP_EMAIL_ERROR) {
  return z.object({
    email: z.string().trim().pipe(z.email(errorMessage).max(255)),
  });
}

/**
 * Full request-body schema for /api/signup. Matches the SignupBody
 * shape both the client and the Pages function use; lets the server
 * replace its hand-rolled `emailValid` regex + `form` check with a
 * single `safeParse(await req.json())`.
 */
export const KIDS_AGE_VALUES = ["not_yet", "little", "bigger", "just_me"] as const;
export const SIGNUP_FORM_VALUES = ["waitlist", "book"] as const;

export function buildSignupRequestSchema(errorMessage: string = DEFAULT_SIGNUP_EMAIL_ERROR) {
  return z.object({
    form: z.enum(SIGNUP_FORM_VALUES),
    email: z.string().trim().pipe(z.email(errorMessage).max(255)),
    kids: z.enum(KIDS_AGE_VALUES).optional(),
  });
}

/**
 * Strip email-like substrings from a string, replacing each with
 * `<redacted-email>`. Used by functions/api/signup.ts to scrub PII
 * out of upstream error messages before they hit Workers logs.
 *
 * Resend's failure body can echo the submitted recipient address back
 * in validation messages (e.g. "Invalid `to` field: not.an.email"),
 * which would otherwise persist a real user email in any log surface
 * (tail logs, Logpush, error-tracking pipelines). The replacement
 * pattern is intentionally a touch wider than RFC 5321 so a malformed
 * but email-shaped string still gets caught; over-redaction here is
 * always safer than under-redaction.
 */
export function redactEmails(s: string): string {
  // Two passes:
  //   (1) the conservative ASCII/RFC-shaped pattern, which catches the
  //       overwhelming majority of real-world emails Resend will return;
  //   (2) a Unicode-aware backstop that catches IDN domains
  //       (user@münchen.de), exotic but unquoted local-parts, and any
  //       "non-whitespace @ non-whitespace . non-whitespace" shape the
  //       first pass missed. Over-redaction is always safer than under.
  return s
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "<redacted-email>")
    .replace(/\S+@\S+\.\S+/g, "<redacted-email>");
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
