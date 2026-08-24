-- referral_codes, one row per opaque referral code (DL-1432). It backs the
-- tester referral link: a tester generates a code, shares a link carrying it,
-- and we count how many times that link is redeemed.
--
-- ZKA note: this table stores an opaque code, the referrer's own user id, and a
-- redemption count. The owner_id is the referrer's OWN identity, which they must
-- have to read their own count under RLS. It is NOT a referral graph. Crucially,
-- a redemption NEVER records who redeemed the code: the redeem-referral Function
-- only increments redemption_count, so the server never learns who referred
-- whom. No keys, seed, or plaintext live here. The counter is therefore a soft
-- signal, not a fraud-hardened metric, and that is the deliberate tradeoff that
-- keeps referral tracking inside the zero-knowledge boundary.
--
-- Access model: the owner can read and create their own codes under RLS. There
-- is no client update or delete policy. The redemption increment happens only
-- through the service-role client inside the redeem-referral Function, which
-- bypasses RLS. A redeemer can neither read the row nor learn the owner.
--
-- Reversal: additive only. DROP TABLE public.referral_codes reverses it.
--
-- Re-runnable: this file may run against a database where the table, trigger,
-- and policies already exist. "create table if not exists" and "enable row
-- level security" are safe to repeat. Postgres has no CREATE POLICY IF NOT
-- EXISTS, so each policy is dropped if present immediately before it is created.
-- The trigger is dropped-then-created the same way. All statements run in one
-- migration transaction, so the table is never readable without its policy.

create table if not exists public.referral_codes (
  -- The opaque, unguessable referral code. PRIMARY KEY makes it NOT NULL and
  -- UNIQUE. It carries no PII: the client generates it from a CSPRNG.
  code             text primary key,
  -- The referrer who owns this code. Their OWN id, so they can read their own
  -- count under RLS. On account deletion the code goes with them.
  owner_id         uuid not null references auth.users(id) on delete cascade,
  -- How many times a link carrying this code has been redeemed. Incremented
  -- only by the service-role redeem-referral Function. Never negative.
  redemption_count integer not null default 0 check (redemption_count >= 0),
  -- When the code was created.
  created_at       timestamptz not null default now()
);

-- List-a-user's-codes lookup.
create index if not exists referral_codes_owner_id_idx
  on public.referral_codes (owner_id);

-- Force redemption_count to 0 on insert so a client cannot seed its own count
-- through the RLS insert path. The service-role increment path is unaffected
-- because it UPDATEs, never INSERTs.
create or replace function public.referral_codes_zero_count()
returns trigger
language plpgsql
as $$
begin
  new.redemption_count := 0;
  return new;
end;
$$;

drop trigger if exists referral_codes_zero_count_trg on public.referral_codes;
create trigger referral_codes_zero_count_trg
  before insert on public.referral_codes
  for each row execute function public.referral_codes_zero_count();

alter table public.referral_codes enable row level security;

-- Owners can read their own codes and their redemption counts.
drop policy if exists "owners read own referral_codes" on public.referral_codes;
create policy "owners read own referral_codes"
  on public.referral_codes for select
  using (owner_id = auth.uid());

-- Owners can create a code they own. The trigger above forces the count to 0.
drop policy if exists "owners create own referral_codes" on public.referral_codes;
create policy "owners create own referral_codes"
  on public.referral_codes for insert
  with check (owner_id = auth.uid());
