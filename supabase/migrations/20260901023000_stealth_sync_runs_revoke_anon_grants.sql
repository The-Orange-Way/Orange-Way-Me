-- stealth_sync_runs was created with no GRANT/REVOKE statements at all, so it
-- inherited Supabase's schema-level default privileges: anon and authenticated
-- both hold every privilege on the table, including TRUNCATE. Row level
-- security does not constrain TRUNCATE, so this is a defense-in-depth gap.
--
-- HOW BAD, honestly: not a live hole today. RLS is enabled and all three
-- policies are user_id = auth.uid(), so anon resolves auth.uid() to NULL and
-- reads/writes no rows through PostgREST, which has no truncate verb and no
-- raw SQL surface for anon or authenticated. The exposure is latent: any
-- future migration that adds a permissive policy, or any moment RLS is
-- disabled on this table, turns directly into full anonymous write and
-- delete. Closing the default-privilege door now removes that dependency on
-- RLS alone.
--
-- The client genuinely needs INSERT, SELECT and UPDATE: src/lib/stealthSyncRuns.ts
-- calls startStealthSyncRun (insert ... returning id) and finishStealthSyncRun
-- (update by id). No DELETE grant: there is deliberately no DELETE policy on
-- this table and the design does not want one.
--
-- Forward-only and additive: this does not edit the already-applied
-- 20260827120000_stealth_sync_runs.sql. Idempotent: REVOKE/GRANT are
-- naturally idempotent in Postgres, safe to replay.

revoke all on public.stealth_sync_runs from anon;
revoke all on public.stealth_sync_runs from authenticated;
grant select, insert, update on public.stealth_sync_runs to authenticated;
