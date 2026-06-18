-- P2 fixes from 2026-05-27 audit:
--   1. expire_time_boxed_household_roles() now also DELETEs the expired
--      member's household_member_osk_wraps row. Without this, the wrapped
--      private HSK for the expired writer stayed on disk indefinitely.
--      RLS still hides it (select_own), but it's stale state we should
--      reap when the rest of the member's access is torn down.
--   2. household_key_rotation_jobs added to supabase_realtime publication.
--      HouseholdMaintenanceBanner.tsx subscribes via .channel('postgres_changes')
--      on this table, but the table was never in the publication, so realtime
--      events never fired. UI silently stayed stale during rekey jobs.
--
-- Both safe to re-apply.

BEGIN;

CREATE OR REPLACE FUNCTION public.expire_time_boxed_household_roles()
RETURNS TABLE (expired_roles INTEGER, expired_sessions INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
VOLATILE
AS $$
DECLARE
  v_role_count    INTEGER := 0;
  v_session_count INTEGER := 0;
  v_now           TIMESTAMPTZ := now();
  v_row           RECORD;
BEGIN
  -- a) Expire support_sessions.
  FOR v_row IN
    UPDATE public.support_sessions
       SET ended_at   = expires_at,
           end_reason = 'expired'
     WHERE expires_at < v_now
       AND ended_at IS NULL
    RETURNING id, household_id, support_user_id, granted_by
  LOOP
    v_session_count := v_session_count + 1;
    INSERT INTO public.vault_security_events (user_id, event, metadata)
    VALUES (
      v_row.support_user_id,
      'support.session_expired',
      jsonb_build_object(
        'household_id', v_row.household_id,
        'session_id',   v_row.id,
        'granted_by',   v_row.granted_by
      )
    );
  END LOOP;

  -- b) Revoke expired time-boxed household_members.
  FOR v_row IN
    UPDATE public.household_members
       SET revoked_at = expires_at,
           status     = 'removed'
     WHERE expires_at IS NOT NULL
       AND expires_at < v_now
       AND revoked_at IS NULL
    RETURNING id, household_id, user_id, role, source, expires_at
  LOOP
    v_role_count := v_role_count + 1;

    -- Drop the wrapped household DEK so RLS-restricted SELECT cannot
    -- return key material to the expired member.
    DELETE FROM public.household_keys
     WHERE household_id = v_row.household_id
       AND user_id      = v_row.user_id;

    -- Also drop the per-writer wrapped private HSK. Without this the
    -- osk_wraps row outlives the role; harmless behind RLS but stale.
    DELETE FROM public.household_member_osk_wraps
     WHERE household_id = v_row.household_id
       AND user_id      = v_row.user_id;

    INSERT INTO public.vault_security_events (user_id, event, metadata)
    VALUES (
      v_row.user_id,
      'role.expired',
      jsonb_build_object(
        'household_id',        v_row.household_id,
        'role',                v_row.role,
        'source',              v_row.source,
        'original_expires_at', v_row.expires_at
      )
    );
  END LOOP;

  expired_roles    := v_role_count;
  expired_sessions := v_session_count;
  RETURN NEXT;
END;
$$;

-- Add to realtime publication (idempotent — checks pg_publication_tables first).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime'
       AND schemaname = 'public'
       AND tablename = 'household_key_rotation_jobs'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.household_key_rotation_jobs;
  END IF;
END $$;

COMMIT;
