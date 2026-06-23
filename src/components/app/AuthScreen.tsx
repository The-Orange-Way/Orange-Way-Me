import { useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { toastError } from "@/lib/friendly-error";
import { Lock } from "lucide-react";

export function AuthScreen() {
  const { signIn, resetPassword } = useAuth();
  const [tab, setTab] = useState<"signin" | "signup" | "reset">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const onSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const { error } = await signIn(email, password);
    setBusy(false);
    if (error) toastError(error);
  };

  const onReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const { error } = await resetPassword(email);
    setBusy(false);
    if (error) toastError(error);
    else toast.success("Check your email for a reset link.");
  };

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
                  <Button type="submit" className="w-full" disabled={busy}>
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
                  <Button type="submit" className="w-full" disabled={busy}>
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
