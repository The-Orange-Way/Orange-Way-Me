-- ============================================================
-- Phase 5 — transactions external_id (Personal)
-- ============================================================
-- Adds the dedup columns that let the OR import bridge upsert
-- the same OR transaction multiple times (every sync cycle)
-- without creating duplicate `transactions` rows.
--
-- ZK invariants are unchanged:
--   * `external_source` is plaintext but only contains the literal
--     string 'orangerails' (an internal source name). It tells
--     the server "this row came from the OR connector" — the same
--     thing they could already infer from a JOIN against the
--     existing `connection_account_map` table. No new info leaks.
--   * `external_id` is the OR-issued transaction UUID/string. OR
--     already issued it; storing it on Personal's side does not
--     reveal anything new to OR or Personal's server. The mapping
--     between this id and the user's wallet remains hidden behind
--     the encrypted `encrypted_account_id` column on
--     `connection_account_map`.
--
-- The unique partial index is the load-bearing piece: it makes
-- (user_id, external_source, external_id) globally unique among
-- rows where `external_id IS NOT NULL`, so re-syncing the same OR
-- batch is a no-op (`ON CONFLICT DO NOTHING` / Supabase
-- `ignoreDuplicates: true`). Manual user transactions (external_id
-- IS NULL) are unaffected.

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS external_id TEXT,
  ADD COLUMN IF NOT EXISTS external_source TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_external
  ON public.transactions(user_id, external_source, external_id)
  WHERE external_id IS NOT NULL;

COMMENT ON COLUMN public.transactions.external_id IS
  'Phase 5: external system identifier (e.g. OR transaction UUID). '
  'NULL for manually-entered transactions. Combined with external_source '
  'via a unique partial index to make re-imports idempotent.';

COMMENT ON COLUMN public.transactions.external_source IS
  'Phase 5: which external system produced this row. Currently '
  'one of: ''orangerails''. NULL for manually-entered transactions.';
