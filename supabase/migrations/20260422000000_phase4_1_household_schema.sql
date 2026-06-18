-- ============================================================
-- Phase 4.1 — Household schema + keypair lifecycle
-- ============================================================
-- Extends the existing 2026-04-18 household scaffold with the
-- multi-user primitives needed for Phase 4 household sharing.
-- Nothing about the existing households / household_members /
-- household_invites tables is being dropped — they already use
-- enc_name (ZKA-correct) and only need the role CHECK updated to
-- the Phase 4 vocabulary.
--
-- Design references:
--   docs/HOUSEHOLD-SHARING-DESIGN.md §3 (schema), §10 (decisions locked)
--
-- What this migration does NOT do (deliberately — future phases):
--   * Seed any household / member / key rows (4.2+)
--   * Add INSERT/UPDATE policies on household_keys beyond SELECT (4.3)
--   * Rewrite household_invites to the PQC wrap flow (4.3)
--   * Ship the `scope = 'author_only'` per-row re-wrap UX (v1.5)
--
-- Safety: every CREATE is `IF NOT EXISTS`; every ALTER column is
-- guarded with `IF NOT EXISTS`. Running this migration twice is a
-- no-op. The household_members role CHECK swap is wrapped in a
-- DO block so existing rows get migrated before the new constraint
-- is applied.

-- ── user_public_keys ─────────────────────────────────────────────────
-- Per-user hybrid KEM public key. Shared across all households for a
-- given user (Decision: one master keypair per user, v1 — see
-- HOUSEHOLD-SHARING-DESIGN.md §10 "Master keypair architecture").
--
-- Public half only; plaintext is fine. The MEK-wrapped private half
-- lives in vault_metadata.enc_private_key (see below).
--
-- algorithm column ships as x25519-mlkem768-v1 (X25519 classical half
-- concatenated with ML-KEM-768 post-quantum half, HKDF-SHA-256
-- combiner). See src/lib/pqc.ts for the byte-length constants.
CREATE TABLE IF NOT EXISTS public.user_public_keys (
  user_id        UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  algorithm      TEXT NOT NULL DEFAULT 'x25519-mlkem768-v1',
  public_key_b64 TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.user_public_keys ENABLE ROW LEVEL SECURITY;

-- The owner of the row can see and maintain it. Phase 4.3 will add a
-- SELECT policy that lets a household Owner read a prospective
-- Partner's public key in order to wrap the household DEK for them.
DROP POLICY IF EXISTS "user_public_keys_select_own" ON public.user_public_keys;
CREATE POLICY "user_public_keys_select_own"
  ON public.user_public_keys
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "user_public_keys_insert_own" ON public.user_public_keys;
CREATE POLICY "user_public_keys_insert_own"
  ON public.user_public_keys
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "user_public_keys_update_own" ON public.user_public_keys;
CREATE POLICY "user_public_keys_update_own"
  ON public.user_public_keys
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

COMMENT ON TABLE public.user_public_keys IS
  'Phase 4.1: per-user hybrid KEM public key (X25519 + ML-KEM-768). '
  'Plaintext column — public keys do not need to be hidden. '
  'Private half is MEK-wrapped in vault_metadata.enc_private_key.';

COMMENT ON COLUMN public.user_public_keys.public_key_b64 IS
  'Base64 of concat(x25519_pub[32], mlkem768_pub[1184]) = 1216 bytes.';

COMMENT ON COLUMN public.user_public_keys.algorithm IS
  'Algorithm identifier; bump when changing KEM combiner or adding '
  'ML-DSA signing half in a future phase.';

-- ── vault_metadata.enc_private_key ───────────────────────────────────
-- MEK-wrapped hybrid secret key (AES-256-GCM, IV-prefixed ciphertext,
-- base64). Co-located with the existing per-user vault_metadata row so
-- every user has exactly one private-key wrap and the row count cannot
-- drift. Atomic UPDATE on password change (see
-- HOUSEHOLD-SHARING-DESIGN.md §10 "Password change does NOT re-encrypt
-- household DEK").
ALTER TABLE public.vault_metadata
  ADD COLUMN IF NOT EXISTS enc_private_key TEXT;

COMMENT ON COLUMN public.vault_metadata.enc_private_key IS
  'Phase 4.1: MEK-wrapped hybrid KEM secret key (2432 bytes). '
  'AES-256-GCM with HKDF-derived subkey. Re-wrapped via atomic UPDATE '
  'on password change — never DELETE+INSERT.';

-- ── household_keys ───────────────────────────────────────────────────
-- Per-household, per-member wrapped household DEK. The DEK itself is a
-- random 32-byte AES-256 key generated once per household. Each member
-- gets their own row with the DEK wrapped to their hybrid public key
-- via the Phase 4.0 KEM primitives.
--
-- Phase 4.1 ships with SELECT-only RLS — owners will not yet populate
-- this table, because the invite flow that produces the wrapped DEKs
-- arrives in Phase 4.3. Empty table on landing is the expected state.
CREATE TABLE IF NOT EXISTS public.household_keys (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id      UUID NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  user_id           UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  enc_household_dek TEXT NOT NULL,                       -- hybrid-KEM wrap to member's public key
  key_version       INTEGER NOT NULL DEFAULT 1,          -- bump on hard re-key (v2)
  wrapped_by        UUID REFERENCES auth.users(id),      -- who wrapped it (audit)
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at        TIMESTAMPTZ,
  UNIQUE (household_id, user_id, key_version)
);

ALTER TABLE public.household_keys ENABLE ROW LEVEL SECURITY;

-- Members can read their own wrap so they can unwrap the household DEK
-- on unlock. INSERT / UPDATE policies are deliberately deferred to
-- Phase 4.3 where the owner-side wrap pipeline lands.
DROP POLICY IF EXISTS "household_keys_select_own" ON public.household_keys;
CREATE POLICY "household_keys_select_own"
  ON public.household_keys
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

COMMENT ON TABLE public.household_keys IS
  'Phase 4.1: per-household, per-member wrapped household DEK. '
  'INSERT/UPDATE policies land in Phase 4.3 with the invite flow.';

COMMENT ON COLUMN public.household_keys.enc_household_dek IS
  'Hybrid-KEM wrap of the household DEK to the member user_id''s '
  'user_public_keys.public_key_b64. Format: base64(kem_ct || aes_gcm_ct).';

COMMENT ON COLUMN public.household_keys.key_version IS
  'Bumps on household hard re-key (v2 roadmap). Phase 4.1 pins at 1.';

COMMENT ON COLUMN public.household_keys.revoked_at IS
  'Set during soft revoke (amicable partnership end). Row remains for '
  'audit; RLS policy in 4.3 ignores revoked rows for data reads.';

-- ── household_members role vocabulary swap ───────────────────────────
-- The existing CHECK allows ('owner','editor','viewer'); Phase 4 maps
-- those to the household vocabulary ('owner','partner','advisor',
-- 'dependent') — see HOUSEHOLD-SHARING-DESIGN.md §7. We update any
-- existing rows BEFORE swapping the constraint so the UPDATE cannot
-- fail against the new CHECK. The expected case is an empty table.
DO $$
DECLARE
  constraint_name text;
BEGIN
  -- Migrate any pre-existing rows to the Phase 4 vocabulary.
  UPDATE public.household_members SET role = 'partner' WHERE role = 'editor';
  UPDATE public.household_members SET role = 'partner' WHERE role = 'viewer';

  -- Drop the old CHECK by name. Supabase / Postgres auto-names table
  -- check constraints as <table>_<column>_check, but older rows may
  -- have been generated with a different name — look it up dynamically
  -- so we never leave the old constraint dangling.
  SELECT conname INTO constraint_name
  FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace
  WHERE n.nspname = 'public'
    AND t.relname = 'household_members'
    AND c.contype = 'c'
    AND pg_get_constraintdef(c.oid) ILIKE '%role%'
    AND pg_get_constraintdef(c.oid) ILIKE '%editor%'
  LIMIT 1;

  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.household_members DROP CONSTRAINT %I', constraint_name);
  END IF;
END $$;

-- Add the Phase 4 CHECK. Guarded by NOT EXISTS on the constraint name
-- so a second run of this migration is a no-op.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'household_members'
      AND c.conname = 'household_members_role_check_p4'
  ) THEN
    ALTER TABLE public.household_members
      ADD CONSTRAINT household_members_role_check_p4
      CHECK (role IN ('owner', 'partner', 'advisor', 'dependent'));
  END IF;
END $$;

COMMENT ON COLUMN public.household_members.role IS
  'Phase 4.1: role vocabulary is (owner, partner, advisor, dependent). '
  'Advisor = tax-accountant seat (v1.5), dependent = teen allowance (v3). '
  'v1 ships owner + partner only.';

-- ── scope columns on shared tables ───────────────────────────────────
-- Per HOUSEHOLD-SHARING-DESIGN.md §2: accounts, categories, budgets,
-- goals, rules default to 'household'; transactions additionally
-- support 'author_only' for the per-row cryptographic privacy override
-- (v1.5 feature, column lands now so the data shape is stable).
--
-- journals + saved_reports are not shipped yet; they'll gain scope when
-- they ship. Bank connectors never get scope — they stay personal by
-- virtue of being the connector_credentials table, which is not a
-- shared table.
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS scope TEXT NOT NULL DEFAULT 'household'
  CHECK (scope IN ('personal', 'household', 'author_only'));

ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS scope TEXT NOT NULL DEFAULT 'household'
  CHECK (scope IN ('personal', 'household'));

ALTER TABLE public.categories
  ADD COLUMN IF NOT EXISTS scope TEXT NOT NULL DEFAULT 'household'
  CHECK (scope IN ('personal', 'household'));

ALTER TABLE public.budgets
  ADD COLUMN IF NOT EXISTS scope TEXT NOT NULL DEFAULT 'household'
  CHECK (scope IN ('personal', 'household'));

ALTER TABLE public.goals
  ADD COLUMN IF NOT EXISTS scope TEXT NOT NULL DEFAULT 'household'
  CHECK (scope IN ('personal', 'household'));

ALTER TABLE public.rules
  ADD COLUMN IF NOT EXISTS scope TEXT NOT NULL DEFAULT 'household'
  CHECK (scope IN ('personal', 'household'));

COMMENT ON COLUMN public.transactions.scope IS
  'Phase 4.1: ''personal'' / ''household'' / ''author_only''. '
  'author_only is the per-row cryptographic privacy override (v1.5). '
  'Default ''household'' so existing rows join the household view '
  'once households are populated.';
