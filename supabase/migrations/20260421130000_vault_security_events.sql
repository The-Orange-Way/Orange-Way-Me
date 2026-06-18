-- ============================================================
-- vault_security_events — audit log for vault key-material events.
-- ============================================================
-- Captures user-level vault key events: setup, unlock, recover,
-- password_changed, recovery_code_regenerated, vault_upgraded.
--
-- Privacy: event names are short codes. metadata is a JSONB blob
-- for low-sensitivity context (e.g. key_version). Never put
-- plaintext or PII here.

CREATE TABLE IF NOT EXISTS public.vault_security_events (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event      TEXT NOT NULL,
  metadata   JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.vault_security_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can insert their own vault security events" ON public.vault_security_events;
CREATE POLICY "Users can insert their own vault security events"
  ON public.vault_security_events FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can read their own vault security events" ON public.vault_security_events;
CREATE POLICY "Users can read their own vault security events"
  ON public.vault_security_events FOR SELECT
  USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_vault_security_events_user_created
  ON public.vault_security_events(user_id, created_at DESC);

COMMENT ON TABLE public.vault_security_events IS
  'Audit log for user-level vault key events: setup, unlock, recover, password_changed, recovery_code_regenerated, vault_upgraded.';
