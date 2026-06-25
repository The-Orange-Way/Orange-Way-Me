/**
 * useSignupForm: React glue around the pure signup-schema core.
 *
 * The validation schema, the submit pipeline, and the result shape
 * all live in ./signup-schema.ts so the Cloudflare Pages function at
 * functions/api/signup.ts can import them too. That way the email
 * validation rules cannot drift between the client form and the
 * server endpoint. Anything React-specific (state, FormEvent) stays
 * here.
 *
 * Each marketing route's form ("/" Book signup, "/landing-classic"
 * BookForm, "/landing-classic" WaitlistForm) renders its own JSX
 * against the state this hook returns. Hoisting just the LOGIC
 * keeps the schema, submit handler, and network call in one place
 * while leaving each route free to keep its palette, button shape,
 * and microcopy.
 */

import { useState, type FormEvent } from "react";
import { postSignup, type SignupFormType, type SignupKidsAge } from "./signup-schema";

export type { SignupFormType, SignupKidsAge } from "./signup-schema";

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
