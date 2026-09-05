-- Widen public.stealth_sync_runs.error_code to accept the separator characters that
-- third party sync error codes actually use: hyphen, dot and colon.
--
-- WHAT ACTUALLY GOES WRONG, corrected after review. The database never raised
-- 23514 on this column, because it never saw a value that could. The only writer
-- is src/lib/stealthSyncRuns.ts, and normalizeErrorCode there replaces anything
-- failing its own ERROR_CODE_PATTERN with the literal UNRECOGNIZED, which the old
-- class accepted. So rate-limited, auth.failed and ERR:TIMEOUT never reached the
-- insert as themselves. They arrived flattened, and no row was ever pinned at
-- status 'started' by this constraint.
--
-- The defect is that flattening. Every third party failure reason collapses to one
-- value, so the column cannot tell a rate limit from an auth failure, which is the
-- one thing it exists to record.
--
-- This file is therefore half of the fix and is inert on its own. The other half,
-- widening ERROR_CODE_PATTERN in src/lib/stealthSyncRuns.ts to this same class,
-- ships in the same pull request so the constraint and its only writer move
-- together. Widen the database side first when applying.
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
