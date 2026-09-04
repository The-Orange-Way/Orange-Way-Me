-- Enable pg_cron and schedule the two household housekeeping sweeps.
--
-- Context, so the next reader does not have to reconstruct it:
--
-- Two functions do household housekeeping:
--   public.expire_time_boxed_household_roles()      lapses time boxed household access
--   public.purge_expired_old_household_key_wraps()  removes superseded key wrap rows
--
-- Both were previously "scheduled" by blocks inside
--   20260426000000_phase4_5_household_rekey.sql
--   20260514234456_phase4_4_household_auditor_support_osk.sql
-- which wrapped the schedule creation in a conditional and swallowed every error.
-- On an environment without pg_cron those blocks applied cleanly and created
-- nothing. Both migrations are already recorded as applied, so they will never
-- replay. That is why this has to be a NEW forward migration.
--
-- Deliberate choices in this file, do not "tidy" them away:
--   1. No conditional around the cron.schedule calls.
--   2. No EXCEPTION handler anywhere. If this cannot do the work, it fails.
--   3. IF NOT EXISTS on the extension only. That guard cannot hide an
--      unavailable extension (create extension still errors when the extension
--      is not available on the instance); it only makes an already installed
--      extension a no-op, which is required because one environment already
--      carries pg_cron while the other does not.
--   4. A closing assertion that fails the migration unless both jobs exist and
--      are active. A migration that finishes without proving it did the work is
--      the exact failure this file is fixing.
--
-- cron.schedule(name, schedule, command) upserts by job name, so re-running this
-- retargets the existing job rather than creating a duplicate.

create extension if not exists pg_cron;

select cron.schedule(
  'expire-time-boxed-household-roles',
  '* * * * *',
  'select public.expire_time_boxed_household_roles()'
);

select cron.schedule(
  'purge-expired-old-household-key-wraps',
  '23 3 * * *',
  'select public.purge_expired_old_household_key_wraps()'
);

-- Post condition. This is the loud part.
do $$
declare
  found_jobs integer;
begin
  select count(*)
    into found_jobs
    from cron.job
   where active
     and jobname in (
       'expire-time-boxed-household-roles',
       'purge-expired-old-household-key-wraps'
     );

  if found_jobs <> 2 then
    raise exception
      'household sweep schedules were not created: expected 2 active cron.job rows, found %',
      found_jobs;
  end if;
end
$$;
