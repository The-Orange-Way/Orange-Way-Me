-- OW-E0007 step 8 (OW-C1121): a narrow, read-only door for the production import monitor.
--
-- The monitor needs one fact: how many whole hours ago the newest imported
-- transaction row was created. It must not hold the service role key, so this
-- function answers that one question to the public (anon) key and nothing else.
-- It returns a single integer, or NULL when no imported row exists. No row
-- data, user id or amount leaves it.
--
-- Rollback: DROP FUNCTION public.import_age_hours().
-- The index is harmless to leave. DROP INDEX public.idx_transactions_external_created_at removes it.

create index if not exists idx_transactions_external_created_at
  on public.transactions (created_at desc)
  where external_source is not null;

create or replace function public.import_age_hours()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select floor(extract(epoch from (now() - max(t.created_at))) / 3600)::integer
    from public.transactions t
   where t.external_source is not null
$$;

revoke all on function public.import_age_hours() from public, anon, authenticated, service_role;
grant execute on function public.import_age_hours() to anon;
