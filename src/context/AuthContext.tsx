import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import posthog from "posthog-js";
import { supabase } from "@/integrations/supabase/client";
import { buildSignUpOptions } from "@/lib/signup-options";

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  loading: boolean;
  /**
   * Sign up a new account. `captchaToken` is the Turnstile-issued
   * token from the `CaptchaWidget`; when the Supabase project is
   * configured with Cloudflare Turnstile, supplying a valid token is
   * required. Pass `null` when the project does not enforce captcha
   * (dev project today, or when `VITE_TURNSTILE_SITE_KEY` is unset).
   *
   * `inviteCode` is the /join route's invite code. It has to travel as
   * signUp user metadata because the Before-User-Created auth hook
   * (`public.enforce_beta_signup`) reads it from
   * `event.user.user_metadata.invite_code` and rejects the signup outright
   * when it is absent and the email is not allowlisted. Client-supplied
   * metadata grants no bypass: the hook decides against the invite_codes
   * table, so a forged code fails the predicate.
   */
  signUp: (
    email: string,
    password: string,
    captchaToken: string | null,
    inviteCode?: string | null,
  ) => Promise<{ error: Error | null; isNew: boolean }>;
  /** Same captcha contract as signUp. */
  signIn: (
    email: string,
    password: string,
    captchaToken: string | null,
  ) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  /** Same captcha contract as signUp. */
  resetPassword: (email: string, captchaToken: string | null) => Promise<{ error: Error | null }>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // One-shot sweep of legacy `ow_bank_label_<connId>` localStorage keys.
    // The old AddBankDialog cached institution names (e.g. "Mercury", "TD")
    // in cleartext: exactly the identifier the encrypted connection label
    // was supposed to protect. We dropped that cache, but existing browser
    // profiles still have the rows. Sweep runs at app startup so users who
    // never open Connections still get cleaned up.
    try {
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (k && k.startsWith("ow_bank_label_")) localStorage.removeItem(k);
      }
    } catch {
      /* localStorage blocked: non-fatal */
    }

    // Set up listener BEFORE getSession.
    //
    // We DO NOT call posthog.identify here. PostHog is configured with
    // person_profiles: "never" (__root.tsx) so identify is a no-op today,
    // but leaving the calls in is a foot-gun: flipping the config
    // upstream would immediately ship the Supabase user id (UUID, but
    // user-correlatable) to PostHog. ZKA-aligned posture is "don't
    // associate any identifier with the analytics stream"; reset on
    // sign-out is sufficient and remains.
    const { data: sub } = supabase.auth.onAuthStateChange((event, newSession) => {
      setSession(newSession);
      setUser(newSession?.user ?? null);
      if (!newSession?.user) {
        posthog.reset();
        // Clear the welcome-back greeting key on every sign-out path
        // (sign out, session expiry, account switch).
        // Privacy ruling (DL-0717): this key must not survive sign-out.
        try {
          localStorage.removeItem("ow_greeting_name");
        } catch {
          /* localStorage blocked: non-fatal */
        }
      }

      // There is deliberately no invite-code redemption here any more.
      //
      // This used to read `ow_pending_invite_code` out of localStorage on
      // SIGNED_IN and call redeem_invite_code. That was correct only while
      // the client was the sole redeemer. The Before-User-Created auth hook
      // now consumes the code at user creation, so a second redeem here
      // spends a second use: harmless on a max_uses = 1 code, but a group
      // invite of max_uses = 10 would be exhausted by five people. Leaving
      // one writer -- the hook -- is also what removes the double-consume
      // race the old client redeem created.
      //
      // Sweep the stale key so browsers that already have one do not carry
      // it around forever. It is never written any more.
      if (event === "SIGNED_IN" && newSession?.user) {
        try {
          localStorage.removeItem("ow_pending_invite_code");
        } catch {
          /* localStorage blocked: non-fatal */
        }
      }
    });

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setUser(data.session?.user ?? null);
      setLoading(false);
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  const signUp: AuthContextValue["signUp"] = async (email, password, captchaToken, inviteCode) => {
    const redirectUrl = `${window.location.origin}/`;
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: buildSignUpOptions({ emailRedirectTo: redirectUrl, captchaToken, inviteCode }),
    });
    return {
      error: error as Error | null,
      isNew: !!data.user && data.user.identities?.length !== 0,
    };
  };

  const signIn: AuthContextValue["signIn"] = async (email, password, captchaToken) => {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
      ...(captchaToken ? { options: { captchaToken } } : {}),
    });
    return { error: error as Error | null };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  const resetPassword: AuthContextValue["resetPassword"] = async (email, captchaToken) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
      ...(captchaToken ? { captchaToken } : {}),
    });
    return { error: error as Error | null };
  };

  return (
    <AuthContext.Provider
      value={{ session, user, loading, signUp, signIn, signOut, resetPassword }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
