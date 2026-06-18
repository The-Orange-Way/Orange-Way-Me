-- ============================================================
-- Phase 4 — connection_account_map (Personal)
-- ============================================================
-- Per-user, ZK-encrypted mapping that records which Personal
-- `accounts.id` an OrangeRails source wallet should be routed to
-- when transactions are displayed (and, in a later phase, when
-- they are converted into budget-tracked transactions).
--
-- ZKA invariants:
--   * `or_connection_id` and `or_external_wallet_id` are PLAINTEXT
--     opaque identifiers (UUID + string) issued by OR. They tell
--     the server nothing about the user's accounts or finances —
--     only that "OR connection X has wallet Y" exists. This is
--     consistent with the rest of the OR-side data: source_wallets'
--     metadata is stored encrypted on OR's side too.
--   * `encrypted_account_id` IS the load-bearing secret. It's the
--     Personal `accounts.id` (a UUID) encrypted with the user vault
--     MEK using the same AES-256-GCM scheme as every other
--     `enc_*` column in this database. The server therefore cannot
--     learn which Personal account a given OR wallet maps to.
--   * Mapping resolution happens entirely client-side after
--     unlock: the browser fetches the rows for the current
--     OR connection, decrypts each `encrypted_account_id`, and
--     joins against the already-decrypted `accounts` cache.
--
-- Why no FK to `accounts(id)`? Because the column holds ciphertext,
-- not the raw UUID. Account deletion is handled client-side: when
-- the user deletes an account we sweep matching mapping rows in
-- the same flow. (A garbage map row pointing at a missing account
-- is a UI no-op — it just stops resolving to a name.)
--
-- The unique constraint `(user_id, or_connection_id, or_external_wallet_id,
-- encrypted_account_id)` enables N:N mappings (rare — one OR wallet
-- can route to multiple Personal accounts, e.g. a split) while still
-- preventing the same row from being inserted twice. Note that the
-- ciphertext is non-deterministic (random IV per encrypt), so the
-- uniqueness check on `encrypted_account_id` is mostly a nominal
-- guard — duplicates are prevented by client-side dedupe before insert.

CREATE TABLE IF NOT EXISTS public.connection_account_map (
  id                              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  or_connection_id                UUID NOT NULL,
  or_external_wallet_id           TEXT NOT NULL,
  encrypted_account_id            TEXT NOT NULL,
  encrypted_metadata_key_version  INTEGER NOT NULL DEFAULT 1,
  is_active                       BOOLEAN NOT NULL DEFAULT true,
  created_at                      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, or_connection_id, or_external_wallet_id, encrypted_account_id)
);

CREATE INDEX IF NOT EXISTS idx_cam_user
  ON public.connection_account_map(user_id);

CREATE INDEX IF NOT EXISTS idx_cam_or_conn
  ON public.connection_account_map(or_connection_id);

DROP TRIGGER IF EXISTS trg_connection_account_map_updated_at ON public.connection_account_map;
CREATE TRIGGER trg_connection_account_map_updated_at
  BEFORE UPDATE ON public.connection_account_map
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.connection_account_map ENABLE ROW LEVEL SECURITY;

-- User-scoped RLS — mirrors the pattern used by every other Personal
-- table (accounts, transactions, categories, budgets, goals,
-- connector_credentials in 20260418021640_*.sql). One owner == one
-- vault == one Supabase user.
DROP POLICY IF EXISTS "own connection_account_map select"
  ON public.connection_account_map;
CREATE POLICY "own connection_account_map select"
  ON public.connection_account_map FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "own connection_account_map insert"
  ON public.connection_account_map;
CREATE POLICY "own connection_account_map insert"
  ON public.connection_account_map FOR INSERT
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "own connection_account_map update"
  ON public.connection_account_map;
CREATE POLICY "own connection_account_map update"
  ON public.connection_account_map FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "own connection_account_map delete"
  ON public.connection_account_map;
CREATE POLICY "own connection_account_map delete"
  ON public.connection_account_map FOR DELETE
  USING (user_id = auth.uid());

COMMENT ON TABLE public.connection_account_map IS
  'Phase 4: per-user encrypted map from (OR connection, OR wallet) '
  'to Personal accounts.id. encrypted_account_id is MEK-wrapped — '
  'the server cannot learn which Personal account a given OR wallet '
  'maps to. Resolved entirely client-side after vault unlock.';

COMMENT ON COLUMN public.connection_account_map.encrypted_account_id IS
  'AES-256-GCM ciphertext of the Personal accounts.id (UUID) using '
  'the user vault MEK. Same format as every other enc_* column.';

COMMENT ON COLUMN public.connection_account_map.or_connection_id IS
  'OR-issued connection UUID — opaque to Personal, plaintext OK.';

COMMENT ON COLUMN public.connection_account_map.or_external_wallet_id IS
  'OR-issued source_wallet external_wallet_id — opaque provider-side '
  'string (Blink wallet GraphQL id, etc.). Plaintext OK.';
