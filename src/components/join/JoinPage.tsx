import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { toastError } from "@/lib/friendly-error";
import { CaptchaWidget, CAPTCHA_REQUIRED } from "@/components/auth/CaptchaWidget";
import type { TurnstileInstance } from "@marsidev/react-turnstile";

/**
 * Invite-code join flow. A link like /join?code=XYZ lets a person create an
 * account without the operator pre-collecting their email: the code is the
 * invite, and the user sets their own email + password here (the vault
 * password is created separately on the next screen and never reaches the
 * server).
 *
 * The code is the gate on this route, in place of the email allowlist used by
 * the standard AuthScreen. It does not bypass the allowlist; it is a separate
 * door with its own authorization. The authoritative, unbypassable check is
 * the Supabase Before-User-Created auth hook (follow-up): it will verify an
 * allowlisted email OR a valid code at user creation. Until it lands, the two
 * client RPCs here are the pre-check and a best-effort redemption, the same
 * posture the allowlist path already runs.
 */
type Phase = "checking" | "invalid" | "form" | "done";

export function JoinPage({ code }: { code: string }) {
  const { signUp } = useAuth();
  const [phase, setPhase] = useState<Phase>("checking");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const widgetRef = useRef<TurnstileInstance | null>(null);

  const resetCaptcha = () => {
    widgetRef.current?.reset();
    setCaptchaToken(null);
  };

  useEffect(() => {
    let active = true;
    void (async () => {
      if (!code) {
        if (active) setPhase("invalid");
        return;
      }
      // @ts-expect-error supabase types are generated against the deployed schema; this PR's
      // migration adds the RPC and types regenerate on the next `supabase gen types` pass.
      const { data: valid, error } = await supabase.rpc("is_invite_code_valid", { p_code: code });
      if (!active) return;
      // Fail closed: any error or a falsey result means the invite is not usable.
      setPhase(error || !valid ? "invalid" : "form");
    })();
    return () => {
      active = false;
    };
  }, [code]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const { error, isNew } = await signUp(email, password, captchaToken);
    if (error) {
      setBusy(false);
      toastError(error);
      resetCaptcha();
      return;
    }
    // Consume one use of the code after the account is created. The redeem RPC
    // is atomic (single UPDATE ... WHERE uses < max_uses), so concurrent
    // redemptions cannot exceed the cap. A best-effort failure here (for
    // example the code was exhausted in a race after this page loaded) does
    // not undo the account; the auth hook is the authoritative enforcement.
    // @ts-expect-error supabase types are generated against the deployed schema; this PR's
    // migration adds the RPC and types regenerate on the next `supabase gen types` pass.
    await supabase.rpc("redeem_invite_code", { p_code: code });
    setBusy(false);
    setPhase("done");
    if (isNew) {
      toast.success("Check your email to confirm your account, then sign in.");
    } else {
      toast.success("Account ready. Sign in to continue.");
    }
  };

  const submitDisabled = busy || (CAPTCHA_REQUIRED && !captchaToken);

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
            <p className="mt-1 text-sm text-muted-foreground">You have been invited</p>
          </div>
        </div>

        <Card className="shadow-card">
          <CardHeader className="pb-4">
            {phase === "checking" && <CardDescription>Checking your invite…</CardDescription>}

            {phase === "invalid" && (
              <>
                <CardTitle className="text-lg">Invite not valid</CardTitle>
                <CardDescription>
                  This invite link is invalid, has expired, or has already been used. Email{" "}
                  <a
                    href="mailto:hello@orangeway.app"
                    className="font-medium text-primary underline underline-offset-2"
                  >
                    hello@orangeway.app
                  </a>{" "}
                  to request access.
                </CardDescription>
              </>
            )}

            {phase === "done" && (
              <>
                <CardTitle className="text-lg">You are in</CardTitle>
                <CardDescription>
                  Check your email to confirm your account, then sign in to set up your vault.
                </CardDescription>
              </>
            )}

            {phase === "form" && (
              <>
                <CardTitle className="text-lg">Create your account</CardTitle>
                <CardDescription>
                  Sign up with your email and a password. Your vault password is created separately
                  on the next screen and is never sent to our servers.
                </CardDescription>
              </>
            )}
          </CardHeader>

          {phase === "form" && (
            <CardContent>
              <form onSubmit={onSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="jn-email">Email</Label>
                  <Input
                    id="jn-email"
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="jn-pw">Password</Label>
                  <Input
                    id="jn-pw"
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
            </CardContent>
          )}
        </Card>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          Your data is encrypted with a separate vault password we never see.
        </p>
      </div>
    </div>
  );
}
