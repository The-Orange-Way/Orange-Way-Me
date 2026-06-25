import { useRef, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { toastError } from "@/lib/friendly-error";
import { Lock } from "lucide-react";
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
      toast.success("Check your email for a reset link.");
    }
  };

  const submitDisabled = busy || (CAPTCHA_REQUIRED && !captchaToken);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-md">
        <div className="mb-8 flex flex-col items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <Lock className="h-5 w-5" />
          </div>
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
