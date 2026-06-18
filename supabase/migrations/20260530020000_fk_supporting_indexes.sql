-- Supporting indexes on foreign-key columns. Without an index, every
-- DELETE on the parent table does a sequential scan on the child to
-- find rows to cascade (or set null). Cheap to add, real win at scale.
--
-- Narrowed scope to 3 FKs that need indexes. Listed below with their
-- ON DELETE behavior.
--
-- Also: an earlier review flagged "6 columns to auth.users use
-- NO ACTION (silent dangling-ref risk)" — re-review found 0. They were
-- fixed in intervening work or the original count was wrong. No
-- migration needed for that half.
--
-- Idempotent.

BEGIN;

-- household_keys.user_id → auth.users (CASCADE)
CREATE INDEX IF NOT EXISTS idx_household_keys_user
  ON public.household_keys(user_id);

-- user_last_seen_household_key_versions.household_id → households (CASCADE)
CREATE INDEX IF NOT EXISTS idx_user_last_seen_hskv_household
  ON public.user_last_seen_household_key_versions(household_id);

-- household_members.user_id → auth.users (SET NULL)
CREATE INDEX IF NOT EXISTS idx_household_members_user
  ON public.household_members(user_id);

COMMIT;
