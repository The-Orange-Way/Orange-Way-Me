-- Narrow the default privileges for NEW tables in schema public.
--
-- WHY. Every table created in public inherits a default grant of
-- SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER and MAINTAIN
-- to both anon and authenticated. Fixing the tables that exist today without
-- fixing the default means the next table added reintroduces the same
-- exposure, and it looks exactly like every other table, so nobody notices.
--
-- WHAT CHANGES, AND WHAT DELIBERATELY DOES NOT.
--   anon           loses everything on NEW tables in schema public.
--   authenticated  loses TRUNCATE, REFERENCES, TRIGGER and MAINTAIN only.
--                  It KEEPS SELECT, INSERT, UPDATE and DELETE, because the
--                  client reads these tables as the authenticated role, and
--                  row level security filters rows on top of a granted
--                  privilege rather than replacing it. Removing the grant
--                  would make the API answer permission denied on every table.
--
-- FOR ROLE IS NAMED ON PURPOSE AND IS NOT OPTIONAL. Default privileges are
-- recorded per grantor role. A bare ALTER DEFAULT PRIVILEGES changes only the
-- defaults of whichever role happens to run the statement, reports success,
-- and can change nothing at all.
--
-- KNOWN SCOPE LIMIT. Schema public has a second grantor whose table default is
-- equally wide. This project's role cannot change that row: it is not a
-- superuser and not a member of that role, and the statement is refused with
-- "42501: permission denied to change default privileges". Tables created
-- through that path still arrive wide, so this migration narrows one of the
-- two paths and not both. Recorded, with the compensating check, outside this
-- repo.
--
-- CONSEQUENCE FOR THE NEXT MIGRATION AUTHOR. Once the default is narrow, a new
-- table needs its grants stated explicitly in the same migration that creates
-- it, for example:
--   GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.my_new_table
--     TO authenticated;
-- Forgetting that produces "permission denied for table my_new_table" from the
-- API. That is the correct fail closed behaviour, not a bug.
--
-- REQUIRES PostgreSQL 17 or newer for the MAINTAIN privilege. On 15 or 16 this
-- is a syntax error rather than a silent no-op. Verified on this project: 17.6.
--
-- SCOPE. New tables only. Existing tables are unchanged by this migration.
-- Sequences and functions are also wide by default and are deliberately left
-- alone here: they are a separate question with a different right answer.
--
-- TO UNDO.
--   ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
--     GRANT ALL ON TABLES TO anon;
--   ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
--     GRANT TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLES TO authenticated;
--
-- Re-running this migration is safe: REVOKE of a privilege that is already
-- absent is a no-op.

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES FROM anon;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLES FROM authenticated;
