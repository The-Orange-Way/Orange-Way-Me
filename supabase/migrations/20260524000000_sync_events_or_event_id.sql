-- Add or_event_id to sync_events for idempotent webhook receiver
--
-- The OR webhooks SDK provides event.id (UUID) which is stable across
-- retries. By storing it with a unique constraint and using INSERT ...
-- ON CONFLICT DO NOTHING in the receiver, we collapse retry storms into
-- a single row per logical event — even if OR's dispatcher delivers the
-- same event multiple times due to network hiccups, timeouts, or a
-- consumer that took > 5s to respond.
--
-- Nullable + retroactive: existing rows pre-dedupe have NULL or_event_id.
-- New rows from the receiver MUST set it.
--
-- The unique index is partial (only enforces uniqueness when not null) so
-- the migration is safe to apply over existing data.

alter table public.sync_events
  add column if not exists or_event_id text;

create unique index if not exists ux_sync_events_or_event_id
  on public.sync_events (or_event_id)
  where or_event_id is not null;
