-- Widen public.stealth_sync_runs.error_code to accept the separator characters that
-- third party sync error codes actually use: hyphen, dot and colon.
--
-- The previous class '^[A-Za-z0-9_]+$' rejected rate-limited, auth.failed and
-- ERR:TIMEOUT, so the client's terminal status UPDATE raised 23514 and the run row
-- stayed at status 'started' for ever.
--
-- The 32 character cap is kept (it rules out an address or a txid) and space is
-- still excluded (it rules out a human readable message), so nothing this
-- constraint was protecting is given up.
--
-- Idempotent: the drop is guarded and the constraint is recreated under the same name.
-- Reversal: re add the previous definition, which is
--   check (error_code is null or (length(error_code) <= 32 and error_code ~ '^[A-Za-z0-9_]+$'))

alter table public.stealth_sync_runs
  drop constraint if exists stealth_sync_runs_error_code_check;

alter table public.stealth_sync_runs
  add constraint stealth_sync_runs_error_code_check
  check (
    error_code is null
    or (length(error_code) <= 32 and error_code ~ '^[A-Za-z0-9_.:-]+$')
  );

comment on column public.stealth_sync_runs.error_code is
  'Short machine readable failure code from the sync source. Letters, digits, underscore, hyphen, dot and colon only, 32 characters maximum. Never a human readable message and never an address, a txid or any other user data.';
