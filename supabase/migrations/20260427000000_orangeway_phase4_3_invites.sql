-- ============================================================
-- Phase 4.3 — Email-based household invites,
-- pending-wrap pipeline, soft revoke, and public key visibility
-- for inviters.
-- ============================================================
-- Design references:
--   docs/HOUSEHOLD-SHARING-DESIGN.md §3 "Phase 4.3 — Invites + soft revoke"
--
-- What this migration does:
--   1. Adds wrap_algo column to household_keys so the per-recipient
--      hybrid wrap strategy is recorded alongside the ciphertext.
--   2. Extends household_invites with pending-wrap state-machine
--      columns (status, email, recipient_user_id, inviter_id,
--      ready_to_wrap_at, wrapped_at, revoked_at). The legacy code-
--      based invite path stays usable; the email-based Phase 4.3
--      path uses the same row but with status != 'code_only'.
--   3. Adds SELECT RLS on user_public_keys so a household Owner can
--      read a prospective member's public key client-side.
--   4. Installs a trigger on user_public_keys that flips matching
--      pending invites from awaiting_recipient to ready_to_wrap once
--      the recipient publishes their keypair, also writing a
--      vault_security_events audit row.
--   5. Idempotently renames household_active_key_versions.updated_at
--      to last_rotated_at if an older variant of the Phase 4.5
--      migration is still in place.
--
-- Idempotent: every CREATE / ALTER is guarded.

BEGIN;

-- ══════════════════════════════════════════════════════════════════════
-- 1. household_keys.wrap_algo
-- ══════════════════════════════════════════════════════════════════════

ALTER TABLE public.household_keys
  ADD COLUMN IF NOT EXISTS wrap_algo TEXT NOT NULL DEFAULT 'hybrid_x25519_mlkem768';

-- household_members soft-revoke marker. Phase 4.1 used status='removed'
-- alone; Phase 4.3 also captures the timestamp so the audit trail and
-- the post-remove "refresh security" prompt have a definitive event.
ALTER TABLE public.household_members
  ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ;

-- household_members uniqueness: invite/wrap upsert needs a stable
-- onConflict target. Add it idempotently.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'household_members'
      AND c.conname = 'household_members_household_user_unique'
  ) THEN
    BEGIN
      ALTER TABLE public.household_members
        ADD CONSTRAINT household_members_household_user_unique
        UNIQUE (household_id, user_id);
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'household_members unique add skipped: %', SQLERRM;
    END;
  END IF;
END $$;

COMMENT ON COLUMN public.household_keys.wrap_algo IS
  'Phase 4.3: wrap strategy identifier. Default hybrid_x25519_mlkem768. '
  'Recorded so Phase 4.5+ can introduce additional strategies without '
  'guessing which one wrapped any given row.';


-- ══════════════════════════════════════════════════════════════════════
-- 2. household_invites — extend with email + pending-wrap state
-- ══════════════════════════════════════════════════════════════════════
--
-- Lifecycle for email-based invites:
--   awaiting_recipient → invitee has no published keypair yet. Created
--                        by invite-household-member when no
--                        user_public_keys row exists for the email.
--   ready_to_wrap      → recipient published their keypair; the
--                        link_pending_household_invites trigger flipped
--                        this row. Owner client subscribes via realtime
--                        and finishes the wrap.
--   wrapped            → household_keys row inserted; the recipient
--                        has access.
--   expired            → expires_at passed without completion.
--   revoked            → owner cancelled before wrap completed.
--   code_only          → legacy code-based invite (no email tracked).

ALTER TABLE public.household_invites
  ADD COLUMN IF NOT EXISTS email TEXT,
  ADD COLUMN IF NOT EXISTS email_hash TEXT,
  ADD COLUMN IF NOT EXISTS recipient_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS inviter_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'code_only',
  ADD COLUMN IF NOT EXISTS ready_to_wrap_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS wrapped_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'household_invites'
      AND c.conname = 'household_invites_status_check_p43'
  ) THEN
    ALTER TABLE public.household_invites
      ADD CONSTRAINT household_invites_status_check_p43
      CHECK (status IN (
        'code_only',
        'awaiting_recipient',
        'ready_to_wrap',
        'wrapped',
        'expired',
        'revoked'
      ));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'household_invites'
      AND c.conname = 'household_invites_role_check_p43'
  ) THEN
    -- Phase 4.1 swapped household_members.role to the four-value
    -- vocabulary; widen household_invites.role to match (the legacy
    -- 'editor'/'viewer' strings already in production are accepted by
    -- the existing CHECK and are migrated to 'partner' on accept).
    -- We add a new constraint name so the migration is idempotent
    -- even if an older 'editor'/'viewer' check is still attached.
    BEGIN
      ALTER TABLE public.household_invites
        DROP CONSTRAINT IF EXISTS household_invites_role_check;
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    ALTER TABLE public.household_invites
      ADD CONSTRAINT household_invites_role_check_p43
      CHECK (role IN ('owner','partner','advisor','dependent','editor','viewer'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_household_invites_status_household
  ON public.household_invites(household_id, status);

CREATE INDEX IF NOT EXISTS idx_household_invites_email_lower
  ON public.household_invites(LOWER(email))
  WHERE email IS NOT NULL
    AND status IN ('awaiting_recipient','ready_to_wrap');

-- (household_id, email) uniqueness so invite-household-member can
-- upsert safely on re-invite. Partial — legacy code_only rows have
-- email=NULL and must be allowed to coexist.
CREATE UNIQUE INDEX IF NOT EXISTS ux_household_invites_household_email
  ON public.household_invites(household_id, LOWER(email))
  WHERE email IS NOT NULL;

-- Auto-touch wrapped_at on status flip.
CREATE OR REPLACE FUNCTION public.touch_household_invite_wrapped_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'wrapped' AND OLD.status IS DISTINCT FROM 'wrapped' THEN
    NEW.wrapped_at := COALESCE(NEW.wrapped_at, now());
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_household_invite_wrapped_at ON public.household_invites;
CREATE TRIGGER trg_household_invite_wrapped_at
  BEFORE UPDATE ON public.household_invites
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_household_invite_wrapped_at();

COMMENT ON COLUMN public.household_invites.status IS
  'Phase 4.3 lifecycle: code_only (legacy), awaiting_recipient, '
  'ready_to_wrap, wrapped, expired, revoked.';

COMMENT ON COLUMN public.household_invites.email IS
  'Phase 4.3: lower-cased recipient email. NULL for legacy code-only '
  'invites.';


-- ══════════════════════════════════════════════════════════════════════
-- 3. user_public_keys — SELECT policy for household inviters
-- ══════════════════════════════════════════════════════════════════════
--
-- Phase 4.1 only exposed user_public_keys rows to their owner. For
-- Phase 4.3 a household Owner needs to read a prospective member's
-- public key to run the hybrid-KEM wrap client-side. Public keys are
-- public by cryptographic design — exposing them to an inviter reveals
-- nothing extra.

DROP POLICY IF EXISTS "user_public_keys_select_for_inviters"
  ON public.user_public_keys;
CREATE POLICY "user_public_keys_select_for_inviters"
  ON public.user_public_keys
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
        FROM public.household_members hm
        JOIN public.households h ON h.id = hm.household_id
       WHERE hm.user_id = public.user_public_keys.user_id
         AND h.owner_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1
        FROM public.household_invites hi
        JOIN public.households h ON h.id = hi.household_id
       WHERE hi.recipient_user_id = public.user_public_keys.user_id
         AND h.owner_id = auth.uid()
    )
  );


-- ══════════════════════════════════════════════════════════════════════
-- 4. household_keys — INSERT policy for owners (Phase 4.3)
-- ══════════════════════════════════════════════════════════════════════
--
-- Phase 4.1 deliberately deferred INSERT/UPDATE policies to Phase 4.3.
-- We add them here so the createHousehold owner-self-wrap and the
-- complete-household-invite-wrap edge function can write rows. The
-- edge function uses the service role and bypasses RLS, but
-- createHousehold runs in the browser under the user's session, so
-- the policy must accept owner inserts.

DROP POLICY IF EXISTS "household_keys_insert_owner" ON public.household_keys;
CREATE POLICY "household_keys_insert_owner"
  ON public.household_keys
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.households h
       WHERE h.id = public.household_keys.household_id
         AND h.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "household_keys_update_owner" ON public.household_keys;
CREATE POLICY "household_keys_update_owner"
  ON public.household_keys
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.households h
       WHERE h.id = public.household_keys.household_id
         AND h.owner_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.households h
       WHERE h.id = public.household_keys.household_id
         AND h.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "household_keys_delete_owner" ON public.household_keys;
CREATE POLICY "household_keys_delete_owner"
  ON public.household_keys
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.households h
       WHERE h.id = public.household_keys.household_id
         AND h.owner_id = auth.uid()
    )
  );


-- ══════════════════════════════════════════════════════════════════════
-- 5. Trigger: flip pending invites to ready_to_wrap on keypair publish
-- ══════════════════════════════════════════════════════════════════════
--
-- When a user inserts their first user_public_keys row, any household
-- invites whose email matches transition from awaiting_recipient to
-- ready_to_wrap, and recipient_user_id is populated. Realtime
-- subscribers (Owner clients) pick this up and finish the wrap.
--
-- SECURITY DEFINER so the recipient cannot influence invite status by
-- any path other than legitimately publishing a keypair.

CREATE OR REPLACE FUNCTION public.link_pending_household_invites_on_keypair_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email     TEXT;
  v_inviter   UUID;
  v_household UUID;
BEGIN
  SELECT LOWER(email) INTO v_email
    FROM auth.users
   WHERE id = NEW.user_id;

  IF v_email IS NULL THEN
    RETURN NEW;
  END IF;

  FOR v_inviter, v_household IN
    UPDATE public.household_invites
       SET status            = 'ready_to_wrap',
           recipient_user_id = NEW.user_id,
           ready_to_wrap_at  = now()
     WHERE LOWER(email) = v_email
       AND status = 'awaiting_recipient'
       AND expires_at > now()
   RETURNING inviter_id, household_id
  LOOP
    INSERT INTO public.vault_security_events (user_id, event, metadata)
    VALUES (
      COALESCE(v_inviter, NEW.user_id),
      'household_member.wrap_ready',
      jsonb_build_object(
        'household_id',      v_household,
        'recipient_user_id', NEW.user_id,
        'source',            'keypair_insert_trigger'
      )
    );
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_link_pending_household_invites_on_keypair
  ON public.user_public_keys;
CREATE TRIGGER trg_link_pending_household_invites_on_keypair
  AFTER INSERT ON public.user_public_keys
  FOR EACH ROW
  EXECUTE FUNCTION public.link_pending_household_invites_on_keypair_insert();

COMMENT ON FUNCTION public.link_pending_household_invites_on_keypair_insert() IS
  'Phase 4.3: AFTER INSERT on user_public_keys, transition matching '
  'household_invites rows from awaiting_recipient to ready_to_wrap.';


-- ══════════════════════════════════════════════════════════════════════
-- 6. household_active_key_versions column rename fix-up (idempotent)
-- ══════════════════════════════════════════════════════════════════════
--
-- An older variant of the Phase 4.5 migration named the timestamp
-- column updated_at. The authoritative name is last_rotated_at.
-- Rename it if the older form is still in place so the
-- finalize-household-rekey edge function and household-rekey.ts client
-- can rely on the canonical name.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'household_active_key_versions'
       AND column_name = 'updated_at'
  ) THEN
    ALTER TABLE public.household_active_key_versions
      RENAME COLUMN updated_at TO last_rotated_at;
  END IF;
END $$;


COMMIT;

-- ════════════════════════════════════════════════════════════════════
-- POST-MIGRATION:
--   1. Deploy edge functions: invite-household-member,
--      complete-household-invite-wrap, admin-update-household-member.
--   2. Confirm Realtime is enabled on public.household_invites
--      (Supabase Studio → Database → Replication).
-- ════════════════════════════════════════════════════════════════════
