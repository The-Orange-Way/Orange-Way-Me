-- Bound the growth of cron.job_run_details.
--
-- pg_cron does not prune cron.job_run_details. The household role expiry sweep runs on
-- '* * * * *', which writes about 1,440 rows a day, about 525,600 a year, indefinitely.
-- The table is also the only record of a sweep that is failing on every tick, so the
-- answer is retention, not deletion of the record.
--
-- Retention chosen: 7 days. At the current cadence that is about 10,080 rows steady
-- state. It is long enough that a sweep which started failing on a Friday is still
-- visible on the Monday, which is the case this evidence exists for.
--
-- Idempotent: the job is unscheduled by name if present, then scheduled again, so a
-- re run leaves exactly one job.
-- Reversal: select cron.unschedule('purge-cron-job-run-details');

do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise exception
      'pg_cron is not installed on this database, so there is nothing to prune. Apply the household sweep schedule migration first.';
  end if;

  perform cron.unschedule(jobid)
    from cron.job
   where jobname = 'purge-cron-job-run-details';

  perform cron.schedule(
    'purge-cron-job-run-details',
    '17 4 * * *',
    $job$delete from cron.job_run_details where end_time < now() - interval '7 days'$job$
  );
end
$$;
