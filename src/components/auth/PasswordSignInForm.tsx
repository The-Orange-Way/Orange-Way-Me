import type { RefObject } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CardDescription, CardTitle } from "@/components/ui/card";
import { CaptchaWidget } from "@/components/auth/CaptchaWidget";
import type { TurnstileInstance } from "@marsidev/react-turnstile";

/**
 * The legacy password sign-in path, extracted out of AuthScreen (DEC-0295
 * rule 4, OWM-T0035).
 *
 * DEC-0295 rule 4 (CTO Orange ruling): a code path used by every pre-v2
 * account is a supported flow, not dead code to delete alongside a feature
 * flag. This is that path. Before this extraction it lived as anonymous
 * JSX inside AuthScreen's non-V2 return block, gated only by the absence
 * of ONBOARDING_V2_ENABLED, which made it look like flag-scoped scaffolding
 * due for deletion once VITE_ONBOARDING_V2 ships everywhere. It is not:
 * every account created before the V2 OTP onboarding shipped signs in
 * here, and it must keep working (and keep its own tests) independent of
 * whatever happens to the V2 flag.
 *
 * e2e-anchor: tests/e2e/auth.setup.ts logs the fixture test user in via
 * the #si-email and #si-pw inputs and the "Sign in" button. Renaming
 * either id, or the button's role/label, breaks the authenticated
 * harness; update auth.setup.ts in the same change.
 */
export interface PasswordSignInFormProps {
  email: string;
  onEmailChange: (email: string) => void;
  password: string;
  onPasswordChange: (password: string) => void;
  /** Form submit handler. AuthScreen wires this to its onSignIn, which reads
   * email/password from its own state and calls signIn(email, password, captchaToken). */
  onSubmit: (e: React.FormEvent) => void;
  busy: boolean;
  submitDisabled: boolean;
  onForgotPassword: () => void;
  widgetRef: RefObject<TurnstileInstance | null>;
  onCaptchaSuccess: (token: string) => void;
  onCaptchaReset: () => void;
}

export function PasswordSignInForm({
  email,
  onEmailChange,
  password,
  onPasswordChange,
  onSubmit,
  busy,
  submitDisabled,
  onForgotPassword,
  widgetRef,
  onCaptchaSuccess,
  onCaptchaReset,
}: PasswordSignInFormProps) {
  return (
    <>
      <CardTitle className="text-lg">Welcome back</CardTitle>
      <CardDescription>Sign in with your email and password.</CardDescription>
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="si-email">Email</Label>
          <Input
            id="si-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => onEmailChange(e.target.value)}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="si-pw">Password</Label>
          <Input
            id="si-pw"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => onPasswordChange(e.target.value)}
            required
          />
        </div>
        <CaptchaWidget
          ref={widgetRef}
          onSuccess={onCaptchaSuccess}
          onError={onCaptchaReset}
          onExpire={onCaptchaReset}
        />
        <Button type="submit" className="w-full" disabled={submitDisabled}>
          {busy ? "Signing in…" : "Sign in"}
        </Button>
        <button
          type="button"
          className="w-full text-center text-xs text-muted-foreground hover:text-foreground"
          onClick={onForgotPassword}
        >
          Forgot your password?
        </button>
      </form>
    </>
  );
}
