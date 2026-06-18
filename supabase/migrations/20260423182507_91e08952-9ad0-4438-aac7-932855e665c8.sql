CREATE TABLE IF NOT EXISTS public.connection_account_map (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  or_connection_id uuid NOT NULL,
  or_external_wallet_id text NOT NULL,
  encrypted_account_id text NOT NULL,
  encrypted_metadata_key_version smallint NOT NULL DEFAULT 2,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS connection_account_map_user_id_idx
  ON public.connection_account_map (user_id);

CREATE INDEX IF NOT EXISTS connection_account_map_connection_wallet_idx
  ON public.connection_account_map (or_connection_id, or_external_wallet_id);

ALTER TABLE public.connection_account_map ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own connection_account_map select" ON public.connection_account_map;
CREATE POLICY "own connection_account_map select"
  ON public.connection_account_map
  FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "own connection_account_map insert" ON public.connection_account_map;
CREATE POLICY "own connection_account_map insert"
  ON public.connection_account_map
  FOR INSERT
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "own connection_account_map update" ON public.connection_account_map;
CREATE POLICY "own connection_account_map update"
  ON public.connection_account_map
  FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "own connection_account_map delete" ON public.connection_account_map;
CREATE POLICY "own connection_account_map delete"
  ON public.connection_account_map
  FOR DELETE
  USING (user_id = auth.uid());

DROP TRIGGER IF EXISTS connection_account_map_set_updated_at ON public.connection_account_map;
CREATE TRIGGER connection_account_map_set_updated_at
  BEFORE UPDATE ON public.connection_account_map
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();
