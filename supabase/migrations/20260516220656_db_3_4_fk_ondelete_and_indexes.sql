-- =====================================================================
-- FK ON DELETE clauses + missing FK indexes
-- =====================================================================
--
-- Context: six FKs to auth.users were using the default NO ACTION on
-- delete, which leaves silent dangling references when a user is
-- removed. Separately, twelve FK columns had no covering btree index,
-- so every FK validation check and every owner-scoped RLS subquery
-- fell back to a sequential scan.
--
-- This migration is idempotent: every constraint change uses
-- DROP CONSTRAINT IF EXISTS ... ADD CONSTRAINT, and every index uses
-- CREATE INDEX IF NOT EXISTS. Re-running is a no-op.
--
-- ZKA invariant: this migration only changes FK metadata and adds
-- indexes. No row data is rewritten and no new server-side decryption
-- path is introduced. The cascade behaviour of `households.owner_id`
-- (CASCADE -> households -> household_keys, household_signing_keys,
-- household_invites, support_sessions) is unchanged. Wrapped keys are
-- destroyed alongside their household exactly as before.
--
-- Per-column ON DELETE decisions
-- ------------------------------
-- household_invites.used_by ............ SET NULL  (audit *_by: keep row, blank actor)
-- household_key_rotation_jobs.started_by SET NULL  (audit *_by)
-- household_keys.wrapped_by ............ SET NULL  (audit *_by; the wrapped key
--                                                   itself belongs to user_id which
--                                                   already CASCADEs — wrapped_by is
--                                                   purely "who wrapped it for them")
-- household_signing_keys.created_by .... SET NULL  (audit *_by)
-- support_sessions.support_user_id ..... SET NULL  (BB support staff: deleting the
--                                                   support user should not delete
--                                                   the historical session record)
-- support_sessions.granted_by .......... SET NULL  (audit *_by, household member
--                                                   who granted access)
--
-- Columns intentionally NOT modified (audit was stale or intentional):
--   household_invites.inviter_id        — already SET NULL
--   household_invites.recipient_user_id — already SET NULL
--   households.owner_id                 — already CASCADE. Open question
--                                          for review: should account deletion
--                                          really nuke the household for every
--                                          other member? Out of scope here;
--                                          tracked for separate discussion.
--
-- Missing FK indexes added (12 total). All plain btree, no partial
-- predicates, so they cover every FK validation and RLS join.

BEGIN;

-- ---------------------------------------------------------------------
-- FK ON DELETE fixes
-- ---------------------------------------------------------------------

-- household_invites.used_by
ALTER TABLE public.household_invites
  DROP CONSTRAINT IF EXISTS household_invites_used_by_fkey;
ALTER TABLE public.household_invites
  ADD CONSTRAINT household_invites_used_by_fkey
  FOREIGN KEY (used_by) REFERENCES auth.users(id) ON DELETE SET NULL;

-- household_key_rotation_jobs.started_by
ALTER TABLE public.household_key_rotation_jobs
  DROP CONSTRAINT IF EXISTS household_key_rotation_jobs_started_by_fkey;
ALTER TABLE public.household_key_rotation_jobs
  ADD CONSTRAINT household_key_rotation_jobs_started_by_fkey
  FOREIGN KEY (started_by) REFERENCES auth.users(id) ON DELETE SET NULL;

-- household_keys.wrapped_by
ALTER TABLE public.household_keys
  DROP CONSTRAINT IF EXISTS household_keys_wrapped_by_fkey;
ALTER TABLE public.household_keys
  ADD CONSTRAINT household_keys_wrapped_by_fkey
  FOREIGN KEY (wrapped_by) REFERENCES auth.users(id) ON DELETE SET NULL;

-- household_signing_keys.created_by
ALTER TABLE public.household_signing_keys
  DROP CONSTRAINT IF EXISTS household_signing_keys_created_by_fkey;
ALTER TABLE public.household_signing_keys
  ADD CONSTRAINT household_signing_keys_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

-- support_sessions.support_user_id
ALTER TABLE public.support_sessions
  DROP CONSTRAINT IF EXISTS support_sessions_support_user_id_fkey;
ALTER TABLE public.support_sessions
  ADD CONSTRAINT support_sessions_support_user_id_fkey
  FOREIGN KEY (support_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

-- support_sessions.granted_by
ALTER TABLE public.support_sessions
  DROP CONSTRAINT IF EXISTS support_sessions_granted_by_fkey;
ALTER TABLE public.support_sessions
  ADD CONSTRAINT support_sessions_granted_by_fkey
  FOREIGN KEY (granted_by) REFERENCES auth.users(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------
-- Missing FK indexes
-- ---------------------------------------------------------------------

-- connector_credentials.account_id (FK -> accounts.id; CASCADE)
CREATE INDEX IF NOT EXISTS idx_connector_credentials_account_id
  ON public.connector_credentials (account_id);

-- household_invites.used_by / inviter_id / recipient_user_id
CREATE INDEX IF NOT EXISTS idx_household_invites_used_by
  ON public.household_invites (used_by);
CREATE INDEX IF NOT EXISTS idx_household_invites_inviter_id
  ON public.household_invites (inviter_id);
CREATE INDEX IF NOT EXISTS idx_household_invites_recipient_user_id
  ON public.household_invites (recipient_user_id);

-- household_key_rotation_jobs.started_by
CREATE INDEX IF NOT EXISTS idx_household_key_rotation_jobs_started_by
  ON public.household_key_rotation_jobs (started_by);

-- household_keys.wrapped_by
CREATE INDEX IF NOT EXISTS idx_household_keys_wrapped_by
  ON public.household_keys (wrapped_by);

-- household_signing_keys.created_by
CREATE INDEX IF NOT EXISTS idx_household_signing_keys_created_by
  ON public.household_signing_keys (created_by);

-- households.owner_id — highest-impact: every owner-scoped RLS
-- subquery currently seq-scans households.
CREATE INDEX IF NOT EXISTS idx_households_owner_id
  ON public.households (owner_id);

-- pending_admin_emails.household_id / user_id
CREATE INDEX IF NOT EXISTS idx_pending_admin_emails_household_id
  ON public.pending_admin_emails (household_id);
CREATE INDEX IF NOT EXISTS idx_pending_admin_emails_user_id
  ON public.pending_admin_emails (user_id);

-- support_sessions.support_user_id / granted_by
CREATE INDEX IF NOT EXISTS idx_support_sessions_support_user_id
  ON public.support_sessions (support_user_id);
CREATE INDEX IF NOT EXISTS idx_support_sessions_granted_by
  ON public.support_sessions (granted_by);

COMMIT;
