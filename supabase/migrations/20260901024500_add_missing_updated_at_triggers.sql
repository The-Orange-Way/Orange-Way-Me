-- app_flags, user_profiles and user_last_seen_household_key_versions all carry
-- an updated_at column with no trigger keeping it current. Found on app_flags
-- by the Auditor during the 2026-09-01 stealth_sync_enabled kill switch
-- incident (OWM-T0477 / OWM-T0481): a production write changed the row and
-- updated_at stayed at its 2026-08-22 value. The other two tables were found
-- by checking every information_schema.columns row named updated_at against
-- information_schema.triggers, rather than fixing app_flags in isolation.
--
-- Every other table in the schema that carries updated_at already has this
-- trigger (accounts, budgets, connection_account_map, goals, rules,
-- transactions), using the existing public.set_updated_at() function. This
-- migration only attaches the same, already-reviewed trigger to the three
-- tables missing it. It does not touch any row's current value: a backfill
-- would fabricate evidence of a change that did not happen, which is worse
-- than the column being visibly stale.

drop trigger if exists trg_app_flags_updated_at on public.app_flags;
create trigger trg_app_flags_updated_at
  before update on public.app_flags
  for each row execute function public.set_updated_at();

drop trigger if exists trg_user_profiles_updated_at on public.user_profiles;
create trigger trg_user_profiles_updated_at
  before update on public.user_profiles
  for each row execute function public.set_updated_at();

drop trigger if exists trg_user_last_seen_household_key_versions_updated_at
  on public.user_last_seen_household_key_versions;
create trigger trg_user_last_seen_household_key_versions_updated_at
  before update on public.user_last_seen_household_key_versions
  for each row execute function public.set_updated_at();
