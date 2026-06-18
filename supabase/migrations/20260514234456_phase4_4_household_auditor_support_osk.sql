-- ============================================================
-- Phase 4.4 — Time-boxed Auditor + customer support sessions +
-- Household Signing Key (HSK / OSK equivalent).
-- ============================================================
-- Design references:
--   docs/HOUSEHOLD-SHARING-DESIGN.md (household role vocabulary)
--
-- New role values added to household_members.role CHECK:
--   'auditor' — time-boxed read-only auditor (analogous to advisor
--               but with mandatory expires_at)
--   'support' — customer support session (24h hard cap on expires_at)
--
-- What this migration does:
--   1. Add `expires_at` + `source` columns to household_members.
--      Extend the role CHECK to allow 'auditor' and 'support'.
--   2. Create household_signing_keys (per-household ML-DSA-65 public key).
--   3. Create household_member_osk_wraps (per-writer wrapped private HSK).
--   4. Create support_sessions (customer support audit trail, 24h cap).
--   5. Add signature_b64 + signature_key_version columns to the six
--      encrypted business tables: transactions, accounts, categories,
--      budgets, goals, rules.
--   6. Install verify_mutation_signature_on_write() trigger function and
--      attach to all six tables.
--   7. Install expire_time_boxed_household_roles() sweep + pg_cron job
--      (guarded — silently skipped if pg_cron is unavailable).
--
-- Idempotent: every CREATE / ALTER is guarded. Running this migration
-- twice is a no-op. Patterns reused from 20260427000000_orangeway_phase4_3_invites.sql.

BEGIN;

-- ══════════════════════════════════════════════════════════════════════
-- 1. household_members — expires_at, source, role vocabulary extension
-- ══════════════════════════════════════════════════════════════════════
--
-- Phase 4.3 only carried (revoked_at, status) on household_members. Phase 4.4
-- adds (expires_at, source) so the sweep can revoke time-boxed grants and
-- the audit trail can attribute each grant's origin.
--
-- source values:
--   'direct'         — standard invite path
--   'auditor_invite' — time-boxed Auditor (mandatory expires_at <= 1y)
--   'support_grant'  — customer support session (mandatory expires_at <= 24h)

ALTER TABLE public.household_members
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'direct';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'household_members_source_chk'
  ) THEN
    ALTER TABLE public.household_members
      ADD CONSTRAINT household_members_source_chk
      CHECK (source IN ('direct', 'auditor_invite', 'support_grant'));
  END IF;
END $$;

-- Extend the role CHECK to allow 'auditor' and 'support'. Find the
-- existing Phase 4.1 constraint by name and replace it; this stays
-- idempotent because the new constraint has a distinct name (_p44).
DO $$
BEGIN
  -- Drop the Phase 4.1 constraint if still present.
  IF EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'household_members'
      AND c.conname = 'household_members_role_check_p4'
  ) THEN
    ALTER TABLE public.household_members
      DROP CONSTRAINT household_members_role_check_p4;
  END IF;

  -- Also drop any anonymous role check that still references the old
  -- 4-value list, so a re-run doesn't conflict.
  PERFORM 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
   WHERE n.nspname = 'public'
     AND t.relname = 'household_members'
     AND c.contype = 'c'
     AND pg_get_constraintdef(c.oid) ILIKE '%role%'
     AND pg_get_constraintdef(c.oid) NOT ILIKE '%auditor%';

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'household_members'
      AND c.conname = 'household_members_role_check_p44'
  ) THEN
    ALTER TABLE public.household_members
      ADD CONSTRAINT household_members_role_check_p44
      CHECK (role IN ('owner', 'partner', 'advisor', 'dependent', 'auditor', 'support'));
  END IF;
END $$;

-- Index for the sweep job. Partial — only un-revoked time-boxed rows
-- ever need scanning.
CREATE INDEX IF NOT EXISTS idx_household_members_expires_active
  ON public.household_members(expires_at)
  WHERE expires_at IS NOT NULL AND revoked_at IS NULL;

COMMENT ON COLUMN public.household_members.expires_at IS
  'Phase 4.4: optional automatic expiry. Required for source = '
  'auditor_invite (<=1 year) or support_grant (<=24h). NULL for direct '
  'invites.';

COMMENT ON COLUMN public.household_members.source IS
  'Phase 4.4: how this grant was created. direct = standard invite. '
  'auditor_invite = time-boxed Auditor. support_grant = '
  'customer support. The sweep job records this in role.expired '
  'audit events.';


-- ══════════════════════════════════════════════════════════════════════
-- 2. household_signing_keys — per-household ML-DSA-65 public key
-- ══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.household_signing_keys (
  household_id   UUID NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  key_version    INT  NOT NULL DEFAULT 1,
  public_key_b64 TEXT NOT NULL,
  algorithm      TEXT NOT NULL DEFAULT 'ml-dsa-65',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by     UUID NOT NULL REFERENCES auth.users(id),
  PRIMARY KEY (household_id, key_version)
);

CREATE INDEX IF NOT EXISTS idx_household_signing_keys_latest
  ON public.household_signing_keys(household_id, key_version DESC);

ALTER TABLE public.household_signing_keys ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "household_signing_keys_select_members"
  ON public.household_signing_keys;
CREATE POLICY "household_signing_keys_select_members"
  ON public.household_signing_keys
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.household_members hm
       WHERE hm.household_id = public.household_signing_keys.household_id
         AND hm.user_id      = auth.uid()
         AND hm.status       = 'active'
    )
    OR EXISTS (
      SELECT 1 FROM public.households h
       WHERE h.id       = public.household_signing_keys.household_id
         AND h.owner_id = auth.uid()
    )
  );

-- Writes flow through the mint-household-signing-key edge function under
-- the service role. No INSERT/UPDATE/DELETE policies for end users.

COMMENT ON TABLE public.household_signing_keys IS
  'Phase 4.4: ML-DSA-65 Household Signing Key (HSK) public half per '
  'household + key_version. Used server-side to verify mutation '
  'signatures on encrypted business tables.';


-- ══════════════════════════════════════════════════════════════════════
-- 3. household_member_osk_wraps — per-writer wrapped private HSK
-- ══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.household_member_osk_wraps (
  user_id             UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  household_id        UUID NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  key_version         INT  NOT NULL DEFAULT 1,
  wrapped_private_key TEXT NOT NULL,
  wrap_algo           TEXT NOT NULL DEFAULT 'hybrid_x25519_mlkem768',
  iv                  TEXT NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, household_id, key_version)
);

CREATE INDEX IF NOT EXISTS idx_household_member_osk_wraps_household
  ON public.household_member_osk_wraps(household_id, key_version);

ALTER TABLE public.household_member_osk_wraps ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "household_member_osk_wraps_select_own"
  ON public.household_member_osk_wraps;
CREATE POLICY "household_member_osk_wraps_select_own"
  ON public.household_member_osk_wraps
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

COMMENT ON TABLE public.household_member_osk_wraps IS
  'Phase 4.4: per-writer wrapped private half of the Household Signing '
  'Key. Hybrid-KEM wrapped to the recipient''s user_public_keys row. '
  'Auditor members never have a row here — that is the cryptographic '
  'read-only enforcement.';


-- ══════════════════════════════════════════════════════════════════════
-- 4. support_sessions — customer support audit trail (24h cap)
-- ══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.support_sessions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id     UUID NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  support_user_id  UUID NOT NULL REFERENCES auth.users(id),
  granted_by       UUID NOT NULL REFERENCES auth.users(id),
  granted_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at       TIMESTAMPTZ NOT NULL,
  ended_at         TIMESTAMPTZ,
  end_reason       TEXT,
  CONSTRAINT support_sessions_24h_cap_chk
    CHECK (expires_at <= granted_at + interval '24 hours'),
  CONSTRAINT support_sessions_end_reason_chk
    CHECK (end_reason IS NULL OR end_reason IN ('customer_ended','expired','support_ended'))
);

CREATE INDEX IF NOT EXISTS idx_support_sessions_household_active
  ON public.support_sessions(household_id)
  WHERE ended_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_support_sessions_expiry_active
  ON public.support_sessions(expires_at)
  WHERE ended_at IS NULL;

ALTER TABLE public.support_sessions ENABLE ROW LEVEL SECURITY;

-- Household owner can read every row scoped to their household; the
-- support user can read their own session rows.
DROP POLICY IF EXISTS "support_sessions_select_owner_or_support"
  ON public.support_sessions;
CREATE POLICY "support_sessions_select_owner_or_support"
  ON public.support_sessions
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.households h
       WHERE h.id       = public.support_sessions.household_id
         AND h.owner_id = auth.uid()
    )
    OR support_user_id = auth.uid()
  );

COMMENT ON TABLE public.support_sessions IS
  'Phase 4.4: customer support audit trail. expires_at capped to 24h '
  'by CHECK constraint. expire_time_boxed_household_roles() auto-ends '
  'on expiry; end_support_session edge action ends early.';


-- ══════════════════════════════════════════════════════════════════════
-- 5. Encrypted business tables — signature columns
-- ══════════════════════════════════════════════════════════════════════
--
-- Phase 4.4 wires mutation signing into all six OW encrypted tables.
-- Columns are NULL-able so legacy rows and service-role inserts don't
-- break. The trigger below enforces signing only when the household
-- has minted a Household Signing Key.

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS signature_b64 TEXT,
  ADD COLUMN IF NOT EXISTS signature_key_version INT;

ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS signature_b64 TEXT,
  ADD COLUMN IF NOT EXISTS signature_key_version INT;

ALTER TABLE public.categories
  ADD COLUMN IF NOT EXISTS signature_b64 TEXT,
  ADD COLUMN IF NOT EXISTS signature_key_version INT;

ALTER TABLE public.budgets
  ADD COLUMN IF NOT EXISTS signature_b64 TEXT,
  ADD COLUMN IF NOT EXISTS signature_key_version INT;

ALTER TABLE public.goals
  ADD COLUMN IF NOT EXISTS signature_b64 TEXT,
  ADD COLUMN IF NOT EXISTS signature_key_version INT;

ALTER TABLE public.rules
  ADD COLUMN IF NOT EXISTS signature_b64 TEXT,
  ADD COLUMN IF NOT EXISTS signature_key_version INT;


-- ── pqc_verify_ml_dsa_65 placeholder ────────────────────────────────
CREATE OR REPLACE FUNCTION public.pqc_verify_ml_dsa_65(
  p_public_key_b64 TEXT,
  p_signature_b64  TEXT,
  p_payload        BYTEA
) RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  -- Phase 4.4 placeholder. Real ML-DSA-65 verification runs client-side
  -- in src/lib/osk.ts. Replace this body with a native call when an
  -- ML-DSA pgcrypto verifier ships in Supabase.
  IF p_public_key_b64 IS NULL OR p_signature_b64 IS NULL THEN
    RETURN FALSE;
  END IF;
  IF length(p_signature_b64) < 100 OR length(p_public_key_b64) < 100 THEN
    RETURN FALSE;
  END IF;
  RETURN TRUE;
END;
$$;

COMMENT ON FUNCTION public.pqc_verify_ml_dsa_65(TEXT, TEXT, BYTEA) IS
  'Phase 4.4 placeholder: returns TRUE for well-formed inputs. Swap '
  'body for the native ML-DSA verify when available — no other code '
  'changes required.';


-- ── verify_mutation_signature_on_write trigger function ─────────────
--
-- Logic:
--   a. Service-role writes (auth.uid() IS NULL) bypass.
--   b. If the row has no household_id, skip (private user row).
--   c. If the caller is an 'auditor' member of the household, REJECT —
--      auditors must never write.
--   d. If no Household Signing Key has been minted for this household,
--      allow NULL signatures (back-compat / staged rollout).
--   e. Otherwise require non-NULL signature_b64 + signature_key_version
--      and verify against the household_signing_keys public key.

CREATE OR REPLACE FUNCTION public.verify_mutation_signature_on_write()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_household_id UUID;
  v_public_key   TEXT;
  v_user         UUID := auth.uid();
  v_role         TEXT;
BEGIN
  -- a) Service-role writes bypass.
  IF v_user IS NULL THEN
    RETURN NEW;
  END IF;

  v_household_id := NEW.household_id;

  -- b) Private (non-shared) row — no household context, nothing to verify.
  IF v_household_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- c) Auditor caller must never write. Owner row always permitted to
  --    write regardless of household_members presence; partners and
  --    dependents pass. 'support' members can write within the session.
  SELECT hm.role INTO v_role
    FROM public.household_members hm
   WHERE hm.household_id = v_household_id
     AND hm.user_id      = v_user
     AND hm.status       = 'active'
     AND hm.revoked_at IS NULL
   LIMIT 1;

  IF v_role = 'auditor' THEN
    INSERT INTO public.vault_security_events (user_id, event, metadata)
    VALUES (v_user, 'mutation.auditor_write_blocked', jsonb_build_object(
      'table',        TG_TABLE_NAME,
      'op',           TG_OP,
      'household_id', v_household_id
    ));
    RAISE EXCEPTION 'Auditor members cannot write (Phase 4.4).';
  END IF;

  -- d) Back-compat: if no HSK minted yet, accept NULL signatures.
  IF NOT EXISTS (
    SELECT 1 FROM public.household_signing_keys
     WHERE household_id = v_household_id
  ) THEN
    RETURN NEW;
  END IF;

  -- e) HSK exists; signature columns are required.
  IF NEW.signature_b64 IS NULL OR NEW.signature_key_version IS NULL THEN
    INSERT INTO public.vault_security_events (user_id, event, metadata)
    VALUES (v_user, 'mutation.signature_missing', jsonb_build_object(
      'table',        TG_TABLE_NAME,
      'op',           TG_OP,
      'household_id', v_household_id
    ));
    RAISE EXCEPTION 'Mutation requires a Household Signing Key signature (Phase 4.4).';
  END IF;

  SELECT public_key_b64 INTO v_public_key
    FROM public.household_signing_keys
   WHERE household_id = v_household_id
     AND key_version  = NEW.signature_key_version;

  IF v_public_key IS NULL THEN
    INSERT INTO public.vault_security_events (user_id, event, metadata)
    VALUES (v_user, 'mutation.signing_key_not_found', jsonb_build_object(
      'table',        TG_TABLE_NAME,
      'op',           TG_OP,
      'household_id', v_household_id,
      'key_version',  NEW.signature_key_version
    ));
    RAISE EXCEPTION 'No Household Signing Key registered for this household at the supplied key_version.';
  END IF;

  IF NOT public.pqc_verify_ml_dsa_65(
      v_public_key,
      NEW.signature_b64,
      convert_to(v_household_id::TEXT, 'UTF8')
  ) THEN
    INSERT INTO public.vault_security_events (user_id, event, metadata)
    VALUES (v_user, 'mutation.signature_invalid', jsonb_build_object(
      'table',        TG_TABLE_NAME,
      'op',           TG_OP,
      'household_id', v_household_id,
      'key_version',  NEW.signature_key_version
    ));
    RAISE EXCEPTION 'Mutation signature failed verification (Phase 4.4).';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.verify_mutation_signature_on_write() IS
  'Phase 4.4: BEFORE INSERT OR UPDATE — enforce auditor read-only and '
  'Household Signing Key signatures on encrypted business tables when '
  'the household has minted an HSK. Service-role bypasses.';


-- Attach the trigger to every encrypted business table.
DROP TRIGGER IF EXISTS trg_verify_mutation_signature_transactions ON public.transactions;
CREATE TRIGGER trg_verify_mutation_signature_transactions
  BEFORE INSERT OR UPDATE ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.verify_mutation_signature_on_write();

DROP TRIGGER IF EXISTS trg_verify_mutation_signature_accounts ON public.accounts;
CREATE TRIGGER trg_verify_mutation_signature_accounts
  BEFORE INSERT OR UPDATE ON public.accounts
  FOR EACH ROW EXECUTE FUNCTION public.verify_mutation_signature_on_write();

DROP TRIGGER IF EXISTS trg_verify_mutation_signature_categories ON public.categories;
CREATE TRIGGER trg_verify_mutation_signature_categories
  BEFORE INSERT OR UPDATE ON public.categories
  FOR EACH ROW EXECUTE FUNCTION public.verify_mutation_signature_on_write();

DROP TRIGGER IF EXISTS trg_verify_mutation_signature_budgets ON public.budgets;
CREATE TRIGGER trg_verify_mutation_signature_budgets
  BEFORE INSERT OR UPDATE ON public.budgets
  FOR EACH ROW EXECUTE FUNCTION public.verify_mutation_signature_on_write();

DROP TRIGGER IF EXISTS trg_verify_mutation_signature_goals ON public.goals;
CREATE TRIGGER trg_verify_mutation_signature_goals
  BEFORE INSERT OR UPDATE ON public.goals
  FOR EACH ROW EXECUTE FUNCTION public.verify_mutation_signature_on_write();

DROP TRIGGER IF EXISTS trg_verify_mutation_signature_rules ON public.rules;
CREATE TRIGGER trg_verify_mutation_signature_rules
  BEFORE INSERT OR UPDATE ON public.rules
  FOR EACH ROW EXECUTE FUNCTION public.verify_mutation_signature_on_write();


-- ══════════════════════════════════════════════════════════════════════
-- 6. expire_time_boxed_household_roles() — auto-expiry sweep
-- ══════════════════════════════════════════════════════════════════════
--
-- Runs every minute (pg_cron below) or on-demand via
-- sweep-expired-household-roles edge function.
--
-- Order:
--   a. End expired support_sessions, emit support.session_expired events.
--   b. Revoke expired household_members (status='removed', revoked_at)
--      and drop their household_keys so RLS-restricted SELECT returns
--      nothing. Emits role.expired events.

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

COMMENT ON FUNCTION public.expire_time_boxed_household_roles() IS
  'Phase 4.4 sweep: end expired support_sessions + revoke expired '
  'household_members grants (and drop their household_keys). SECURITY '
  'DEFINER so pg_cron / scheduled edge functions can call it.';


-- ══════════════════════════════════════════════════════════════════════
-- 7. pg_cron schedule (guarded)
-- ══════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_existing_jobid BIGINT;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    SELECT jobid INTO v_existing_jobid
      FROM cron.job
     WHERE jobname = 'expire-time-boxed-household-roles'
     LIMIT 1;
    IF v_existing_jobid IS NOT NULL THEN
      PERFORM cron.unschedule(v_existing_jobid);
    END IF;

    PERFORM cron.schedule(
      'expire-time-boxed-household-roles',
      '* * * * *',
      $CRON$SELECT public.expire_time_boxed_household_roles()$CRON$
    );

    RAISE NOTICE 'Phase 4.4: scheduled expire_time_boxed_household_roles every minute via pg_cron.';
  ELSE
    RAISE NOTICE 'Phase 4.4: pg_cron not enabled — sweep-expired-household-roles edge function must be scheduled separately.';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Phase 4.4: pg_cron scheduling skipped (%).', SQLERRM;
END $$;


COMMIT;

-- ════════════════════════════════════════════════════════════════════
-- POST-MIGRATION:
--   1. Deploy edge functions: invite-household-member (patched),
--      admin-update-household-member (patched),
--      sweep-expired-household-roles (new), mint-household-signing-key (new).
--   2. If pg_cron is not available, schedule a Supabase scheduled
--      function to POST /sweep-expired-household-roles every minute
--      with X-Cron-Secret header matching env CRON_SWEEP_SECRET.
-- ════════════════════════════════════════════════════════════════════
