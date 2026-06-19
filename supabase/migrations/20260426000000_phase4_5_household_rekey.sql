-- ============================================================
-- Phase 4.5 — Household refresh: resumable rotation jobs, version
-- columns on shared tables, 30-day rollback window, auto-purge.
-- ============================================================
-- Design references:
--   docs/HOUSEHOLD-SHARING-DESIGN.md §3 (schema), §10 (decisions locked)
--   docs/HOUSEHOLD-SHARING-DESIGN.md §6 "Hard re-key" + maintenance
--     banner + Quick vs Deep refresh
--
-- What Phase 4.5 does (Orange Way variant):
--
--   Phase 4.3 (Orange Way side) will wrap a shared household DEK for each
--   member at invite time. Phase 4.5 establishes the full refresh
--   pipeline: generate a new household DEK, re-wrap it for every
--   current member, re-encrypt every household-scoped row (Deep
--   refresh) or simply bump the version column (Quick refresh),
--   flip the active pointer atomically, keep the previous key
--   material around for 30 days as a rollback safety net.
--
-- What this migration adds:
--
--   1. `household_key_rotation_jobs` — resumable job state machine
--      scoped per household.
--   2. `household_active_key_versions` — one row per household
--      pointing at the CURRENT active DEK key_version. Rollback is
--      a single UPDATE.
--   3. `household_keys.is_placeholder` — marks Phase 4.3 placeholder
--      wraps (random DEK, no real shared semantics yet) so Phase 4.5
--      first-time setup can migrate them without touching real wraps.
--   4. `dek_key_version INT NOT NULL DEFAULT 1` on every Orange Way encrypted
--      business table that got a `scope` column in Phase 4.1:
--      transactions, accounts, categories, budgets, goals, rules.
--      Row-level refresh bumps this atomically with the new
--      ciphertext.
--   5. `user_last_seen_household_key_versions` — force-refresh cookie
--      table. UI compares current active versions vs last seen and
--      shows a reload banner if a peer refreshed keys.
--   6. `pending_admin_emails` — queue for the first-time setup
--      welcome email (and any future email-on-admin-action flows).
--   7. `advance_household_rotation_job()` — SECURITY DEFINER helper
--      for legal state transitions + audit events.
--   8. `purge_expired_old_household_key_wraps()` — SECURITY DEFINER
--      VOLATILE sweep that clears the previous-version wraps once a
--      job's 30-day rollback window has lapsed.
--   9. pg_cron schedule (guarded).
--
-- Idempotent: every CREATE / ALTER is guarded. Running twice is a
-- no-op.
--
-- Safety notes:
--   - All existing rows keep dek_key_version = 1 (the default).
--   - Phase 4.3 placeholder wrap behavior remains correct for
--     households that don't have an `household_active_key_versions`
--     row yet.
--   - No OSK: the household model does not yet ship the
--     `org_signing_keys` primitive. If OSK lands later the
--     migration can be extended in place.

BEGIN;

-- ══════════════════════════════════════════════════════════════════════
-- 1. household_key_rotation_jobs — resumable job state machine
-- ══════════════════════════════════════════════════════════════════════
--
-- Lifecycle:
--   pending            → job inserted, nothing committed yet
--   generating_keys    → client is generating the new household DEK
--   wrapping_members   → client is inserting new wraps (additive; old
--                        wraps still valid under
--                        household_active_key_versions)
--   rekeying_rows      → client is paging business tables in batches.
--                        Quick: bump dek_key_version only.
--                        Deep:  decrypt with old DEK and re-encrypt
--                        with new DEK; row.dek_key_version bumped
--                        atomically with the new ciphertext.
--   finalizing         → client called finalize-household-rekey;
--                        household_active_key_versions is atomically
--                        flipped to the new version
--   complete           → success; rollback_expires_at populated 30 days
--                        out so emergency rollback is possible
--   aborted            → client aborted mid-job; new wraps +
--                        partially-refreshed rows are rolled back by
--                        the abort handler;
--                        household_active_key_versions unchanged
--   rolled_back        → emergency rollback during rollback window;
--                        household_active_key_versions reverted to the
--                        previous version

CREATE TABLE IF NOT EXISTS public.household_key_rotation_jobs (
  id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id               UUID NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  status                     TEXT NOT NULL DEFAULT 'pending'
                              CHECK (status IN (
                                'pending',
                                'generating_keys',
                                'wrapping_members',
                                'rekeying_rows',
                                'finalizing',
                                'complete',
                                'aborted',
                                'rolled_back'
                              )),
  trigger_type               TEXT NOT NULL
                              CHECK (trigger_type IN ('first_time_setup','manual','post_revoke')),
  refresh_mode               TEXT NOT NULL DEFAULT 'quick'
                              CHECK (refresh_mode IN ('quick','deep')),
  started_by                 UUID NOT NULL REFERENCES auth.users(id),
  started_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at               TIMESTAMPTZ,
  new_dek_key_version        INT  NOT NULL,
  previous_dek_key_version   INT,
  rollback_expires_at        TIMESTAMPTZ,
  rows_total                 INT  NOT NULL DEFAULT 0,
  rows_processed             INT  NOT NULL DEFAULT 0,
  rows_failed                INT  NOT NULL DEFAULT 0,
  abort_reason               TEXT,
  error_log                  JSONB NOT NULL DEFAULT '[]'::jsonb
);

-- Only ONE active job per household. Completed / aborted / rolled_back
-- jobs stay around for history and rollback.
CREATE UNIQUE INDEX IF NOT EXISTS ux_household_key_rotation_jobs_single_active
  ON public.household_key_rotation_jobs(household_id)
  WHERE status NOT IN ('complete','aborted','rolled_back');

CREATE INDEX IF NOT EXISTS idx_household_key_rotation_jobs_household_started
  ON public.household_key_rotation_jobs(household_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_household_key_rotation_jobs_rollback_window
  ON public.household_key_rotation_jobs(rollback_expires_at)
  WHERE status = 'complete' AND rollback_expires_at IS NOT NULL;

ALTER TABLE public.household_key_rotation_jobs ENABLE ROW LEVEL SECURITY;

-- Any household member reads their own household's jobs (needed so the
-- maintenance banner can react to jobs in-flight). Exposes status +
-- stage + progress counts — no secret material.
DROP POLICY IF EXISTS "household_key_rotation_jobs_select_members"
  ON public.household_key_rotation_jobs;
CREATE POLICY "household_key_rotation_jobs_select_members"
  ON public.household_key_rotation_jobs
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.household_members hm
       WHERE hm.household_id = public.household_key_rotation_jobs.household_id
         AND hm.user_id = auth.uid()
         AND hm.status = 'active'
    )
  );

-- Only the household Owner can INSERT/UPDATE jobs. We look the Owner
-- up via households.owner_id (Phase 4.1 authoritative column).
DROP POLICY IF EXISTS "household_key_rotation_jobs_insert_owner"
  ON public.household_key_rotation_jobs;
CREATE POLICY "household_key_rotation_jobs_insert_owner"
  ON public.household_key_rotation_jobs
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.households h
       WHERE h.id = public.household_key_rotation_jobs.household_id
         AND h.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "household_key_rotation_jobs_update_owner"
  ON public.household_key_rotation_jobs;
CREATE POLICY "household_key_rotation_jobs_update_owner"
  ON public.household_key_rotation_jobs
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.households h
       WHERE h.id = public.household_key_rotation_jobs.household_id
         AND h.owner_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.households h
       WHERE h.id = public.household_key_rotation_jobs.household_id
         AND h.owner_id = auth.uid()
    )
  );

COMMENT ON TABLE public.household_key_rotation_jobs IS
  'Phase 4.5: resumable household-refresh job state machine. One active '
  'job per household. After status=complete, rollback_expires_at is 30 '
  'days out and emergency rollback is allowed during that window.';

COMMENT ON COLUMN public.household_key_rotation_jobs.refresh_mode IS
  'Phase 4.5: quick = mark rows with new dek_key_version without '
  're-encrypting; deep = decrypt with old DEK and re-encrypt with new. '
  'User choice on Wizard Screen 2; default quick.';


-- ══════════════════════════════════════════════════════════════════════
-- 2. household_active_key_versions — current active DEK pointer
-- ══════════════════════════════════════════════════════════════════════
--
-- Exactly one row per household. Updated atomically by
-- finalize-household-rekey (forward) and by abort-household-rekey
-- (rollback). Client reads this on load; compares to
-- `user_last_seen_household_key_versions` to decide if a reload banner
-- is needed.

CREATE TABLE IF NOT EXISTS public.household_active_key_versions (
  household_id             UUID PRIMARY KEY REFERENCES public.households(id) ON DELETE CASCADE,
  active_dek_key_version   INT NOT NULL DEFAULT 1,
  last_rotated_at          TIMESTAMPTZ
);

ALTER TABLE public.household_active_key_versions ENABLE ROW LEVEL SECURITY;

-- Any active household member reads the active pointer (needed to
-- decrypt with the right key_version and to detect "another member
-- refreshed security" state).
DROP POLICY IF EXISTS "household_active_key_versions_select_members"
  ON public.household_active_key_versions;
CREATE POLICY "household_active_key_versions_select_members"
  ON public.household_active_key_versions
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.household_members hm
       WHERE hm.household_id = public.household_active_key_versions.household_id
         AND hm.user_id = auth.uid()
         AND hm.status = 'active'
    )
    OR EXISTS (
      SELECT 1 FROM public.households h
       WHERE h.id = public.household_active_key_versions.household_id
         AND h.owner_id = auth.uid()
    )
  );

-- Writes go through the finalize / abort edge functions under the
-- service role. No end-user INSERT/UPDATE/DELETE policy.

-- Backfill: one row per existing household with key_version = 1.
INSERT INTO public.household_active_key_versions (household_id, active_dek_key_version)
SELECT h.id, 1
  FROM public.households h
 WHERE NOT EXISTS (
   SELECT 1 FROM public.household_active_key_versions a
    WHERE a.household_id = h.id
 );

COMMENT ON TABLE public.household_active_key_versions IS
  'Phase 4.5: current active household DEK key_version. Atomically '
  'flipped by finalize-household-rekey; reverted by emergency rollback '
  'within the 30-day window. Client compares to '
  'user_last_seen_household_key_versions to decide if a reload banner '
  'is needed after a peer refresh.';


-- ══════════════════════════════════════════════════════════════════════
-- 3. household_keys: is_placeholder column
-- ══════════════════════════════════════════════════════════════════════
--
-- Phase 4.3 (Orange Way invite flow) will set is_placeholder = TRUE when
-- wrapping a random placeholder DEK for early invites (before the
-- household has a real shared DEK established). Phase 4.5 first-time
-- setup swaps those for real DEK wraps (is_placeholder = FALSE) and
-- the migration logic below seeds the column without disturbing any
-- existing rows.
--
-- key_version already exists (Phase 4.1 schema); we leave it alone.

ALTER TABLE public.household_keys
  ADD COLUMN IF NOT EXISTS is_placeholder BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.household_keys.is_placeholder IS
  'Phase 4.5: TRUE for Phase 4.3 placeholder wraps (random DEK, no '
  'real shared-household-DEK semantics yet). Phase 4.5 first-time '
  'setup migrates these to real DEK wraps (FALSE).';


-- ══════════════════════════════════════════════════════════════════════
-- 4. Shared tables: add dek_key_version column
-- ══════════════════════════════════════════════════════════════════════
--
-- Every shared Orange Way table gets a `dek_key_version INT NOT NULL DEFAULT 1`
-- column. Row-level refresh bumps this atomically with the new
-- ciphertext (Deep mode) or on its own (Quick mode). The client's
-- decrypt path reads this column to pick the matching DEK during a
-- rotation where some rows are on old and some on new.

DO $$
DECLARE
  t TEXT;
  tables TEXT[] := ARRAY[
    'transactions',
    'accounts',
    'categories',
    'budgets',
    'goals',
    'rules'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = t
    ) THEN
      EXECUTE format(
        'ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS dek_key_version INT NOT NULL DEFAULT 1',
        t
      );
    ELSE
      RAISE NOTICE 'Phase 4.5: table public.% does not exist — skipping dek_key_version add', t;
    END IF;
  END LOOP;
END;
$$;


-- ══════════════════════════════════════════════════════════════════════
-- 5. user_last_seen_household_key_versions — force-refresh cookie
-- ══════════════════════════════════════════════════════════════════════
--
-- Updated on successful unlock. Client reads on every load; if active
-- version > last seen, UI shows "Someone in your household refreshed
-- security. Reload?" banner. RLS restricts reads and writes to the
-- user themselves.

CREATE TABLE IF NOT EXISTS public.user_last_seen_household_key_versions (
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  household_id    UUID NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  dek_key_version INT NOT NULL DEFAULT 1,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, household_id)
);

ALTER TABLE public.user_last_seen_household_key_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_last_seen_household_select_own"
  ON public.user_last_seen_household_key_versions;
CREATE POLICY "user_last_seen_household_select_own"
  ON public.user_last_seen_household_key_versions
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "user_last_seen_household_insert_own"
  ON public.user_last_seen_household_key_versions;
CREATE POLICY "user_last_seen_household_insert_own"
  ON public.user_last_seen_household_key_versions
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "user_last_seen_household_update_own"
  ON public.user_last_seen_household_key_versions;
CREATE POLICY "user_last_seen_household_update_own"
  ON public.user_last_seen_household_key_versions
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

COMMENT ON TABLE public.user_last_seen_household_key_versions IS
  'Phase 4.5: per-user last-seen active household DEK version. Client '
  'compares to household_active_key_versions on every load to detect '
  'peer-initiated refresh and prompt the user to reload.';


-- ══════════════════════════════════════════════════════════════════════
-- 6. pending_admin_emails — queue for admin-action emails
-- ══════════════════════════════════════════════════════════════════════
--
-- Lightweight email outbox. Phase 4.5 writes a `household_ready` row
-- after first-time setup completes; a future scheduled function
-- dispatches pending rows through Supabase Auth or an ESP. Leaving the
-- dispatch path out of this migration is intentional; Orange Way does not yet
-- have an ESP configured, and V3's polish agent ships its own
-- dispatcher.

CREATE TABLE IF NOT EXISTS public.pending_admin_emails (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  household_id  UUID REFERENCES public.households(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL,
  subject       TEXT NOT NULL,
  body          TEXT NOT NULL,
  queued_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at       TIMESTAMPTZ,
  send_error    TEXT
);

ALTER TABLE public.pending_admin_emails ENABLE ROW LEVEL SECURITY;

-- No user-facing policy. All writes/reads happen via service role.
-- Leaving the table without a policy means RLS denies by default —
-- exactly what we want.

CREATE INDEX IF NOT EXISTS idx_pending_admin_emails_unsent
  ON public.pending_admin_emails(queued_at)
  WHERE sent_at IS NULL;

COMMENT ON TABLE public.pending_admin_emails IS
  'Phase 4.5: email outbox for admin-action emails (first-time '
  'household setup welcome, future account-level notifications). '
  'Service-role only; no end-user RLS.';


-- ══════════════════════════════════════════════════════════════════════
-- 7. advance_household_rotation_job() — legal transition helper
-- ══════════════════════════════════════════════════════════════════════
--
-- Validates state transitions and writes a
-- `household_rekey.status_changed` audit event. Raises when an illegal
-- transition is requested.

CREATE OR REPLACE FUNCTION public.advance_household_rotation_job(
  p_job_id     UUID,
  p_new_status TEXT
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job     RECORD;
  v_allowed BOOLEAN := FALSE;
BEGIN
  SELECT * INTO v_job
    FROM public.household_key_rotation_jobs
   WHERE id = p_job_id
   FOR UPDATE;

  IF v_job IS NULL THEN
    RAISE EXCEPTION 'Household rotation job % not found', p_job_id;
  END IF;

  -- Legal transitions. Any non-terminal state → aborted is always
  -- allowed. complete → rolled_back only allowed during rollback
  -- window.
  IF p_new_status = 'aborted' THEN
    v_allowed := v_job.status NOT IN ('complete','aborted','rolled_back');
  ELSIF p_new_status = 'rolled_back' THEN
    v_allowed := v_job.status = 'complete'
             AND v_job.rollback_expires_at IS NOT NULL
             AND v_job.rollback_expires_at > now();
  ELSIF v_job.status = 'pending'          AND p_new_status = 'generating_keys'  THEN v_allowed := TRUE;
  ELSIF v_job.status = 'generating_keys'  AND p_new_status = 'wrapping_members' THEN v_allowed := TRUE;
  ELSIF v_job.status = 'wrapping_members' AND p_new_status = 'rekeying_rows'    THEN v_allowed := TRUE;
  ELSIF v_job.status = 'rekeying_rows'    AND p_new_status = 'finalizing'       THEN v_allowed := TRUE;
  ELSIF v_job.status = 'finalizing'       AND p_new_status = 'complete'         THEN v_allowed := TRUE;
  END IF;

  IF NOT v_allowed THEN
    RAISE EXCEPTION 'Illegal household rotation-job transition: % -> %', v_job.status, p_new_status;
  END IF;

  UPDATE public.household_key_rotation_jobs
     SET status       = p_new_status,
         completed_at = CASE WHEN p_new_status IN ('complete','aborted','rolled_back')
                             THEN now() ELSE completed_at END
   WHERE id = p_job_id;

  INSERT INTO public.vault_security_events (user_id, event, metadata)
  VALUES (
    v_job.started_by,
    'household_rekey.status_changed',
    jsonb_build_object(
      'job_id',       p_job_id,
      'household_id', v_job.household_id,
      'from_status',  v_job.status,
      'to_status',    p_new_status,
      'trigger',      v_job.trigger_type,
      'mode',         v_job.refresh_mode
    )
  );
END;
$$;

COMMENT ON FUNCTION public.advance_household_rotation_job(UUID, TEXT) IS
  'Phase 4.5: validate + apply a household_key_rotation_jobs state '
  'transition. Writes a household_rekey.status_changed audit event on '
  'every legal transition.';


-- ══════════════════════════════════════════════════════════════════════
-- 8. purge_expired_old_household_key_wraps() — 30-day cleanup sweep
-- ══════════════════════════════════════════════════════════════════════
--
-- For every completed job whose rollback_expires_at < now(): delete the
-- previous-version wraps (household_keys at previous_dek_key_version),
-- then clear previous_dek_key_version + rollback_expires_at on the job
-- row so the sweep is idempotent.

CREATE OR REPLACE FUNCTION public.purge_expired_old_household_key_wraps()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
VOLATILE
AS $$
DECLARE
  v_purged_count INTEGER := 0;
  v_job          RECORD;
BEGIN
  FOR v_job IN
    SELECT id, household_id, previous_dek_key_version, started_by
      FROM public.household_key_rotation_jobs
     WHERE status = 'complete'
       AND rollback_expires_at IS NOT NULL
       AND rollback_expires_at < now()
       AND previous_dek_key_version IS NOT NULL
  LOOP
    DELETE FROM public.household_keys
     WHERE household_id = v_job.household_id
       AND key_version  = v_job.previous_dek_key_version;

    UPDATE public.household_key_rotation_jobs
       SET previous_dek_key_version = NULL,
           rollback_expires_at      = NULL
     WHERE id = v_job.id;

    INSERT INTO public.vault_security_events (user_id, event, metadata)
    VALUES (
      v_job.started_by,
      'household_rekey.old_wraps_purged',
      jsonb_build_object(
        'job_id',                 v_job.id,
        'household_id',           v_job.household_id,
        'purged_dek_key_version', v_job.previous_dek_key_version
      )
    );

    v_purged_count := v_purged_count + 1;
  END LOOP;

  RETURN v_purged_count;
END;
$$;

COMMENT ON FUNCTION public.purge_expired_old_household_key_wraps() IS
  'Phase 4.5: clear previous-version household DEK wraps once a '
  'rotation job is past its 30-day rollback window. Idempotent — safe '
  'to run daily or on-demand.';


-- ══════════════════════════════════════════════════════════════════════
-- 9. pg_cron schedule (guarded)
-- ══════════════════════════════════════════════════════════════════════
--
-- If pg_cron is enabled, schedule the purge daily at 03:23 UTC. If the
-- extension is not available the guard silently skips; the
-- scheduled-function fallback is documented in the deploy notes.

DO $$
DECLARE
  v_existing_jobid BIGINT;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    SELECT jobid INTO v_existing_jobid
      FROM cron.job
     WHERE jobname = 'purge-expired-old-household-key-wraps'
     LIMIT 1;
    IF v_existing_jobid IS NOT NULL THEN
      PERFORM cron.unschedule(v_existing_jobid);
    END IF;

    PERFORM cron.schedule(
      'purge-expired-old-household-key-wraps',
      '23 3 * * *',
      $CRON$SELECT public.purge_expired_old_household_key_wraps()$CRON$
    );

    RAISE NOTICE 'Phase 4.5: scheduled purge_expired_old_household_key_wraps daily at 03:23 UTC via pg_cron.';
  ELSE
    RAISE NOTICE 'Phase 4.5: pg_cron not enabled — schedule purge-expired-old-household-key-wraps via Supabase scheduled function.';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Phase 4.5: pg_cron scheduling skipped (%).', SQLERRM;
END;
$$;


COMMIT;

-- ════════════════════════════════════════════════════════════════════
-- POST-MIGRATION:
--   1. Deploy edge functions: start-household-rekey-job (new),
--      household-rekey-batch (new), finalize-household-rekey (new),
--      abort-household-rekey (new). Patch whichever invite edge
--      function wraps the household DEK to probe
--      household_active_key_versions + stamp is_placeholder.
--   2. If pg_cron is not available, schedule a Supabase scheduled
--      function to POST to purge-expired-old-household-key-wraps
--      every 24h (daily is fine — nothing urgent happens at the
--      30-day mark).
-- ════════════════════════════════════════════════════════════════════
