-- sync_events — an append-only log of "sync.completed" notifications
-- pushed by OrangeRails to Orange Way via the or-webhook-receiver edge
-- function. The Connections UI (phase 2) subscribes via Supabase realtime
-- to refresh itself when a new row arrives for the active user.
--
-- We do NOT mirror the OR connections list here — OR remains source of
-- truth (`bb-or-proxy` → `or-connection-list`). This table just records
-- the event so Orange Way can react without polling.
--
-- Tenancy note: Orange Way is per-user (no orgs concept — vault is per
-- Supabase auth user, OR subaccount = one per user). So events key on
-- user_id, not org_id. Compare V3's sync_events which keys on org_id.

create table if not exists public.sync_events (
  id              bigserial primary key,
  -- The user the event belongs to. We resolve user_id from subaccount_id
  -- inside the receiver via the user_profiles.or_subaccount_id mapping
  -- maintained by bb-or-proxy at or-provision time. Filtering RLS by
  -- user_id is what gives the realtime channel its per-tenant isolation.
  user_id          uuid not null references auth.users(id) on delete cascade,
  -- OR's connection_id (opaque to Orange Way; we keep it for correlation).
  or_connection_id text not null,
  -- Number of new transactions OR reported in this sync.
  synced_count    int not null default 0,
  -- When OR observed the sync completing (carried in the payload).
  or_ts           timestamptz not null,
  -- When Orange Way received + verified the webhook.
  received_at     timestamptz not null default now()
);

create index if not exists idx_sync_events_user_received
  on public.sync_events (user_id, received_at desc);

alter table public.sync_events enable row level security;

-- Users can read their own events. Writes happen only through the
-- service-role client inside the receiver edge function; no client-side
-- write path is needed.
create policy "users read own sync_events"
  on public.sync_events for select
  using (user_id = auth.uid());

-- Enable realtime publication so the Connections page can subscribe
-- to INSERT events filtered by user_id.
alter publication supabase_realtime add table public.sync_events;
