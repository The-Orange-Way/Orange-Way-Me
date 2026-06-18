
-- connector_type enum
create type public.connector_type as enum ('manual', 'csv', 'xpub', 'simplefin', 'bitcoin_connector');

-- shared updated_at trigger function
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- accounts
create table IF NOT EXISTS public.accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  household_id uuid,
  connector_type public.connector_type not null default 'manual',
  enc_name text not null,
  enc_type text not null,
  enc_currency text not null,
  enc_institution text,
  enc_balance text not null,
  enc_metadata text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index IF NOT EXISTS idx_accounts_user on public.accounts(user_id);
DROP TRIGGER IF EXISTS trg_accounts_updated_at ON public.accounts;
create trigger trg_accounts_updated_at before update on public.accounts
  for each row execute function public.set_updated_at();

-- transactions
create table IF NOT EXISTS public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  household_id uuid,
  date date not null,
  enc_amount text not null,
  enc_description text not null,
  enc_merchant text,
  enc_category_id text,
  enc_memo text,
  enc_tags text,
  enc_owner text,
  hmac_merchant text,
  hmac_category text,
  is_split_parent boolean not null default false,
  split_parent_id uuid references public.transactions(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index IF NOT EXISTS idx_transactions_user_date on public.transactions(user_id, date desc);
create index IF NOT EXISTS idx_transactions_account on public.transactions(account_id, date desc);
create index IF NOT EXISTS idx_transactions_hmac_merchant on public.transactions(hmac_merchant);
create index IF NOT EXISTS idx_transactions_hmac_category on public.transactions(hmac_category);
DROP TRIGGER IF EXISTS trg_transactions_updated_at ON public.transactions;
create trigger trg_transactions_updated_at before update on public.transactions
  for each row execute function public.set_updated_at();

-- categories
create table IF NOT EXISTS public.categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  household_id uuid,
  enc_name text not null,
  enc_icon text,
  enc_color text,
  enc_parent_id text,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
create index IF NOT EXISTS idx_categories_user on public.categories(user_id);

-- budgets
create table IF NOT EXISTS public.budgets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  household_id uuid,
  month date not null,
  enc_mode text not null,
  enc_data text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index IF NOT EXISTS idx_budgets_user_month on public.budgets(user_id, month desc);
DROP TRIGGER IF EXISTS trg_budgets_updated_at ON public.budgets;
create trigger trg_budgets_updated_at before update on public.budgets
  for each row execute function public.set_updated_at();

-- goals
create table IF NOT EXISTS public.goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  household_id uuid,
  enc_name text not null,
  enc_type text not null,
  enc_target_amount text not null,
  enc_current_amount text not null,
  enc_target_date text,
  enc_strategy text,
  enc_linked_account_ids text,
  is_completed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index IF NOT EXISTS idx_goals_user on public.goals(user_id);
DROP TRIGGER IF EXISTS trg_goals_updated_at ON public.goals;
create trigger trg_goals_updated_at before update on public.goals
  for each row execute function public.set_updated_at();

-- connector_credentials
create table IF NOT EXISTS public.connector_credentials (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid references public.accounts(id) on delete cascade,
  connector_type public.connector_type not null,
  enc_credentials text not null,
  created_at timestamptz not null default now()
);
create index IF NOT EXISTS idx_connector_credentials_user on public.connector_credentials(user_id);

-- vault_metadata
create table IF NOT EXISTS public.vault_metadata (
  user_id uuid primary key references auth.users(id) on delete cascade,
  kdf_salt text not null,
  kdf_iterations int not null default 600000,
  verifier_ciphertext text not null,
  recovery_ciphertext text,
  hmac_salt text not null,
  created_at timestamptz not null default now()
);

-- RLS
alter table public.accounts enable row level security;
alter table public.transactions enable row level security;
alter table public.categories enable row level security;
alter table public.budgets enable row level security;
alter table public.goals enable row level security;
alter table public.connector_credentials enable row level security;
alter table public.vault_metadata enable row level security;

DROP POLICY IF EXISTS "own accounts select" ON public.accounts;
create policy "own accounts select" on public.accounts for select using (user_id = auth.uid());
DROP POLICY IF EXISTS "own accounts insert" ON public.accounts;
create policy "own accounts insert" on public.accounts for insert with check (user_id = auth.uid());
DROP POLICY IF EXISTS "own accounts update" ON public.accounts;
create policy "own accounts update" on public.accounts for update using (user_id = auth.uid()) with check (user_id = auth.uid());
DROP POLICY IF EXISTS "own accounts delete" ON public.accounts;
create policy "own accounts delete" on public.accounts for delete using (user_id = auth.uid());

DROP POLICY IF EXISTS "own transactions select" ON public.transactions;
create policy "own transactions select" on public.transactions for select using (user_id = auth.uid());
DROP POLICY IF EXISTS "own transactions insert" ON public.transactions;
create policy "own transactions insert" on public.transactions for insert with check (user_id = auth.uid());
DROP POLICY IF EXISTS "own transactions update" ON public.transactions;
create policy "own transactions update" on public.transactions for update using (user_id = auth.uid()) with check (user_id = auth.uid());
DROP POLICY IF EXISTS "own transactions delete" ON public.transactions;
create policy "own transactions delete" on public.transactions for delete using (user_id = auth.uid());

DROP POLICY IF EXISTS "own categories select" ON public.categories;
create policy "own categories select" on public.categories for select using (user_id = auth.uid());
DROP POLICY IF EXISTS "own categories insert" ON public.categories;
create policy "own categories insert" on public.categories for insert with check (user_id = auth.uid());
DROP POLICY IF EXISTS "own categories update" ON public.categories;
create policy "own categories update" on public.categories for update using (user_id = auth.uid()) with check (user_id = auth.uid());
DROP POLICY IF EXISTS "own categories delete" ON public.categories;
create policy "own categories delete" on public.categories for delete using (user_id = auth.uid());

DROP POLICY IF EXISTS "own budgets select" ON public.budgets;
create policy "own budgets select" on public.budgets for select using (user_id = auth.uid());
DROP POLICY IF EXISTS "own budgets insert" ON public.budgets;
create policy "own budgets insert" on public.budgets for insert with check (user_id = auth.uid());
DROP POLICY IF EXISTS "own budgets update" ON public.budgets;
create policy "own budgets update" on public.budgets for update using (user_id = auth.uid()) with check (user_id = auth.uid());
DROP POLICY IF EXISTS "own budgets delete" ON public.budgets;
create policy "own budgets delete" on public.budgets for delete using (user_id = auth.uid());

DROP POLICY IF EXISTS "own goals select" ON public.goals;
create policy "own goals select" on public.goals for select using (user_id = auth.uid());
DROP POLICY IF EXISTS "own goals insert" ON public.goals;
create policy "own goals insert" on public.goals for insert with check (user_id = auth.uid());
DROP POLICY IF EXISTS "own goals update" ON public.goals;
create policy "own goals update" on public.goals for update using (user_id = auth.uid()) with check (user_id = auth.uid());
DROP POLICY IF EXISTS "own goals delete" ON public.goals;
create policy "own goals delete" on public.goals for delete using (user_id = auth.uid());

DROP POLICY IF EXISTS "own credentials select" ON public.connector_credentials;
create policy "own credentials select" on public.connector_credentials for select using (user_id = auth.uid());
DROP POLICY IF EXISTS "own credentials insert" ON public.connector_credentials;
create policy "own credentials insert" on public.connector_credentials for insert with check (user_id = auth.uid());
DROP POLICY IF EXISTS "own credentials update" ON public.connector_credentials;
create policy "own credentials update" on public.connector_credentials for update using (user_id = auth.uid()) with check (user_id = auth.uid());
DROP POLICY IF EXISTS "own credentials delete" ON public.connector_credentials;
create policy "own credentials delete" on public.connector_credentials for delete using (user_id = auth.uid());

DROP POLICY IF EXISTS "own vault select" ON public.vault_metadata;
create policy "own vault select" on public.vault_metadata for select using (user_id = auth.uid());
DROP POLICY IF EXISTS "own vault insert" ON public.vault_metadata;
create policy "own vault insert" on public.vault_metadata for insert with check (user_id = auth.uid());
DROP POLICY IF EXISTS "own vault update" ON public.vault_metadata;
create policy "own vault update" on public.vault_metadata for update using (user_id = auth.uid()) with check (user_id = auth.uid());
DROP POLICY IF EXISTS "own vault delete" ON public.vault_metadata;
create policy "own vault delete" on public.vault_metadata for delete using (user_id = auth.uid());
