/**
 * The options object handed to `supabase.auth.signUp`.
 *
 * This lives in its own module for one reason: the invite-code path broke in
 * production precisely here and nothing caught it. The Before-User-Created
 * auth hook (`public.enforce_beta_signup`) authorizes a signup iff the email
 * is on the beta allowlist OR `event.user.user_metadata.invite_code` is a
 * live code. The /join route had the code in hand and never put it in the
 * metadata, so every invite-code signup was rejected 403 by a hook that was
 * doing exactly what it was told. A pure function is something a test can
 * pin; an inline object literal inside a React context is not.
 *
 * Client-supplied metadata is not a bypass. The hook decides against the
 * invite_codes table, so a forged or invented code fails the predicate the
 * same as no code at all.
 */
export interface SignUpOptions {
  emailRedirectTo: string;
  captchaToken?: string;
  data?: { invite_code: string };
}

export function buildSignUpOptions(args: {
  emailRedirectTo: string;
  captchaToken: string | null;
  inviteCode?: string | null;
}): SignUpOptions {
  return {
    emailRedirectTo: args.emailRedirectTo,
    // Omit rather than send null. Supabase treats a present `captchaToken`
    // as an attempt to satisfy the captcha; a null one fails the attempt
    // instead of skipping it.
    ...(args.captchaToken ? { captchaToken: args.captchaToken } : {}),
    // Same reasoning, sharper consequence: an empty-string code would reach
    // the hook as a non-null value and read as an attempted redemption of ""
    // rather than as "no code was offered", which is the difference between
    // the allowlist branch running and not running.
    ...(args.inviteCode ? { data: { invite_code: args.inviteCode } } : {}),
  };
}
