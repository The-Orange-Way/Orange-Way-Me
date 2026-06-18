-- Prompt 05: Categories + Rules engine
--
-- Adds:
--   1. category_type enum + type column on categories (income/expense/transfer)
--   2. is_manual_category flag on transactions (manual edits beat rules)
--   3. rules table (encrypted conditions + actions, per-user RLS)

-- 1. category_type enum + categories.type
do $$
begin
  if not exists (select 1 from pg_type where typname = 'category_type') then
    create type public.category_type as enum ('income', 'expense', 'transfer');
  end if;
end
$$;

alter table public.categories
  add column if not exists type public.category_type not null default 'expense';

-- 2. transactions.is_manual_category
alter table public.transactions
  add column if not exists is_manual_category boolean not null default false;

-- 3. rules table
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
create policy "own rules" on public.rules
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop trigger if exists trg_rules_updated_at on public.rules;
DROP TRIGGER IF EXISTS trg_rules_updated_at ON public.rules;
create trigger trg_rules_updated_at
  before update on public.rules
  for each row execute function public.set_updated_at();
