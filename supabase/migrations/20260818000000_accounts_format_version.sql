-- 20260818000000_accounts_format_version.sql
--
-- Purpose: add a plaintext migration-state marker to public.accounts so
-- the client-side BTC unit correction (DL-1236 / DL-1342) is datable and
-- its completion is a clean server-side count.
--
-- Background: DL-1236 found two account writers that disagreed on units.
-- The fix normalises balances client-side. Because enc_balance and
-- enc_currency are ciphertext with no plaintext discriminator, the
-- server cannot find or correct these rows: the correction lands per
-- user on decrypt and writeback. This marker records, in plaintext, only
-- WHICH format a row is written in, so "no unmigrated rows remain" is a
-- server-side count rather than a per-user guess.
--
-- ZKA: the column is migration state, not a balance signal. It is not
-- derived from enc_balance or enc_currency, so no plaintext value from
-- the encrypted payload is exposed. It is ZKA-neutral.
--
-- Value meaning:
--   0 = written in the pre-correction format, or not yet stamped.
--   1 = written by a writer that applies the DL-1342 unit correction.
-- The client stamps 1 during the same decrypt, re-encrypt, and re-sign
-- write that applies the correction. DEFAULT 0 means every existing row
-- reads as unmigrated, so:
--   SELECT count(*) FROM public.accounts WHERE format_version = 0;
-- is the completion gate before the rollout is declared done.
--
-- Locking: ADD COLUMN with a constant, non-volatile DEFAULT is a catalog
-- only change in modern Postgres. It takes a brief ACCESS EXCLUSIVE lock
-- and does not rewrite the table.
--
-- Re-run safety: ADD COLUMN IF NOT EXISTS is a no-op when the column is
-- already present, so a repeat run is harmless.

ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS format_version smallint NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.accounts.format_version IS
  'Plaintext migration-state marker for the DL-1342 client-side BTC unit '
  'correction. 0 = pre-correction format or not yet stamped, 1 = written '
  'by a corrected writer. Not derived from enc_balance or enc_currency, '
  'so it carries no plaintext balance signal. dek_key_version keeps its '
  'own key-rotation meaning and is unrelated to this marker.';

-- Down path (run by hand only):
--
--   ALTER TABLE public.accounts DROP COLUMN IF EXISTS format_version;
--
-- Dropping the marker loses only the recorded migration state, not any
-- account data. Re-running the up path restores it with every row back
-- at 0.
