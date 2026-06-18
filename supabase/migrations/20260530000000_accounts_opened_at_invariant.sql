-- Beancount-style account-opening invariant (from OWB ledger-hardening analysis 2026-05-30).
--
-- Adds accounts.opened_at and a trigger that rejects transactions
-- whose date predates the account's opened_at. Catches the
-- "I imported a 2023 CSV into the wrong account" mistake at insert
-- time instead of weeks later when the user notices.
--
-- ZKA-compatible: opened_at + transaction.date are both plaintext
-- (dates aren't encrypted). The encrypted enc_currency column would
-- have been the other half of Beancount's open directive
-- (allowed_currencies); we skip that since currency is encrypted and
-- the server can't validate it without breaking ZKA.
--
-- Backfill: opened_at defaults to created_at, so every existing
-- account starts with opened_at = the day the account was added.
-- No transaction can predate when its account first existed, so
-- the invariant is satisfied for existing data without action.
-- Users who want to backdate (importing historical data) can edit
-- opened_at later — UI follow-up tracks this.
--
-- The trigger fires on INSERT or UPDATE-of-date on transactions,
-- plus on UPDATE-of-opened_at on accounts (to catch retroactive
-- account-opening date changes that would invalidate existing rows).
--
-- Idempotent.

BEGIN;

ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS opened_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- Existing rows: opened_at = created_at so historical data is
-- consistent. This UPDATE is safe even on re-run (idempotent) because
-- DEFAULT now() only fires when the column is added, and we explicitly
-- backfill to created_at after.
UPDATE public.accounts
   SET opened_at = created_at
 WHERE opened_at <> created_at
   AND created_at IS NOT NULL;

COMMENT ON COLUMN public.accounts.opened_at IS
  'When this account was opened in real life (Beancount open directive). '
  'Defaults to the row''s created_at. Transactions on the account must '
  'have date >= opened_at; the enforce_transaction_after_account_opened '
  'trigger rejects writes that violate this. Users can edit this from '
  'the account settings to backdate for historical CSV imports.';

CREATE OR REPLACE FUNCTION public.enforce_transaction_after_account_opened()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_opened_at DATE;
BEGIN
  -- Lookup the account's opened_at date.
  SELECT opened_at::DATE INTO v_opened_at
    FROM public.accounts
   WHERE id = NEW.account_id;

  IF v_opened_at IS NOT NULL AND NEW.date < v_opened_at THEN
    RAISE EXCEPTION USING
      ERRCODE = 'check_violation',
      MESSAGE = format(
        'Transaction date %s is before account opened_at %s. '
        'Edit the account''s opened-on date if this is historical data.',
        NEW.date, v_opened_at
      );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tx_after_account_opened ON public.transactions;
CREATE TRIGGER trg_tx_after_account_opened
  BEFORE INSERT OR UPDATE OF date, account_id
  ON public.transactions
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_transaction_after_account_opened();

-- Parallel trigger: if a user moves an account's opened_at FORWARD,
-- reject the UPDATE if any existing transaction would be invalidated.
-- This prevents data getting orphaned (silently violating the
-- invariant) when opened_at is edited.
CREATE OR REPLACE FUNCTION public.enforce_account_opened_at_not_after_txns()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_earliest DATE;
BEGIN
  IF NEW.opened_at::DATE = OLD.opened_at::DATE THEN
    RETURN NEW;
  END IF;

  SELECT MIN(date) INTO v_earliest
    FROM public.transactions
   WHERE account_id = NEW.id;

  IF v_earliest IS NOT NULL AND v_earliest < NEW.opened_at::DATE THEN
    RAISE EXCEPTION USING
      ERRCODE = 'check_violation',
      MESSAGE = format(
        'Cannot set opened_at to %s — account has a transaction dated %s. '
        'Move the offending transaction first or pick an earlier opened_at.',
        NEW.opened_at::DATE, v_earliest
      );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_account_opened_at_not_after_txns ON public.accounts;
CREATE TRIGGER trg_account_opened_at_not_after_txns
  BEFORE UPDATE OF opened_at
  ON public.accounts
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_account_opened_at_not_after_txns();

COMMENT ON FUNCTION public.enforce_transaction_after_account_opened() IS
  'Beancount-style account-opening invariant: rejects transactions whose '
  'date predates the parent account''s opened_at. Fires on INSERT or '
  'UPDATE-of-(date, account_id) on transactions.';

COMMENT ON FUNCTION public.enforce_account_opened_at_not_after_txns() IS
  'Parallel guardrail: blocks UPDATE-of-opened_at on accounts when an '
  'existing transaction would become invalid. Prevents silent invariant '
  'violations from retroactive opened_at edits.';

COMMIT;
