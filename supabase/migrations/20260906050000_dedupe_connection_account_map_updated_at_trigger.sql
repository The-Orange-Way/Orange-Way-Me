-- OWM-T0753: connection_account_map carried two identical updated_at triggers.
--
-- trg_connection_account_map_updated_at was created by the original
-- 20260423120000_connection_account_map.sql migration.
-- connection_account_map_set_updated_at was created about an hour later by
-- 20260423182507_91e08952-9ad0-4438-aac7-932855e665c8.sql, an auto generated
-- migration that recreated the whole table (policies included) instead of
-- being a no-op, and named the trigger under Supabase's default convention
-- instead of noticing one already existed.
--
-- Both triggers were BEFORE UPDATE FOR EACH ROW EXECUTE FUNCTION set_updated_at(),
-- so every update ran the same work twice and wrote the same value twice. Not a
-- correctness bug, just duplicated work.
--
-- Kept trg_connection_account_map_updated_at: it matches the trg_<table>_updated_at
-- convention used on every other table with this pattern (accounts, budgets, goals,
-- rules, transactions).

DROP TRIGGER IF EXISTS connection_account_map_set_updated_at ON public.connection_account_map;
