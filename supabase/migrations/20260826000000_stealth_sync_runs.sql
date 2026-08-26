-- stealth_sync_runs — a durable record of one client stealth sync execution
-- (DL-1447). A stealth connection is scanned by the OR Connect widget inside
-- this browser and the results are read back and imported here; neither step
-- has ever left a trace an operator or QA can query. This table is that
-- trace: one row per attempt, success or failure.
--
-- ZKA constraint: this table stores counts and status only. No address, no
-- txid, no label, no key material, nothing that identifies which wallet or
-- which transaction. A row proves a sync ran and what it did in aggregate,
-- never what it moved.
--
-- Written directly by the signed-in user's browser (RLS-scoped insert), not
-- by a service-role edge function. That is why this is a new table rather
-- than a second producer writing into sync_events: sync_events has no
-- client-side write path by design (see its own migration), and giving it
-- one to carry an unrelated shape would make that table mean two things.

create table if not exists public.stealth_sync_runs (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  -- Opaque connection id from the stealth store. Not a foreign key: stealth
  -- connections do not live in public.connections (see ConnectionsPage.tsx
  -- handleSync comments), so there is nothing local to reference.
  connection_id   text not null,
  started_at      timestamptz not null,
  finished_at     timestamptz not null,
  status          text not null check (status in ('success', 'error')),
  rows_attempted  int not null default 0,
  rows_written    int not null default 0,
  error_code      text,
  created_at      timestamptz not null default now()
);

create index if not exists idx_stealth_sync_runs_user_created
  on public.stealth_sync_runs (user_id, created_at desc);

create index if not exists idx_stealth_sync_runs_connection
  on public.stealth_sync_runs (connection_id, created_at desc);

alter table public.stealth_sync_runs enable row level security;

-- The signed-in user writes their own run records directly from the
-- browser, right after a scan or an import finishes.
create policy "users insert own stealth_sync_runs"
  on public.stealth_sync_runs for insert
  with check (user_id = auth.uid());

create policy "users read own stealth_sync_runs"
  on public.stealth_sync_runs for select
  using (user_id = auth.uid());

-- Append-only: no update, no delete policy. A run record is a fact about
-- what happened, not a mutable status line.
