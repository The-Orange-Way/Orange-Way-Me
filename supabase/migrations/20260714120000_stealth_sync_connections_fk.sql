-- Stealth Sync: create connections FK parent, align types, bind tenant-isolation
-- FKs on sync_events and connection_account_map.
--
-- Why: sync_events.or_connection_id is text; connection_account_map.or_connection_id
-- is uuid. A composite FK needs matching types. Both tables have 0 rows on dev so
-- the cast is free now; the window closes the moment ingest runs.
--
-- The connections table (uuid PK + composite unique on (id, user_id)) is the FK
-- parent that prevents an or_connection_id from being claimed under a second user.
-- service_role bypasses RLS by construction (rolbypassrls=true in pg_roles),
-- so this FK is the ONLY structural tenant-isolation guard for ingest rows.
--
-- Precondition: DBA re-verifies before applying:
--   select count(*) from public.sync_events;              -- must be 0
--   select count(*) from public.connection_account_map;   -- must be 0
-- If either is non-zero, stop. Resolve backfill or truncate first.
--
-- Rollback (apply in reverse order):
--   alter table public.connection_account_map
--     drop constraint if exists fk_cam_connection;
--   drop index if exists idx_sync_events_user_connection;
--   comment on column public.sync_events.user_id is null;
--   alter table public.sync_events
--     drop constraint if exists fk_sync_events_connection;
--   drop index if exists ux_sync_events_connection_event;
--   -- or_event_id: drop not-null only if no rows exist
--   alter table public.sync_events
--     alter column or_event_id drop not null;
--   -- restore global unique
--   create unique index if not exists ux_sync_events_or_event_id
--     on public.sync_events (or_event_id);
--   -- or_connection_id: restore as text only if no rows exist
--   alter table public.sync_events
--     alter column or_connection_id type text using or_connection_id::text;
--   drop policy if exists "own connections delete" on public.connections;
--   drop policy if exists "own connections insert" on public.connections;
--   drop policy if exists "own connections select" on public.connections;
--   drop table if exists public.connections;

-- ============================================================
-- 1. connections table
--    id:   OR-assigned connection_id, stored as uuid (matches
--          connection_account_map.or_connection_id which is already uuid).
--    unique(id, user_id): required so child tables can use a composite FK
--    referencing both columns, preventing cross-user connection_id claims.
-- ============================================================
create table if not exists public.connections (
  id         uuid        not null,
  user_id    uuid        not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint pk_connections primary key (id),
  constraint uq_connections_id_user unique (id, user_id)
);

alter table public.connections enable row level security;

drop policy if exists "own connections select" on public.connections;
create policy "own connections select" on public.connections
  for select using (user_id = auth.uid());

drop policy if exists "own connections insert" on public.connections;
create policy "own connections insert" on public.connections
  for insert with check (user_id = auth.uid());

drop policy if exists "own connections delete" on public.connections;
create policy "own connections delete" on public.connections
  for delete using (user_id = auth.uid());

-- No update policy: rows are written once on OR_STEALTH_ADD_COMPLETE and
-- deleted on disconnect. The FK ON UPDATE RESTRICT on child tables also blocks
-- re-parenting from the parent side.

-- ============================================================
-- 2. align sync_events.or_connection_id from text to uuid
--    Guard: only runs if the column is still text. Cast is valid while
--    the column holds no rows (see precondition).
-- ============================================================
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name   = 'sync_events'
      and column_name  = 'or_connection_id'
      and data_type    = 'text'
  ) then
    alter table public.sync_events
      alter column or_connection_id type uuid using or_connection_id::uuid;
  end if;
end $$;

-- ============================================================
-- 3. sync_events: tighten or_event_id
--    Drop the global unique (ux_sync_events_or_event_id): or_event_ids are
--    connection-scoped by the widget, so a global unique allows cross-connection
--    replay and causes legitimate retries on a different connection to fail.
--    Set NOT NULL (safe: 0 rows). Add scoped unique (or_connection_id, or_event_id).
-- ============================================================
drop index if exists public.ux_sync_events_or_event_id;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name   = 'sync_events'
      and column_name  = 'or_event_id'
      and is_nullable  = 'YES'
  ) then
    alter table public.sync_events
      alter column or_event_id set not null;
  end if;
end $$;

create unique index if not exists ux_sync_events_connection_event
  on public.sync_events (or_connection_id, or_event_id);

-- ============================================================
-- 4. composite FK: sync_events -> connections
--    ON DELETE CASCADE: sync events die with the connection, consistent with
--    the existing ON DELETE CASCADE to auth.users on this table.
--    ON UPDATE RESTRICT: prevents re-parenting a connection under another user
--    by updating the key columns.
-- ============================================================
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname  = 'fk_sync_events_connection'
      and conrelid = 'public.sync_events'::regclass
  ) then
    alter table public.sync_events
      add constraint fk_sync_events_connection
      foreign key (or_connection_id, user_id)
      references public.connections (id, user_id)
      on delete cascade
      on update restrict;
  end if;
end $$;

-- IMPORTANT: sync_events.user_id must remain NOT NULL.
-- This FK uses MATCH SIMPLE semantics (Postgres default). If user_id were ever
-- made nullable, a NULL would cause the FK check to be skipped silently, removing
-- tenant-isolation. service_role bypasses RLS so this FK is the only structural
-- guard for ingest writes. See comment below (statement 6).

-- ============================================================
-- 5. index on sync_events (user_id, or_connection_id)
--    sync_events has only a pkey today. An unindexed FK child turns every
--    ON DELETE CASCADE into a sequential scan of the whole table.
-- ============================================================
create index if not exists idx_sync_events_user_connection
  on public.sync_events (user_id, or_connection_id);

-- ============================================================
-- 6. composite FK: connection_account_map -> connections
--    connection_account_map carries (user_id, or_connection_id) with no FK
--    anchor: the same cross-tenant claim hole as sync_events. Its existing
--    unique index leads with (user_id, or_connection_id) so no extra index
--    is needed for the cascade path.
-- ============================================================
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname  = 'fk_cam_connection'
      and conrelid = 'public.connection_account_map'::regclass
  ) then
    alter table public.connection_account_map
      add constraint fk_cam_connection
      foreign key (or_connection_id, user_id)
      references public.connections (id, user_id)
      on delete cascade
      on update restrict;
  end if;
end $$;

-- ============================================================
-- Column comment: sync_events.user_id must stay NOT NULL
--    MATCH SIMPLE FK silently stops enforcing tenancy if either column in
--    the composite key is NULL. user_id nullable = tenant-isolation hole.
--    service_role bypasses RLS so this FK is the only structural guard.
--    Never relax user_id to nullable on this table.
-- ============================================================
comment on column public.sync_events.user_id is
  'TENANT KEY: must remain NOT NULL. The FK fk_sync_events_connection uses '
  'MATCH SIMPLE semantics (Postgres default); a NULL here silently exempts '
  'the row from tenant-isolation checking. service_role bypasses RLS so this '
  'FK is the only structural guard for ingest writes. Never relax to nullable.';
