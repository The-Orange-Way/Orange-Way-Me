-- Hardening: make the placeholder ML-DSA verifier loud in PG logs.
--
-- Phase 4.4 currently uses a placeholder `pqc_verify_ml_dsa_65()` that
-- returns TRUE for any well-formed-length base64 input. In normal
-- operation no caller reaches it (the feature flag `phase44Public`
-- defaults false, no Household Signing Key gets minted, the
-- `verify_mutation_signature_on_write` trigger short-circuits).
--
-- But "no one reaches it" is an unproven invariant. If something
-- accidentally turns Phase 4.4 on or mints an HSK without the flag,
-- this placeholder will silently mark every signature valid. That's
-- the failure mode this migration addresses: emit a WARNING on every
-- call so PG logs surface the placeholder being exercised in real time.
--
-- Real ML-DSA-65 verification still runs client-side in src/lib/osk.ts.
-- This migration does not change verification behavior; it only adds
-- observability.
--
-- Idempotent (CREATE OR REPLACE).

BEGIN;

CREATE OR REPLACE FUNCTION public.pqc_verify_ml_dsa_65(
  p_public_key_b64 TEXT,
  p_signature_b64  TEXT,
  p_payload        BYTEA
) RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  -- Emit a warning on every call so the placeholder being exercised
  -- in production is loud in PG logs. Real verification happens
  -- client-side in src/lib/osk.ts.
  RAISE WARNING USING
    MESSAGE = 'pqc_verify_ml_dsa_65 placeholder called — server-side ML-DSA verification is not yet implemented. See feature flag VITE_PHASE_4_4_PUBLIC.';

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
  'Phase 4.4 placeholder: returns TRUE for well-formed inputs and '
  'RAISEs WARNING on every call so audit logs catch any unexpected '
  'invocation. Swap body for a native ML-DSA verify when available — '
  'no other code changes required (and remove the RAISE WARNING).';

COMMIT;
