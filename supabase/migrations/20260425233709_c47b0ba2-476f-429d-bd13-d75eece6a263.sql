DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'household_invites'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.household_invites;
  END IF;
END $$;