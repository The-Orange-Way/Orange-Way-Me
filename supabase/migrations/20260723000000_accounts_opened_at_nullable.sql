-- 20260723000000_accounts_opened_at_nullable.sql
--
-- Purpose: allow public.accounts.opened_at to be unknown.
--
-- Before this migration the column was NOT NULL DEFAULT now(), so every
-- account was stamped as opened on the day it was created. Imported
-- history from an external wallet predates that stamp, and the
-- enforce_transaction_after_account_opened trigger (migration
-- 20260530000000) then rejected every one of those transactions.
--
-- After this migration, opened_at may be NULL, meaning "not known yet".
-- The transaction trigger already treats NULL as "no floor" because it
-- guards on v_opened_at IS NOT NULL, so the invariant is skipped rather
-- than violated while the value is unknown.
--
-- Data: no rows are modified. Rows that already carry an opened_at keep
-- it. Repairing those is an application concern, not a migration.
--
-- Locking: both ALTERs are catalog only. They take a brief
-- ACCESS EXCLUSIVE lock and do not rewrite the table.
--
-- Re-run safety: ALTER COLUMN ... DROP NOT NULL and DROP DEFAULT are
-- both no-ops when already applied, so a repeat run is harmless.

ALTER TABLE public.accounts
  ALTER COLUMN opened_at DROP NOT NULL;

ALTER TABLE public.accounts
  ALTER COLUMN opened_at DROP DEFAULT;

COMMENT ON COLUMN public.accounts.opened_at IS
  'Date the account was opened in the real world, in the owner timezone. '
  'NULL means not known yet: the import path sets it from the earliest '
  'transaction received, and the owner can edit it. While it is NULL the '
  'enforce_transaction_after_account_opened invariant does not apply.';

-- Make NULL handling explicit in the reverse invariant.
--
-- The short circuit compares NEW.opened_at::DATE = OLD.opened_at::DATE.
-- In Postgres that yields NULL, not TRUE, when either side is NULL, so
-- the unchanged-NULL case used to fall through to the transaction scan
-- and only avoided a false rejection because the later comparison also
-- yielded NULL. Two explicit guards state the intent instead of relying
-- on that chain.
CREATE OR REPLACE FUNCTION public.enforce_account_opened_at_not_after_txns()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_earliest DATE;
BEGIN
  -- Clearing the opening date removes the floor, so there is nothing
  -- for existing transactions to violate.
  IF NEW.opened_at IS NULL THEN
    RETURN NEW;
  END IF;

  -- Unchanged value, including the NULL to NULL case handled above.
  IF OLD.opened_at IS NOT NULL
     AND NEW.opened_at::DATE = OLD.opened_at::DATE THEN
    RETURN NEW;
  END IF;

  SELECT MIN(date) INTO v_earliest
    FROM public.transactions
   WHERE account_id = NEW.id;

  IF v_earliest IS NOT NULL AND v_earliest < NEW.opened_at::DATE THEN
    RAISE EXCEPTION USING
      ERRCODE = 'check_violation',
      MESSAGE = format(
        'Cannot set opened_at to %s because this account has a '
        'transaction dated %s. Move that transaction first, or pick an '
        'earlier opened_at.',
        NEW.opened_at::DATE, v_earliest
      );
  END IF;

  RETURN NEW;
END;
$function$;

-- Down path (run by hand only, and only after confirming no row holds a
-- NULL opened_at, because re-adding NOT NULL fails if any does):
--
--   UPDATE public.accounts SET opened_at = created_at
--    WHERE opened_at IS NULL;
--   ALTER TABLE public.accounts
--     ALTER COLUMN opened_at SET DEFAULT now();
--   ALTER TABLE public.accounts
--     ALTER COLUMN opened_at SET NOT NULL;
--
-- Reverting also restores the original bug, so it is a break-glass
-- path, not a routine rollback.
