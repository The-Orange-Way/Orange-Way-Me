-- ============================================================
-- Quiltt session cache + per-account provider slug
-- ============================================================
-- Two small additions in support of the OR → Quiltt bank-connect flow:
--
--   1. user_profiles.quiltt_session_token + quiltt_session_expires_at
--      Cache the Quiltt session bundle issued by OR's
--      or-quiltt-session-via-widget. Reusing it across popup opens
--      saves Quiltt rate-limit quota (10 mints/hr, 20/day per Profile,
--      per Quiltt support recommendation). Reuse if the cached row
--      has >1hr until expiry.
--
--      ZKA note: the session token is opaque to Orange Way — issued by
--      Quiltt to OR, relayed through OR back to the browser. Holds
--      no user secret; cannot be exchanged for bank credentials
--      (those stay at Quiltt). Plaintext server-side storage is fine.
--
--   2. accounts.provider_slug
--      Plaintext label of the OR provider that owns this account
--      (blink, strike, quiltt, sparrow, …). NULL for manual / csv /
--      xpub accounts. Used by Sync All to skip the vault-password
--      prompt for providers that don't need it (e.g. Quiltt — bank
--      credentials live at Quiltt, not under the OR vault).
--
--      ZKA note: provider identity is not user-sensitive. Knowing
--      "this account was connected via Quiltt" tells the server
--      nothing about which bank or what's inside it; the institution
--      name + balance + mask still live encrypted in enc_* columns.

alter table public.user_profiles
  add column if not exists quiltt_session_token text,
  add column if not exists quiltt_session_expires_at timestamptz;

comment on column public.user_profiles.quiltt_session_token is
  'Cached Quiltt session bundle issued by OR. Reused across popup '
  'opens to stay under Quiltt rate limit. Opaque to Orange Way — relayed '
  'through OR. Plaintext OK: not a user secret, no path to bank '
  'credentials. Refresh policy: miss if expires within 1hr.';

comment on column public.user_profiles.quiltt_session_expires_at is
  'Expiry of the cached Quiltt session token. owm-or-quick-connect '
  'treats a row with <1hr remaining as a miss and mints fresh.';

alter table public.accounts
  add column if not exists provider_slug text;

create index if not exists idx_accounts_user_provider
  on public.accounts(user_id, provider_slug)
  where provider_slug is not null;

comment on column public.accounts.provider_slug is
  'OR provider slug (blink / strike / quiltt / sparrow / …). '
  'Plaintext — provider identity is not user-sensitive. NULL for '
  'manual / csv / xpub accounts. Used by Sync All to know which '
  'providers can sync without the vault password.';
