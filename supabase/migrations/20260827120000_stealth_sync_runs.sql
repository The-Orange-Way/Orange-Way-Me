-- stealth_sync_runs — a durable, client-authored record of every
-- attempted client stealth sync execution (manual Sync button or the
-- user-initiated retry; both call handleStealthSync in
-- ConnectionsPage.tsx). DL-1447.
--
-- Not a replacement for sync_events: sync_events is written
-- server-side by or-webhook-receiver from OR's "sync.completed"
-- webhook. This table is written client-side by the browser that ran
-- the widget scan, so it also covers runs that never reach OR at all
-- (popup blocked, widget token mint failed) and gives QA and support
-- a row to read instead of inferring success from OR coverage state.
--
-- ZKA: connection_id is opaque text (a stealth connection is not a
-- row in public.connections, so no FK), and the only numeric fields
-- are counts. No plaintext, address, txid, or decrypted label may be
-- written here.

create table if not exists public.stealth_sync_runs (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  connection_id   text not null,
  started_at      timestamptz not null default now(),
  finished_at     timestamptz,
  status          text not null default 'started'
                    check (status in ('started', 'success', 'error')),
  rows_attempted  int,
  rows_written    int,
  -- A short code only, never a message: capped at 32 chars and restricted
  -- to [A-Za-z0-9_], which rules out any address or txid (34+ / 64 chars)
  -- and any human-readable text (spaces, punctuation). Not a fixed value
  -- list because the OR widget's code vocabulary is not ours to freeze.
  error_code      text
                    check (
                      error_code is null
                      or (length(error_code) <= 32 and error_code ~ '^[A-Za-z0-9_]+$')
                    )
);

create index if not exists idx_stealth_sync_runs_user_started
  on public.stealth_sync_runs (user_id, started_at desc);

create index if not exists idx_stealth_sync_runs_connection_started
  on public.stealth_sync_runs (connection_id, started_at desc);

alter table public.stealth_sync_runs enable row level security;

drop policy if exists "users insert own stealth_sync_runs" on public.stealth_sync_runs;
create policy "users insert own stealth_sync_runs"
  on public.stealth_sync_runs for insert
  with check (user_id = auth.uid());

-- The client updates its own "started" row to a terminal status when
-- the widget reports onComplete or onError. Both USING and WITH CHECK
-- are user-scoped so a row can never be moved to another user's id.
drop policy if exists "users update own stealth_sync_runs" on public.stealth_sync_runs;
create policy "users update own stealth_sync_runs"
  on public.stealth_sync_runs for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "users read own stealth_sync_runs" on public.stealth_sync_runs;
create policy "users read own stealth_sync_runs"
  on public.stealth_sync_runs for select
  using (user_id = auth.uid());

comment on table public.stealth_sync_runs is
  'Client-authored durable record of one client stealth sync execution (manual sync or retry). Counts and status only, no wallet-identifying data. DL-1447.';
