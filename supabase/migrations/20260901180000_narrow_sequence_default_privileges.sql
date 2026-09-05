-- New sequences in schema public no longer ship with privileges for the anon
-- role, and the authenticated role is narrowed to the one privilege it needs.
--
-- WHY THIS EXISTS. An earlier migration narrowed the DEFAULT PRIVILEGES for
-- TABLES in this schema. Sequences are the object class next door and were not
-- covered. Read live from pg_default_acl joined to pg_namespace on the
-- development project before this change, both grantor rows for objtype S read:
--
--   {postgres=rwU, anon=rwU, authenticated=rwU, service_role=rwU}
--
-- On a sequence, r is SELECT, w is UPDATE and U is USAGE. UPDATE permits setval
-- and nextval. So every new table in public carrying an identity or serial
-- column shipped with its backing sequence writable by the anon role. Sequence
-- privileges are NOT filtered by row level security, in exactly the way TRUNCATE
-- is not, so the policies on the table were not covering this.
--
-- SEVERITY, STATED HONESTLY. Latent, not live. Reaching a sequence needs a path
-- that calls setval or nextval as anon, and PostgREST does not expose one
-- directly. The reason to fix it is to stop new objects inheriting a wide
-- default, not to close a demonstrated door.
--
-- WHY authenticated KEEPS USAGE AND LOSES THE REST. An identity column inserted
-- through PostgREST needs USAGE on the backing sequence for nextval, so removing
-- USAGE would break inserts. SELECT (currval, lastval) and UPDATE (setval) are
-- not used by the client. Proven rather than assumed: with this default in
-- place, a table created afterwards had its sequence at authenticated=U only,
-- and an INSERT executed as the authenticated role returned a row.
--
-- ALREADY-EXISTING SEQUENCES NEED NOTHING. Read live from pg_class for
-- relkind='S' in schema public: the only application sequence present is
-- sync_events_id_seq, and it already reads
-- {postgres=rwU, authenticated=U, service_role=rwU} with no anon entry. This
-- file therefore changes the default for new objects only, which is all it
-- claims to do.
--
-- WHAT IS LEFT OPEN, NAMED HERE RATHER THAN DISCOVERED LATER. Schema public has
-- TWO default-privilege grantor rows, postgres and supabase_admin. This file
-- narrows the postgres row only. The supabase_admin row CANNOT be narrowed from
-- this project: running the equivalent statement for that role returns
-- "42501: permission denied to change default privileges", because this
-- project's role is neither a superuser nor a member of supabase_admin. So an
-- object created through a path that runs as supabase_admin, the hosted SQL
-- editor being the obvious one, still arrives wide. Nothing in this repository
-- creates objects that way. A compensating detection check for that residual
-- path is tracked separately; this is the same residual that the table-default
-- change left behind, not a new one.
--
-- FUNCTIONS (objtype f) still carry anon=X on both grantors. That is a different
-- object class with its own ticket and is deliberately not touched here.
--
-- REVERSIBLE. The undo is the platform default:
--   alter default privileges for role postgres in schema public
--     grant all on sequences to anon;
--   alter default privileges for role postgres in schema public
--     grant select, update on sequences to authenticated;
--
-- IDEMPOTENT. ALTER DEFAULT PRIVILEGES ... REVOKE is naturally re-runnable;
-- running this file twice leaves the same end state.
--
-- FOR ROLE IS NAMED EXPLICITLY ON EVERY STATEMENT. Without it, the statement
-- applies only to objects created by the role that happens to be executing it,
-- which can run clean, report success, and change nothing.

begin;

alter default privileges for role postgres in schema public
  revoke all on sequences from anon;

alter default privileges for role postgres in schema public
  revoke select, update on sequences from authenticated;

commit;
