# Writing a migration

## A new table needs its grants stated explicitly

The default privileges for schema `public` have been narrowed. A table created
by a migration now arrives with **no privileges at all for `anon`**, and with
`SELECT, INSERT, UPDATE, DELETE` for `authenticated` and nothing wider.

If you create a table and the API answers `permission denied for table X`,
that is not a bug. It is the default doing its job, and it means the migration
that created the table did not say who may use it. Say it:

```sql
CREATE TABLE public.my_new_table (...);

ALTER TABLE public.my_new_table ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.my_new_table TO authenticated;

CREATE POLICY my_new_table_own ON public.my_new_table
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
```

Grant only the commands the table actually needs. If a table is written only
by a trusted server path, `authenticated` may need `SELECT` and nothing else.

`anon` gets a grant only if a genuinely signed-out path reads or writes the
table, and then only the single command that path needs. Say why in a comment
in the migration, so a later cleanup does not remove it as drift.

## Three rules for any migration that touches privileges

1. **Never revoke `SELECT`, `INSERT`, `UPDATE` or `DELETE` from
   `authenticated` on a table the client uses.** The client reads as the
   `authenticated` role, and row level security filters rows *on top of* a
   granted privilege rather than replacing it. Revoke the grant and every
   policy on that table becomes unreachable, so the API answers permission
   denied instead of returning rows.
2. **`ALTER DEFAULT PRIVILEGES` must name `FOR ROLE`.** Default privileges are
   recorded per grantor role. Without `FOR ROLE` the statement changes only the
   defaults of whichever role happens to run the migration, reports success,
   and can change nothing at all.
3. **A green migration is not proof.** Exiting zero says the statement parsed.
   Read the resulting state back (`pg_class.relacl` for a table,
   `pg_default_acl` for a default) and compare it to what you intended.

## Row level security

Every table in `public` has row level security enabled. Prefer policies that
name `TO authenticated` over policies with no role list: a policy with no role
list applies to `PUBLIC`, which includes `anon`, so the protection then depends
on the `USING` clause being correct for a session with no user rather than on
`anon` never being in scope at all.

## Filenames

`YYYYMMDDHHMMSS_short_snake_case_description.sql`, checked in CI. The timestamp
must sort after every migration already on the default branch.
