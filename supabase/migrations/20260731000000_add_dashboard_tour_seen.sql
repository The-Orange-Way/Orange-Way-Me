-- Add dashboard tour seen flag to user_profiles.
--
-- Records whether a user has dismissed the first-run coachmark layer on the
-- dashboard. Stored server-side so the tour is not repeated when the user
-- opens the app on a new device (cross-device "seen once" guarantee).
--
-- This column carries no sensitive data: it is a plain boolean, not self-custody
-- or encryption material. No Auditor pass is required, but DBA review applies
-- before dev and two-party (CTO + founder) applies before prod per policy.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS is safe to run twice.

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS has_seen_dashboard_tour boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.user_profiles.has_seen_dashboard_tour IS
  'Set to true the first time the user dismisses the first-run dashboard coachmarks. '
  'Persisted server-side so the tour does not repeat on a new device or browser.';