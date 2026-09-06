import type { RefObject } from "react";
import type { TurnstileInstance } from "@marsidev/react-turnstile";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CardDescription, CardTitle } from "@/components/ui/card";
import { CaptchaWidget } from "@/components/auth/CaptchaWidget";

/**
 * The password sign-in path: email + password, submit, forgot-password link.
 *
 * DEC-0295 rule 4 (CTO Orange): every pre-v2 account signs in through this
 * path, so it is a supported flow and not dead code behind
 * VITE_ONBOARDING_V2. It must not be deleted alongside that flag. Extracted
 * with its own name, ticket (OWM-T0035) and tests per that ruling, out of
 * AuthScreen.tsx where it previously lived as anonymous inline JSX in the
 * "signin" TabsContent.
 */
export interface PasswordSignInProps {
  email: string;
  onEmailChange: (value: string) => void;
  password: string;
  onPasswordChange: (value: string) => void;
  busy: boolean;
  submitDisabled: boolean;
  onSubmit: (e: React.FormEvent) => void;
  widgetRef: RefObject<TurnstileInstance | null>;
  onCaptchaSuccess: (token: string | null) => void;
  onCaptchaError: () => void;
  onCaptchaExpire: () => void;
  onForgotPassword: () => void;
}

export function PasswordSignIn({
  email,
  onEmailChange,
  password,
  onPasswordChange,
  busy,
  submitDisabled,
  onSubmit,
  widgetRef,
  onCaptchaSuccess,
  onCaptchaError,
  onCaptchaExpire,
  onForgotPassword,
}: PasswordSignInProps) {
  return (
    <>
      <CardTitle className="text-lg">Welcome back</CardTitle>
      <CardDescription>Sign in with your email and password.</CardDescription>
      {/*
        e2e-anchor: tests/e2e/auth.setup.ts logs the
        fixture test user in via the #si-email and #si-pw
        inputs and the "Sign in" button. Renaming any of
        those breaks the authenticated harness; update
        auth.setup.ts in the same change.
      */}
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
          onError={onCaptchaError}
          onExpire={onCaptchaExpire}
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
