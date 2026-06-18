-- Phase 4.5 — Household refresh: resumable rotation jobs, version columns on shared tables, 30-day rollback window, auto-purge.

BEGIN;

CREATE TABLE IF NOT EXISTS public.household_key_rotation_jobs (
  id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id               UUID NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  status                     TEXT NOT NULL DEFAULT 'pending'
                              CHECK (status IN (
                                'pending','generating_keys','wrapping_members','rekeying_rows',
                                'finalizing','complete','aborted','rolled_back'
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

CREATE UNIQUE INDEX IF NOT EXISTS ux_household_key_rotation_jobs_single_active
  ON public.household_key_rotation_jobs(household_id)
  WHERE status NOT IN ('complete','aborted','rolled_back');

CREATE INDEX IF NOT EXISTS idx_household_key_rotation_jobs_household_started
  ON public.household_key_rotation_jobs(household_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_household_key_rotation_jobs_rollback_window
  ON public.household_key_rotation_jobs(rollback_expires_at)
  WHERE status = 'complete' AND rollback_expires_at IS NOT NULL;

ALTER TABLE public.household_key_rotation_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "household_key_rotation_jobs_select_members" ON public.household_key_rotation_jobs;
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

DROP POLICY IF EXISTS "household_key_rotation_jobs_insert_owner" ON public.household_key_rotation_jobs;
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

DROP POLICY IF EXISTS "household_key_rotation_jobs_update_owner" ON public.household_key_rotation_jobs;
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

-- 2. household_active_key_versions
CREATE TABLE IF NOT EXISTS public.household_active_key_versions (
  household_id            UUID PRIMARY KEY REFERENCES public.households(id) ON DELETE CASCADE,
  active_dek_key_version  INT NOT NULL DEFAULT 1,
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.household_active_key_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "household_active_key_versions_select_members" ON public.household_active_key_versions;
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

INSERT INTO public.household_active_key_versions (household_id, active_dek_key_version)
SELECT h.id, 1
  FROM public.households h
 WHERE NOT EXISTS (
   SELECT 1 FROM public.household_active_key_versions a
    WHERE a.household_id = h.id
 );

-- 3. household_keys.is_placeholder
ALTER TABLE public.household_keys
  ADD COLUMN IF NOT EXISTS is_placeholder BOOLEAN NOT NULL DEFAULT FALSE;

-- 4. dek_key_version on shared tables
DO $$
DECLARE
  t TEXT;
  tables TEXT[] := ARRAY['transactions','accounts','categories','budgets','goals','rules'];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = t) THEN
      EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS dek_key_version INT NOT NULL DEFAULT 1', t);
    END IF;
  END LOOP;
END;
$$;

-- 5. user_last_seen_household_key_versions
CREATE TABLE IF NOT EXISTS public.user_last_seen_household_key_versions (
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  household_id    UUID NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  dek_key_version INT NOT NULL DEFAULT 1,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, household_id)
);

ALTER TABLE public.user_last_seen_household_key_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_last_seen_household_select_own" ON public.user_last_seen_household_key_versions;
CREATE POLICY "user_last_seen_household_select_own"
  ON public.user_last_seen_household_key_versions
  FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS "user_last_seen_household_insert_own" ON public.user_last_seen_household_key_versions;
CREATE POLICY "user_last_seen_household_insert_own"
  ON public.user_last_seen_household_key_versions
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "user_last_seen_household_update_own" ON public.user_last_seen_household_key_versions;
CREATE POLICY "user_last_seen_household_update_own"
  ON public.user_last_seen_household_key_versions
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- 6. pending_admin_emails
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

CREATE INDEX IF NOT EXISTS idx_pending_admin_emails_unsent
  ON public.pending_admin_emails(queued_at) WHERE sent_at IS NULL;

-- 7. advance_household_rotation_job()
CREATE OR REPLACE FUNCTION public.advance_household_rotation_job(
  p_job_id UUID, p_new_status TEXT
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_job     RECORD;
  v_allowed BOOLEAN := FALSE;
BEGIN
  SELECT * INTO v_job FROM public.household_key_rotation_jobs WHERE id = p_job_id FOR UPDATE;
  IF v_job IS NULL THEN
    RAISE EXCEPTION 'Household rotation job % not found', p_job_id;
  END IF;

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
      'job_id', p_job_id,
      'household_id', v_job.household_id,
      'from_status', v_job.status,
      'to_status', p_new_status
    )
  );
END;
$$;

-- 8. purge_expired_old_household_key_wraps()
CREATE OR REPLACE FUNCTION public.purge_expired_old_household_key_wraps()
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
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
        'job_id', v_job.id,
        'household_id', v_job.household_id,
        'purged_dek_key_version', v_job.previous_dek_key_version
      )
    );

    v_purged_count := v_purged_count + 1;
  END LOOP;

  RETURN v_purged_count;
END;
$$;

-- 9. pg_cron schedule (guarded)
DO $$
DECLARE
  v_existing_jobid BIGINT;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    SELECT jobid INTO v_existing_jobid FROM cron.job
     WHERE jobname = 'purge-expired-old-household-key-wraps' LIMIT 1;
    IF v_existing_jobid IS NOT NULL THEN
      PERFORM cron.unschedule(v_existing_jobid);
    END IF;
    PERFORM cron.schedule(
      'purge-expired-old-household-key-wraps',
      '23 3 * * *',
      $CRON$SELECT public.purge_expired_old_household_key_wraps()$CRON$
    );
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Phase 4.5: pg_cron scheduling skipped (%).', SQLERRM;
END;
$$;

COMMIT;