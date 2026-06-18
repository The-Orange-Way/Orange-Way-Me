-- pending_admin_emails: add an explicit USING(false) SELECT policy.
--
-- The table has had RLS enabled since 20260424185312 but no policies
-- defined. Postgres default-denies when RLS is on with zero policies,
-- so functionally only service-role / SECURITY DEFINER reads ever
-- succeed (the legitimate path: the email sender daemon uses the
-- service key). But "no policy" is silent intent — a reviewer reading
-- the schema can't tell whether RLS-with-no-policy was deliberate
-- (this is) or whether someone forgot to write the policy and meant
-- to allow access. Adding an explicit USING(false) policy documents
-- the intent and turns silence into a statement.
--
-- From P2 audit punchlist (2026-05-16 full audit), closed 2026-05-30.
--
-- Idempotent.

BEGIN;

DROP POLICY IF EXISTS "pending_admin_emails_deny_all" ON public.pending_admin_emails;
CREATE POLICY "pending_admin_emails_deny_all" ON public.pending_admin_emails
  FOR SELECT USING (false);

COMMENT ON POLICY "pending_admin_emails_deny_all" ON public.pending_admin_emails IS
  'Explicit deny-all SELECT. Service role / SECURITY DEFINER paths '
  '(the email sender daemon) bypass RLS and remain the only legitimate '
  'readers. Documents the intent that no authenticated user should ever '
  'see queued admin emails.';

COMMIT;
