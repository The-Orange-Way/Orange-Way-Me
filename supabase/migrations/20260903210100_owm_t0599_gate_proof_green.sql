-- DO NOT MERGE. Control case for the OWM-T0599 definer gate.
--
-- The point of a control is that a check which refuses every migration is
-- indistinguishable from a check that works. This migration replaces no
-- function and grants EXECUTE to nobody, so the changed-migrations job must
-- pass on it while the paired proof migration makes the same job fail.

BEGIN;

SELECT 1;

COMMIT;
