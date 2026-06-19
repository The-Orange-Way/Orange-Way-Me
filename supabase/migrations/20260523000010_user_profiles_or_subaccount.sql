-- user_profiles.or_subaccount_id — the OrangeRails subaccount this user
-- maps to. Today this mapping lives only in browser localStorage (key
-- `or_subaccount_id_for_user_<user.id>`). The or-webhook-receiver edge
-- function needs server-side lookup to translate an inbound
-- `sync.completed` event's subaccount_id back into a user_id without a
-- user JWT in the loop.
--
-- Tenancy note: Orange Way is per-user — there is no org table. The
-- equivalent mapping in V3 lives on `organizations.or_subaccount_id`.
--
-- Backfill: ow-or-proxy upserts this column on every successful
-- or-provision response (idempotent — subaccount_id is stable per user).
-- Existing users get backfilled the next time they visit a page that
-- runs or-provision (Connections, Dashboard with an OR sync, etc.).
-- For users that never visit before their first sync, the receiver
-- returns 202 (accepted, no action) so OR's dispatcher stops retrying.

alter table public.user_profiles
  add column if not exists or_subaccount_id text;

create unique index if not exists idx_user_profiles_or_subaccount
  on public.user_profiles (or_subaccount_id)
  where or_subaccount_id is not null;
