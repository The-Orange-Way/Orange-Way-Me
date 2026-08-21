/**
 * Cloudflare Turnstile captcha widget.
 *
 * Renders below the password field on sign-in / sign-up / reset
 * forms. On successful challenge it calls `onSuccess(token)` with
 * the Turnstile-issued token; the parent form passes that token to
 * `supabase.auth.signInWithPassword|signUp|resetPasswordForEmail` via
 * `{ options: { captchaToken } }`. Supabase verifies the token
 * server-side against Cloudflare's `/siteverify` endpoint.
 *
 * Configuration (build-time inlined):
 *   VITE_TURNSTILE_SITE_KEY: public site key for the target env.
 *     Branch-derived in `.github/workflows/deploy.yml`:
 *       dev  → Cloudflare's published always-passes TEST sitekey,
 *              hardcoded in the workflow. It is NOT read from a repo
 *              variable. That key issues a token without presenting a
 *              challenge, which is what lets an automated sign-in run
 *              on dev at all.
 *       prod → TURNSTILE_SITE_KEY_PROD repo var
 *     Because the dev key is the always-passes test key, the dev
 *     Supabase Auth project MUST carry Cloudflare's matching
 *     always-passes test secret. If it carries any other secret,
 *     Cloudflare answers `invalid-input-response` and every dev
 *     sign-in is rejected even though the widget appears to succeed.
 *     When the site key is unset, this component renders null and the
 *     form submits without a captchaToken, so the Supabase Auth
 *     project must then be configured to skip captcha verification;
 *     otherwise sign-in is rejected with a "captcha protection:
 *     request disallowed" error. Captcha is currently ENABLED on both
 *     the dev and the prod Auth project, so the SPA widget and the
 *     Supabase config have to stay aligned in both.
 *
 * Imperative API (forwarded ref):
 *   ref.current.reset(): clear the current token + re-issue
 *     challenge. Call this on auth-call failure so the user can
 *     retry without re-mounting the entire form.
 *
 * Privacy posture:
 *   Cloudflare Turnstile is the founder-preferred captcha (over
 *   hCaptcha) because it does not require third-party tracking
 *   cookies and Cloudflare's privacy posture aligns with the
 *   zero-knowledge marketing claim. See /security page for the full
 *   sub-processor disclosure (tracked separately).
 */

import { Turnstile, type TurnstileInstance } from "@marsidev/react-turnstile";
import { forwardRef } from "react";

interface CaptchaWidgetProps {
  /** Called with the Turnstile-issued token when the challenge succeeds. */
  onSuccess: (token: string) => void;
  /**
   * Called when the widget encounters an error (network failure,
   * expired challenge, etc.). The parent should clear any pending
   * captchaToken state so the form's submit button stays disabled.
   */
  onError?: () => void;
  /**
   * Called when a previously-issued token expires (Turnstile tokens
   * are valid for ~5 minutes). The parent should clear captchaToken
   * state; the widget auto-issues a new challenge.
   */
  onExpire?: () => void;
}

const SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined;

/**
 * Renders the Turnstile widget. Returns null when no site key is
 * configured for the current build: convenient for local `bun run
 * dev` without a Turnstile setup, and a clean fallback when an env
 * var is missing in CI.
 */
export const CaptchaWidget = forwardRef<TurnstileInstance, CaptchaWidgetProps>(
  function CaptchaWidget({ onSuccess, onError, onExpire }, ref) {
    if (!SITE_KEY) return null;
    return (
      <div className="flex justify-center">
        <Turnstile
          ref={ref}
          siteKey={SITE_KEY}
          onSuccess={onSuccess}
          onError={onError}
          onExpire={onExpire}
          options={{
            theme: "auto",
            size: "normal",
          }}
        />
      </div>
    );
  },
);

/**
 * Convenience flag for parent forms: `true` when a captcha widget
 * will render (and the parent should require a token before submit),
 * `false` when the build has no site key and the parent should
 * submit without a token.
 */
export const CAPTCHA_REQUIRED = Boolean(SITE_KEY);
