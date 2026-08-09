import { useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useAuth } from "@/context/AuthContext";
import { ONBOARDING_V2_ENABLED } from "@/features/onboarding/onboarding-flow";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { toastError } from "@/lib/friendly-error";
import { CaptchaWidget, CAPTCHA_REQUIRED } from "@/components/auth/CaptchaWidget";
import type { TurnstileInstance } from "@marsidev/react-turnstile";

/**
 * Open the sign-up form when this flag is set to "1" at build time.
 * Default is unset, which keeps the production "private beta" gate in
 * place. The dev Pages project sets this so contributors can self-
 * serve a fixture identity without an admin-API workaround. The flag
 * is build-time (Vite inlines import.meta.env.* into the bundle), so
 * flipping it requires a redeploy of the target environment there
 * is deliberately no runtime toggle a malicious client could flip.
 */
const SIGNUP_OPEN = import.meta.env.VITE_DEV_SIGNUP_OPEN === "1";
// V2 entry: reuses the gate already defined in onboarding-flow so the
// auth entry link and the /onboarding route are always in sync. If
// ONBOARDING_V2_ENABLED is off, /onboarding redirects to /auth anyway,
// so linking there from a v2 entry that is also off is harmless, but
// keeping them tied prevents that inconsistency from even arising.
const V2 = ONBOARDING_V2_ENABLED;

export function AuthScreen() {
  const { signUp, signIn, resetPassword } = useAuth();
  const [tab, setTab] = useState<"signin" | "signup" | "reset">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  /**
   * Turnstile-issued challenge token. Stays null until the widget
   * fires `onSuccess`; the submit button is disabled while null AND
   * the build has a site key configured (CAPTCHA_REQUIRED). When
   * the build has no site key, the form submits without a token and
   * Supabase Auth is expected to be configured to accept tokenless
   * calls on the matching project: the dev project today, or any
   * env where the operator has not yet flipped captcha on in
   * Studio.
   */
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [otpStage, setOtpStage] = useState<"email" | "code">("email");
  const [otpToken, setOtpToken] = useState("");
  const [resendDisabled, setResendDisabled] = useState(false);
  /**
   * Ref to the widget so the auth call's error branch can call
   * `widgetRef.current?.reset()` and re-issue a fresh challenge
   * without remounting the entire form. Turnstile tokens are
   * single-use: a stale token on retry would fail; resetting on
   * error is the canonical recovery.
   */
  const widgetRef = useRef<TurnstileInstance | null>(null);

  const resetCaptcha = () => {
    widgetRef.current?.reset();
    setCaptchaToken(null);
  };

  const onSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const { error } = await signIn(email, password, captchaToken);
    setBusy(false);
    if (error) {
      toastError(error);
      resetCaptcha();
    }
  };

  const onSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    // Beta allowlist pre-check runs BEFORE the supabase.auth.signUp
    // call so a not-on-list email doesn't burn the Turnstile token
    // either. Fail-closed: if the RPC errors (network blip, RLS
    // surprise) we treat it as "not allowed" and surface the
    // private-beta toast. A determined attacker can call
    // supabase.auth.signUp directly and bypass this gate; the
    // Supabase Auth Before-User-Created Hook tracked as a follow-up
    // is the unbypassable enforcement.
    // @ts-expect-error supabase types are generated against the deployed schema; this PR's
    // migration adds the RPC and types regenerate on the next `supabase gen types` pass.
    const { data: allowed, error: rpcError } = await supabase.rpc("is_email_in_beta_allowlist", {
      p_email: email,
    });
    if (rpcError || !allowed) {
      setBusy(false);
      toast.error(
        "Orange Way is currently in private beta. Email hello@orangeway.app to request access.",
      );
      return;
    }
    const { error, isNew } = await signUp(email, password, captchaToken);
    setBusy(false);
    if (error) {
      toastError(error);
      resetCaptcha();
      return;
    }
    if (isNew) {
      toast.success("Check your email to confirm your account, then sign in.");
    } else {
      toast.success("Account ready. Sign in to continue.");
    }
    setTab("signin");
  };

  const onReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const { error } = await resetPassword(email, captchaToken);
    setBusy(false);
    if (error) {
      toastError(error);
      resetCaptcha();
    } else {
      toast.success("If an account exists for that email, we just sent a link.");
    }
  };

  const sendOtpCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setOtpStage("code"); // advance immediately; send runs in the background
    setResendDisabled(true);
    try {
      const { error: sendError } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: {
          shouldCreateUser: false,
          ...(captchaToken ? { captchaToken } : {}),
        },
      });
    } catch (err) {
      toast.error("Unable to send the code. Please try again.");
    } finally {
      resetCaptcha();
      setBusy(false);
      setTimeout(() => setResendDisabled(false), 5_000);
    }
  };

  const verifyOtpCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const { data, error: verifyError } = await supabase.auth.verifyOtp({
      email: email.trim(),
      token: otpToken.trim(),
      type: "email",
    });
    setBusy(false);
    if (verifyError || !data.session) {
      toastError(new Error("That code did not work. Check it and try again."));
      return;
    }
    // Session established. AuthContext picks it up via onAuthStateChange;
    // AuthRoute redirects to /dashboard automatically.
  };

  const navigate = useNavigate();
  const submitDisabled = busy || (CAPTCHA_REQUIRED && !captchaToken);
  const welcomeTitle = "Welcome back. Your vault is already here.";

  // V2 entry point: sign-in form + create-account link to /onboarding.
  // V2 is the only gate here. SIGNUP_OPEN is a separate flag that governs
  // the legacy password sign-up form (the tab panel below) and is left
  // empty in CI so the broken legacy flow stays off. Folding it into this
  // guard made the entire block dead code at Vite build time. Keep them
  // independent: the user chooses sign-in or create-account, no auto-redirect.
  if (V2) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        <div className="w-full max-w-md">
          <div className="mb-8 flex justify-center">
            <img
              src="/icon-192.png"
              alt=""
              width={48}
              height={48}
              className="h-12 w-12 rounded-2xl"
            />
          </div>

          <Card className="shadow-card">
            <CardContent className="pt-6">
              {tab !== "reset" ? (
                <>
                  {/*
                    e2e-anchor: OTP flow. Stage "email" shows #si-email
                    (kept for compatibility with auth.setup.ts which drives
                    the non-V2 fixture path). Stage "code" shows #si-otp.
                    #si-pw is removed from the V2 path: V2 accounts have no
                    password (OTP-only onboarding, DL-0708).
                  */}
                  {otpStage === "email" ? (
                    <form onSubmit={sendOtpCode} className="space-y-4">
                      <p className="text-lg font-semibold leading-none tracking-tight">
                        {welcomeTitle}
                      </p>
                      <div className="space-y-2">
                        <Label htmlFor="si-email">Email</Label>
                        <Input
                          id="si-email"
                          type="email"
                          autoComplete="email"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          required
                        />
                      </div>
                      <CaptchaWidget
                        ref={widgetRef}
                        onSuccess={setCaptchaToken}
                        onError={resetCaptcha}
                        onExpire={resetCaptcha}
                      />
                      <Button type="submit" className="w-full" disabled={submitDisabled}>
                        {busy ? "Sending..." : "Send my code"}
                      </Button>
                    </form>
                  ) : (
                    <form onSubmit={verifyOtpCode} className="space-y-4">
                      <p className="text-sm text-muted-foreground">
                        We sent a code to <strong>{email}</strong>. Check your inbox.
                      </p>
                      <div className="space-y-2">
                        <Label htmlFor="si-otp">One-time code</Label>
                        <Input
                          id="si-otp"
                          type="text"
                          inputMode="numeric"
                          autoComplete="one-time-code"
                          value={otpToken}
                          onChange={(e) => setOtpToken(e.target.value)}
                          required
                        />
                      </div>
                      <Button type="submit" className="w-full" disabled={busy}>
                        {busy ? "Verifying..." : "Sign in"}
                      </Button>
                      <button
                        type="button"
                        className="w-full text-center text-xs text-muted-foreground hover:text-foreground"
                        disabled={resendDisabled || busy}
                        onClick={() => {
                          setOtpToken("");
                          setOtpStage("email");
                        }}
                      >
                        {resendDisabled
                          ? "Resend available shortly..."
                          : "Use a different email or resend code"}
                      </button>
                    </form>
                  )}
                  <p className="mt-6 text-center text-sm text-muted-foreground">
                    New to Orange Way?{" "}
                    <button
                      type="button"
                      className="font-medium text-primary underline underline-offset-2"
                      onClick={() => void navigate({ to: "/onboarding" })}
                    >
                      Create an account
                    </button>
                  </p>
                </>
              ) : (
                <div className="space-y-4">
                  <div>
                    <CardTitle className="text-lg">Reset password</CardTitle>
                    <CardDescription>We&apos;ll email you a reset link.</CardDescription>
                  </div>
                  <form onSubmit={onReset} className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="rs-email">Email</Label>
                      <Input
                        id="rs-email"
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                      />
                    </div>
                    <CaptchaWidget
                      ref={widgetRef}
                      onSuccess={setCaptchaToken}
                      onError={resetCaptcha}
                      onExpire={resetCaptcha}
                    />
                    <Button type="submit" className="w-full" disabled={submitDisabled}>
                      {busy ? "Sending..." : "Send reset link"}
                    </Button>
                    <button
                      type="button"
                      className="w-full text-center text-xs text-muted-foreground hover:text-foreground"
                      onClick={() => setTab("signin")}
                    >
                      Back to sign in
                    </button>
                  </form>
                </div>
              )}
            </CardContent>
          </Card>

          <p className="mt-6 text-center text-xs text-muted-foreground">
            Your data is encrypted with a separate vault password we never see.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-md">
        <div className="mb-8 flex flex-col items-center gap-3">
          <img
            src="/icon-192.png"
            alt=""
            width={48}
            height={48}
            className="h-12 w-12 rounded-2xl"
          />
          <div className="text-center">
            <h1 className="text-2xl font-semibold tracking-tight">Orange Way</h1>
            <p className="mt-1 text-sm text-muted-foreground">Zero-knowledge personal finance</p>
          </div>
        </div>

        <Card className="shadow-card">
          <CardHeader className="pb-4">
            <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="signin">Sign in</TabsTrigger>
                <TabsTrigger value="signup">Sign up</TabsTrigger>
              </TabsList>

              <TabsContent value="signin" className="mt-6 space-y-4">
                <CardTitle className="text-lg">Welcome back</CardTitle>
                <CardDescription>Sign in with your email and password.</CardDescription>
                {/*
                  e2e-anchor: tests/e2e/auth.setup.ts logs the
                  fixture test user in via the #si-email and #si-pw
                  inputs and the "Sign in" button. Renaming any of
                  those breaks the authenticated harness; update
                  auth.setup.ts in the same change.
                */}
                <form onSubmit={onSignIn} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="si-email">Email</Label>
                    <Input
                      id="si-email"
                      type="email"
                      autoComplete="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
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
                      onChange={(e) => setPassword(e.target.value)}
                      required
                    />
                  </div>
                  <CaptchaWidget
                    ref={widgetRef}
                    onSuccess={setCaptchaToken}
                    onError={resetCaptcha}
                    onExpire={resetCaptcha}
                  />
                  <Button type="submit" className="w-full" disabled={submitDisabled}>
                    {busy ? "Signing in…" : "Sign in"}
                  </Button>
                  <button
                    type="button"
                    className="w-full text-center text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => setTab("reset")}
                  >
                    Forgot your password?
                  </button>
                </form>
              </TabsContent>

              <TabsContent value="signup" className="mt-6 space-y-4">
                {SIGNUP_OPEN ? (
                  <>
                    <CardTitle className="text-lg">Create your account</CardTitle>
                    <CardDescription>
                      Sign up with your email and a password. Your vault password is created
                      separately on the next screen and is never sent to our servers.
                    </CardDescription>
                    {/*
                      e2e-anchor (forward-looking): the planned fixture-
                      user provisioning script and any future Playwright
                      spec that exercises the sign-up surface will
                      discriminate the sign-up form from the sign-in form
                      via the #su-email and #su-pw input ids. Renaming
                      either requires updating the spec in the same
                      change. Pattern follows the existing auth.setup.ts
                      anchors (#si-email / #si-pw / #v-pw).
                    */}
                    <form onSubmit={onSignUp} className="space-y-4">
                      <div className="space-y-2">
                        <Label htmlFor="su-email">Email</Label>
                        <Input
                          id="su-email"
                          type="email"
                          autoComplete="email"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          required
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="su-pw">Password</Label>
                        <Input
                          id="su-pw"
                          type="password"
                          autoComplete="new-password"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          minLength={12}
                          required
                        />
                      </div>
                      <CaptchaWidget
                        ref={widgetRef}
                        onSuccess={setCaptchaToken}
                        onError={resetCaptcha}
                        onExpire={resetCaptcha}
                      />
                      <Button type="submit" className="w-full" disabled={submitDisabled}>
                        {busy ? "Creating account…" : "Create account"}
                      </Button>
                    </form>
                    {/*
                      Visible reminder that the open form is a dev-only
                      surface. The dev Supabase project has no path to
                      prod data, but contributors arriving at the page
                      should not assume sign-ups here are part of the
                      private beta on orangeway.app.
                    */}
                    <p className="text-xs text-muted-foreground">
                      This is the development environment. Don&apos;t use a real production
                      password; create an account with a throwaway one.
                    </p>
                  </>
                ) : (
                  <>
                    <CardTitle className="text-lg">Private beta</CardTitle>
                    <CardDescription>
                      Orange Way is currently in private beta. Email{" "}
                      <a
                        href="mailto:hello@orangeway.app"
                        className="font-medium text-primary underline underline-offset-2"
                      >
                        hello@orangeway.app
                      </a>{" "}
                      to request access.
                    </CardDescription>
                    <p className="text-sm text-muted-foreground">
                      Already have an account?{" "}
                      <button
                        type="button"
                        onClick={() => setTab("signin")}
                        className="font-medium text-primary underline underline-offset-2"
                      >
                        Sign in
                      </button>
                      .
                    </p>
                  </>
                )}
              </TabsContent>
            </Tabs>
          </CardHeader>
          <CardContent>
            {tab === "reset" && (
              <div className="space-y-4">
                <div>
                  <CardTitle className="text-lg">Reset password</CardTitle>
                  <CardDescription>We'll email you a reset link.</CardDescription>
                </div>
                <form onSubmit={onReset} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="rs-email">Email</Label>
                    <Input
                      id="rs-email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                    />
                  </div>
                  <CaptchaWidget
                    ref={widgetRef}
                    onSuccess={setCaptchaToken}
                    onError={resetCaptcha}
                    onExpire={resetCaptcha}
                  />
                  <Button type="submit" className="w-full" disabled={submitDisabled}>
                    {busy ? "Sending…" : "Send reset link"}
                  </Button>
                  <button
                    type="button"
                    className="w-full text-center text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => setTab("signin")}
                  >
                    Back to sign in
                  </button>
                </form>
              </div>
            )}
          </CardContent>
        </Card>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          Your data is encrypted with a separate vault password we never see.
        </p>
      </div>
    </div>
  );
}
