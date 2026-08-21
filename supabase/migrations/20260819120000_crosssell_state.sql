-- crosssell_state, one row per user, backing the Orange Way Me to Children's Books
-- cross-sell email (DL-0886). It records that a user has been queued for
-- the cross-sell send and whether they have opted out.
--
-- Send-once: the primary key on user_id makes a second insert for the same
-- user raise unique_violation (SQLSTATE 23505). The crosssell Function
-- catches 23505 and treats it as "already queued, send nothing", so the
-- Resend send fires only on a fresh insert. A duplicate is swallowed
-- silently, never surfaced as an error.
--
-- Opt-out: opted_out lets the in-app privacy control suppress the email.
--
-- ZKA note: this table holds only a user id, an opt-out flag, and a send
-- timestamp. It never stores keys, seed, or plaintext, so there is no
-- zero-knowledge surface here.
--
-- Reversal: additive only. DROP TABLE public.crosssell_state reverses it.

create table if not exists public.crosssell_state (
  -- The user this cross-sell state belongs to. PRIMARY KEY makes it NOT
  -- NULL and UNIQUE, which is what backs send-once dedup in the Function.
  user_id    uuid primary key references auth.users(id) on delete cascade,
  -- Whether the user has opted out of the cross-sell email.
  opted_out  boolean not null default false,
  -- When the cross-sell email was sent (null until the send fires).
  sent_at    timestamptz
);

alter table public.crosssell_state enable row level security;

-- Users can read their own cross-sell state.
drop policy if exists "users read own crosssell_state" on public.crosssell_state;
create policy "users read own crosssell_state"
  on public.crosssell_state for select
  using (user_id = auth.uid());

-- Users can update their own row to set opted_out from the in-app control.
-- Inserts happen only through the service-role client inside the crosssell
-- Function; no client-side insert path is needed.
drop policy if exists "users update own crosssell_state" on public.crosssell_state;
create policy "users update own crosssell_state"
  on public.crosssell_state for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
