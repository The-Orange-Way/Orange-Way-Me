-- or_connection_key_namespace: record which key namespace a connection was
-- established under, instead of inferring it (OWM-T0467, parent OWM-T0414).
--
-- Purpose: a connection's stealth wallet envelope is sealed by the OrangeRails
-- connect widget with the key it was handed at connect time. More than one key
-- namespace can be in use over the life of the product, so every read path has
-- to know which namespace a given connection belongs to. This table records it
-- at the moment the connection is established, rather than leaving it to be
-- guessed later.
--
-- AN ABSENT ROW MEANS LEGACY, and that default is load-bearing. A connection
-- whose namespace is unknown must be read as the older namespace. Legacy is
-- therefore the absence of a row and never a value, which is why the namespace
-- CHECK admits exactly one string: there is no way for a later caller to write
-- a "legacy" value, and no way to express "assume the newer namespace by
-- default". Adding a future namespace is a new migration that appends to the
-- CHECK.
--
-- Read and write model: this is per user data under RLS. Owner only SELECT and
-- owner only INSERT. There is deliberately NO update and NO delete, neither
-- policy nor grant. A row that can be changed or removed is a row that can
-- silently downgrade a live connection to legacy and make its data unopenable.
-- Account deletion still cleans up, through the user_id foreign key cascade.
--
-- connection_id is text, not uuid, on purpose. If an id is ever issued that
-- does not parse as a uuid, a uuid column makes the INSERT throw, the row is
-- absent, and an absent row means legacy: a format mismatch would silently
-- downgrade a connection that really was established under the newer
-- namespace, which is the exact ambiguity this table exists to remove. This
-- follows public.stealth_sync_runs, which already uses text for the same
-- column. The divergence with the older public.connection_account_map, which
-- declares or_connection_id as uuid, is known and stated here rather than
-- hidden.
--
-- The primary key is (user_id, connection_id) rather than a surrogate id: one
-- connection is in exactly one namespace, and the composite key makes a second
-- contradictory row impossible rather than merely unlikely. No further index is
-- needed, because every read is by (user_id, connection_id) or by user_id
-- alone, and the composite key serves both as a prefix.
--
-- Privacy: no wallet identifying field of any kind. No address, no txid, no
-- amount. The row is a user id, an opaque connection id, a namespace label and
-- a timestamp.
--
-- Idempotent: create table if not exists, and the policies are guarded with a
-- NOT EXISTS check because CREATE POLICY has no IF NOT EXISTS and a bare create
-- errors 42710 when replayed against a database that already carries it.

create table if not exists public.or_connection_key_namespace (
  user_id        uuid        not null references auth.users(id) on delete cascade,
  connection_id  text        not null,
  namespace      text        not null check (namespace in ('orangerails-stealth-widget-v1')),
  established_at timestamptz not null default now(),
  primary key (user_id, connection_id)
);

alter table public.or_connection_key_namespace enable row level security;

-- Supabase grants table privileges to anon and authenticated by default, via
-- ALTER DEFAULT PRIVILEGES on the public schema. Revoke first so that the grant
-- below is the whole of the client surface: SELECT and INSERT for a signed in
-- user, and nothing at all for anon. Without this revoke, a new table inherits
-- UPDATE and DELETE, which the write model above explicitly refuses.
revoke all on public.or_connection_key_namespace from anon;
revoke all on public.or_connection_key_namespace from authenticated;
grant select, insert on public.or_connection_key_namespace to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'or_connection_key_namespace'
      and policyname = 'or_ckn_select_own'
  ) then
    create policy or_ckn_select_own
      on public.or_connection_key_namespace for select
      to authenticated
      using (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'or_connection_key_namespace'
      and policyname = 'or_ckn_insert_own'
  ) then
    create policy or_ckn_insert_own
      on public.or_connection_key_namespace for insert
      to authenticated
      with check (auth.uid() = user_id);
  end if;
end $$;

-- No update or delete policy is defined on purpose. With RLS enabled and no
-- UPDATE or DELETE grant, every client attempt to change or remove a row is
-- denied twice over.
