-- 1. OrangeRails enum rename (idempotent)
do $$
begin
  if exists (
    select 1 from pg_type t
    join pg_enum e on t.oid = e.enumtypid
    where t.typname = 'connector_type'
      and e.enumlabel = 'bitcoin_connector'
  ) then
    alter type public.connector_type rename value 'bitcoin_connector' to 'orange_rails';
  end if;
end
$$;

-- category_type enum
do $$
begin
  if not exists (select 1 from pg_type where typname = 'category_type') then
    create type public.category_type as enum ('income', 'expense', 'transfer');
  end if;
end
$$;

-- Drop legacy text-based check constraint (was blocking enum conversion)
alter table public.categories drop constraint if exists categories_type_check;

-- categories.type: convert text column to enum if needed
do $$
declare
  current_type text;
begin
  select data_type into current_type
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'categories'
    and column_name = 'type';

  if current_type = 'text' then
    execute 'alter table public.categories alter column "type" drop default';
    execute 'alter table public.categories alter column "type" set data type public.category_type using ("type"::public.category_type)';
    execute 'alter table public.categories alter column "type" set default ''expense''::public.category_type';
  elsif current_type is null then
    execute 'alter table public.categories add column "type" public.category_type not null default ''expense''';
  end if;
end
$$;

alter table public.transactions
  add column if not exists is_manual_category boolean not null default false;

-- rules table
create table if not exists public.rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  household_id uuid,
  enc_name text not null,
  enc_conditions text not null,
  enc_actions text not null,
  match_mode text not null default 'all',
  is_enabled boolean not null default true,
  sort_order int not null default 0,
  last_fired_at timestamptz,
  fire_count int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_rules_user_order on public.rules(user_id, sort_order);

alter table public.rules enable row level security;

drop policy if exists "own rules" on public.rules;
DROP POLICY IF EXISTS "own rules" ON public.rules;
create policy "own rules" on public.rules for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop trigger if exists trg_rules_updated_at on public.rules;
DROP TRIGGER IF EXISTS trg_rules_updated_at ON public.rules;
create trigger trg_rules_updated_at
  before update on public.rules
  for each row execute function public.set_updated_at();