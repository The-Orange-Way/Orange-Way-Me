-- Grant table/sequence/function privileges to Supabase's standard roles.
--
-- Why this migration exists:
-- When tables are created via the Supabase Studio UI, Supabase auto-grants
-- the equivalent of GRANT ALL ON <new_table> TO anon, authenticated, service_role.
-- When tables are created via SQL migrations, this auto-grant does NOT happen.
-- Without it, every PostgREST query returns "permission denied" — even for
-- the service_role key. RLS policies still restrict row access; this only
-- unlocks the API surface so PostgREST can route to the table at all.
--
-- This migration is idempotent and safe to re-run.

-- Schema usage
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- Existing objects
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated, service_role;

-- Future objects (anything created after this migration runs)
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
