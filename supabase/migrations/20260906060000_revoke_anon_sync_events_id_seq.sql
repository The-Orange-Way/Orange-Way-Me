-- OWM-T0755: sync_events_id_seq on OWM prod carried anon=rwU (SELECT,
-- UPDATE, USAGE), which the comment in
-- 20260901180000_narrow_sequence_default_privileges.sql assumed was
-- already absent. True on dev, not true on prod. ALTER DEFAULT PRIVILEGES
-- cannot fix an existing object's ACL, so revoke it directly.
--
-- No app code path needs this: sync_events is written only by the
-- or-webhook-receiver edge function through the service role client,
-- which is unaffected by anon/authenticated grants.

revoke select, update, usage on sequence public.sync_events_id_seq from anon;
