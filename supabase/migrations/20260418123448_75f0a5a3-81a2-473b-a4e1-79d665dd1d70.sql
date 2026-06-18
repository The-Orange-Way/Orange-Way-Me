alter table public.goals add column if not exists enc_starting_balance text;
alter table public.goals add column if not exists enc_interest_rate text;
alter table public.goals add column if not exists enc_minimum_payment text;
alter table public.goals add column if not exists enc_manual_allocation text;