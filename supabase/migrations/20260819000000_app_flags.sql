-- app_flags — a tiny server-controlled feature-flag table (DL-1378).
--
-- Purpose: give operations a runtime kill switch for the stealth
-- (private-connection) sync entry without a rebuild + redeploy. Today
-- STEALTH_SYNC_ENABLED is derived from VITE_STEALTH_SYNC_ENABLED at build
-- time, so changing it means shipping a new bundle. The app will read the
-- live value here once at boot instead.
--
-- Read model: flag values are PUBLIC, non-secret runtime config. Any visitor,
-- signed in or not, may read them (the client needs the value before auth to
-- decide whether to show the stealth-sync entry). Hence SELECT is granted to
-- both anon and authenticated. There is no user data in this table.
--
-- Write model: there is NO client write path. RLS is enabled and no
-- insert/update/delete policy exists, so every browser write is denied. Flags
-- are set by us via the service role (which bypasses RLS) out of band. A
-- compromised or malicious client therefore cannot turn a kill switch back on.

create table if not exists public.app_flags (
  key         text primary key,
  enabled     boolean not null default false,
  description text,
  updated_at  timestamptz not null default now()
);

alter table public.app_flags enable row level security;

-- Public read: anyone (anon or authenticated) may read flag values.
create policy "app_flags public read"
  on public.app_flags for select
  to anon, authenticated
  using (true);

-- No insert/update/delete policy is defined on purpose: with RLS enabled that
-- denies every client write. Only the service role can change a flag.

-- Seed the stealth-sync kill switch ON. Prod already runs stealth sync ON via
-- the build-time VITE_STEALTH_SYNC_ENABLED fallback, so once the client reads
-- this row a false seed would be a live feature kill on apply. Seeding true
-- preserves current behavior; operations flips this row to false to go dark
-- with no rebuild. A missing row still folds to false in the client, so this
-- seed is the explicit guard, not the only one.
insert into public.app_flags (key, enabled, description)
values (
  'stealth_sync_enabled',
  true,
  'DL-1378 runtime kill switch for the stealth (private-connection) sync entry. When false, stealth connections do not open the OR widget.'
)
on conflict (key) do nothing;
