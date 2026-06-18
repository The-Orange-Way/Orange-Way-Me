-- Prompt 09 / 10: Household tables, user profiles, and vault MEK column.
-- Also adds auto-lock pref (client-only, no migration needed for that).

-- ============================================================
-- vault_metadata: add enc_mek_ciphertext + enc_hmac_key
-- ============================================================
-- enc_mek_ciphertext: MEK wrapped with password-derived KEK (AES-GCM).
--   Allows changing the vault password without re-encrypting all data.
-- enc_hmac_key: per-user HMAC key encrypted with the MEK.
--   Decouples HMAC key from the vault password so blind indexes stay
--   valid after a password change.
alter table vault_metadata
  add column if not exists enc_mek_ciphertext text,
  add column if not exists enc_hmac_key text;

-- ============================================================
-- households
-- ============================================================
create table if not exists households (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references auth.users(id) on delete cascade,
  enc_name    text not null,
  created_at  timestamptz not null default now()
);
alter table households enable row level security;

DROP POLICY IF EXISTS "households_owner_all" ON households;
create policy "households_owner_all" on households
  using  (owner_id = auth.uid())
  with check (owner_id = auth.uid());

-- ============================================================
-- household_members
-- ============================================================
create table if not exists household_members (
  id             uuid primary key default gen_random_uuid(),
  household_id   uuid not null references households(id) on delete cascade,
  user_id        uuid references auth.users(id) on delete set null,
  email_hash     text,                  -- blind-index of invited email
  enc_email      text,                  -- encrypted email for display
  role           text not null check (role in ('owner','editor','viewer')) default 'viewer',
  status         text not null check (status in ('pending','active','removed')) default 'pending',
  invited_at     timestamptz not null default now(),
  joined_at      timestamptz
);
alter table household_members enable row level security;

DROP POLICY IF EXISTS "household_members_owner_write" ON household_members;
create policy "household_members_owner_write" on household_members
  using (
    household_id in (select id from households where owner_id = auth.uid())
  )
  with check (
    household_id in (select id from households where owner_id = auth.uid())
  );

DROP POLICY IF EXISTS "household_members_own_read" ON household_members;
create policy "household_members_own_read" on household_members
  for select
  using (
    user_id = auth.uid()
    or household_id in (select id from households where owner_id = auth.uid())
  );

-- ============================================================
-- household_invites
-- ============================================================
create table if not exists household_invites (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references households(id) on delete cascade,
  role          text not null check (role in ('editor','viewer')) default 'viewer',
  code          text not null unique default replace(gen_random_uuid()::text, '-', ''),
  expires_at    timestamptz not null default (now() + interval '7 days'),
  used_by       uuid references auth.users(id),
  used_at       timestamptz,
  created_at    timestamptz not null default now()
);
alter table household_invites enable row level security;

DROP POLICY IF EXISTS "household_invites_owner" ON household_invites;
create policy "household_invites_owner" on household_invites
  using  (household_id in (select id from households where owner_id = auth.uid()))
  with check (household_id in (select id from households where owner_id = auth.uid()));

-- Any authenticated user can read an invite to check its code (for accepting).
DROP POLICY IF EXISTS "household_invites_accept_read" ON household_invites;
create policy "household_invites_accept_read" on household_invites
  for select using (auth.uid() is not null);

-- ============================================================
-- user_profiles (display name, avatar)
-- ============================================================
create table if not exists user_profiles (
  user_id          uuid primary key references auth.users(id) on delete cascade,
  enc_display_name text,
  avatar_url       text,
  updated_at       timestamptz not null default now()
);
alter table user_profiles enable row level security;

DROP POLICY IF EXISTS "user_profiles_own" ON user_profiles;
create policy "user_profiles_own" on user_profiles
  using  (user_id = auth.uid())
  with check (user_id = auth.uid());
